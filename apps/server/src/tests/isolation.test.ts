import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;
let dataDir: string;
const OWNER_PASS = 'test-owner-pass-wxt1';

function csrfOf(res: request.Response | { headers: Record<string, unknown> }): string {
  const setCookie = (res.headers['set-cookie'] ?? []) as string[];
  const cookie = setCookie.find((c) => c.startsWith('eplyd_csrf='));
  if (!cookie) throw new Error('no csrf cookie in response');
  return decodeURIComponent(cookie.split(';')[0]!.split('=')[1]!);
}

function withCsrf(agent: request.Agent & { _csrf?: string }) {
  return (req: request.Test): request.Test => req.set('x-csrf-token', agent._csrf || '');
}

describe('auth + project isolation', () => {
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eplyd-iso-'));
    process.env.DATA_DIR = dataDir;
    process.env.CACHE_DIR = path.join(dataDir, 'cache');
    process.env.ADMIN_PASSWORD = OWNER_PASS;
    process.env.SESSION_SECRET = 's'.repeat(64);
    process.env.ENCRYPTION_KEY = 'e'.repeat(64);
    process.env.PUBLIC_URL = 'http://localhost:3000';
    process.env.NODE_ENV = 'test';

    const { ensureDirs } = await import('../config');
    const { buildApp } = await import('../app');
    const { ensureOwnerHash } = await import('../auth/routes');
    ensureDirs();
    await ensureOwnerHash();
    app = buildApp();
  });

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('owner logs in, creates a project; guest key sees nothing of it', async () => {
    // --- owner login ---
    const owner = request.agent(app) as request.Agent & { _csrf?: string };
    const loginRes = await owner.post('/api/v1/auth/login').send({ password: OWNER_PASS, remember: false });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.role).toBe('owner');
    owner._csrf = csrfOf(loginRes);

    // wrong password rejected
    const bad = await request(app).post('/api/v1/auth/login').send({ password: 'nope' });
    expect(bad.status).toBe(401);

    // me
    const me = await owner.get('/api/v1/auth/me');
    expect(me.body.authenticated).toBe(true);
    expect(me.body.role).toBe('owner');

    // --- CSRF enforcement ---
    const noCsrf = await owner.post('/api/v1/projects').send({ name: 'X' });
    expect(noCsrf.status).toBe(403);

    // --- owner project ---
    const created = await withCsrf(owner)(owner.post('/api/v1/projects').send({ name: 'OwnerBot', template: 'discordpy' }));
    expect(created.status).toBe(201);
    const projectId = created.body.project.id as string;
    expect(fs.existsSync(path.join(dataDir, 'projects', projectId, 'main.py'))).toBe(true);

    // --- guest key lifecycle ---
    const keyRes = await withCsrf(owner)(owner.post('/api/v1/keys').send({ label: 'Helper' }));
    expect(keyRes.status).toBe(201);
    const guestKey = keyRes.body.key as string;
    expect(guestKey.length).toBeGreaterThanOrEqual(32);

    const keysList = await owner.get('/api/v1/keys');
    expect(keysList.body.keys).toHaveLength(1);
    expect(keysList.body.keys[0].masked).not.toBe(guestKey);

    // --- guest login ---
    const guest = request.agent(app) as request.Agent & { _csrf?: string };
    const guestLogin = await guest.post('/api/v1/auth/login').send({ password: guestKey });
    expect(guestLogin.status).toBe(200);
    expect(guestLogin.body.role).toBe('guest');
    guest._csrf = csrfOf(guestLogin);

    // guest cannot see owner pages
    expect((await guest.get('/api/v1/keys')).status).toBe(403);
    expect((await guest.get('/api/v1/activity')).status).toBe(403);

    // guest sees zero projects
    const guestProjects = await guest.get('/api/v1/projects');
    expect(guestProjects.body.projects).toHaveLength(0);

    // guest cannot touch the owner's project (server-side, not just UI)
    expect((await guest.get(`/api/v1/projects/${projectId}`)).status).toBe(403);
    expect((await withCsrf(guest)(guest.post(`/api/v1/projects/${projectId}/start`))).status).toBe(403);
    expect((await withCsrf(guest)(guest.put(`/api/v1/projects/${projectId}/env`).set('x-csrf-token', guest._csrf!).send({ set: { EVIL: '1' } }))).status).toBe(403);
    expect((await guest.get(`/api/v1/projects/${projectId}/files?path=.`)).status).toBe(403);

    // guest logs in the WS-auth path too: actorFromRequest must reject owner project via logs API? (REST check above suffices)

    // --- guest creates own project; isolation both ways ---
    const gProj = await withCsrf(guest)(guest.post('/api/v1/projects').send({ name: 'GuestBot' }));
    expect(gProj.status).toBe(201);
    const guestProjectId = gProj.body.project.id as string;

    const guestList2 = await guest.get('/api/v1/projects');
    expect(guestList2.body.projects).toHaveLength(1);
    expect(guestList2.body.projects[0].name).toBe('GuestBot');

    const ownerList = await owner.get('/api/v1/projects');
    expect(ownerList.body.projects.map((p: { name: string }) => p.name).sort()).toEqual(['GuestBot', 'OwnerBot']);

    // guest CAN access own project
    const own = await guest.get(`/api/v1/projects/${guestProjectId}`);
    expect(own.status).toBe(200);

    // owner CAN access guest project
    expect((await owner.get(`/api/v1/projects/${guestProjectId}`)).status).toBe(200);

    // guest cannot reach owner-only platform APIs
    expect((await guest.get('/api/v1/metrics')).status).toBe(403);
    expect((await guest.get('/api/v1/storage')).status).toBe(403);

    // --- revoking the key kills guest sessions ---
    const keyId = keyRes.body.id as string;
    const revoke = await withCsrf(owner)(owner.delete(`/api/v1/keys/${keyId}`));
    expect(revoke.status).toBe(200);
    const guestAfter = await guest.get('/api/v1/auth/me');
    expect(guestAfter.body.authenticated).toBe(false);
  });

  it('file API blocks path traversal', async () => {
    const owner = request.agent(app) as request.Agent & { _csrf?: string };
    const loginRes = await owner.post('/api/v1/auth/login').send({ password: OWNER_PASS });
    owner._csrf = csrfOf(loginRes);
    const created = await withCsrf(owner)(owner.post('/api/v1/projects').send({ name: 'TraversalBot' }));
    const id = created.body.project.id as string;

    expect((await owner.get(`/api/v1/projects/${id}/files/content?path=../secrets.txt`)).status).toBe(400);
    expect((await owner.get(`/api/v1/projects/${id}/files/content?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd`)).status).toBe(400);
    expect((await owner.get(`/api/v1/projects/${id}/files?path=`)).status).toBe(200);

    // save + read roundtrip
    const save = await withCsrf(owner)(
      owner.put(`/api/v1/projects/${id}/files/content`).send({ path: 'src/index.js', content: 'console.log(1)\n' })
    );
    expect(save.status).toBe(200);
    const read = await owner.get(`/api/v1/projects/${id}/files/content?path=src/index.js`);
    expect(read.body.content).toBe('console.log(1)\n');
  });

  it('login is rate limited', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ password: 'definitely-wrong' });
    }
    const blocked = await request(app).post('/api/v1/auth/login').send({ password: OWNER_PASS });
    expect([401, 429]).toContain(blocked.status);
    expect(blocked.status).toBe(429); // even correct password blocked while locked out
  });
});
