import { Bot, FolderTree, KeyRound, Package, Rocket, TerminalSquare, Webhook } from 'lucide-react';
import { useTitle } from '../lib/format';

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="rounded-xl border border-ink-border bg-ink-panel p-5">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <span className="text-eplyd">{icon}</span> {title}
      </h2>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted [&_code]:rounded [&_code]:bg-ink-panel2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-ink-text [&_li]:ml-4 [&_li]:list-disc">
        {children}
      </div>
    </section>
  );
}

export default function DocsPage(): JSX.Element {
  useTitle('Docs');
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Help & docs</h1>
        <p className="text-sm text-ink-muted">Everything you need to run bots on EplyD.</p>
      </div>

      <Section icon={<Rocket size={17} />} title="Quick start">
        <ol className="space-y-1.5">
          <li>1. <b className="text-ink-text">New project</b> → Upload a ZIP, pick a template, or import from Git.</li>
          <li>2. Open the project → <b className="text-ink-text">Environment</b> → add <code>DISCORD_TOKEN</code>.</li>
          <li>3. Press <b className="text-ink-text">Start</b>. Dependencies are detected and installed automatically — watch the stages in the Console.</li>
          <li>4. Stop and start again: the install is skipped (fingerprint match) and the bot is live in seconds.</li>
        </ol>
      </Section>

      <Section icon={<Package size={17} />} title="Automatic dependency management">
        <p>
          On every start EplyD computes a <b className="text-ink-text">fingerprint</b> (manifests + lockfile + runtime version + platform) and
          compares it with <code>.eplyd/deps.stamp</code>. Identical fingerprint and a healthy environment → install is skipped entirely.
        </p>
        <p>
          Installs share caches across the whole host: <code>pnpm</code> with one global store (hard links, identical packages stored once),
          <code>uv/pip</code> with shared caches, and <b className="text-ink-text">shared Python venvs</b> keyed by the hash of your normalized
          requirements — two bots with the same <code>requirements.txt</code> reuse one virtualenv. Concurrent identical installs are collapsed by a
          per-fingerprint lock, and at most <code>MAX_CONCURRENT_INSTALLS</code> run at once.
        </p>
        <p>
          Python projects without a manifest get a <code>requirements.txt</code> generated from imports of well-known Discord libraries
          (discord.py, nextcord, disnake, py-cord, hikari…).
        </p>
      </Section>

      <Section icon={<Bot size={17} />} title="Supported runtimes">
        <ul>
          <li><b className="text-ink-text">Node.js 20</b> — <code>package.json</code> entry or <code>npm start</code>; pnpm first, npm fallback.</li>
          <li><b className="text-ink-text">Python 3.12</b> — <code>main.py</code>/<code>bot.py</code>/<code>app.py</code>; runs inside the shared venv when one exists.</li>
          <li><b className="text-ink-text">Java 17 / 21</b> — <code>pom.xml</code> (Maven) or Gradle builds, then <code>java -jar</code>; prebuilt jars run directly.</li>
          <li>Anything else: set a custom <b className="text-ink-text">start command</b> in project Settings.</li>
        </ul>
      </Section>

      <Section icon={<FolderTree size={17} />} title="Files & editor">
        <p>
          The Files tab is a full browser IDE: Monaco editor with tabs, <code>Ctrl/Cmd+S</code> to save, Save &amp; Restart, upload/download, rename,
          duplicate and delete. The <b className="text-ink-text">deps toggle</b> (eye icon) hides <code>node_modules</code>, <code>venv</code> and{' '}
          <code>.git</code>. Deep links work: <code>/projects/&lt;id&gt;/files?path=src/index.js</code>.
        </p>
      </Section>

      <Section icon={<TerminalSquare size={17} />} title="Console">
        <p>
          Live stdout/stderr with ANSI colors over WebSocket, persistent 10 MB log history per project (survives reloads and restarts), timestamps
          toggle, pause, search, download and clear. The <b className="text-ink-text">Terminal</b> sub-tab gives an interactive shell in the project
          directory — use it for anything the automation does not cover.
        </p>
      </Section>

      <Section icon={<KeyRound size={17} />} title="Keys & isolation">
        <p>
          Guests sign in with a guest key and see <b className="text-ink-text">only projects they created</b> — enforced on every API route and
          WebSocket channel, not just in the UI. Revoke a key at any time; its sessions die instantly. The owner password lives in the server's{' '}
          <code>.env</code> (<code>ADMIN_PASSWORD</code>) and is stored only as an argon2id hash.
        </p>
      </Section>

      <Section icon={<Webhook size={17} />} title="Webhooks & API">
        <p>
          Per-project Discord webhooks notify crashes, restarts and deploys. The platform itself exposes a REST API under{' '}
          <a className="text-eplyd underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1</a> (OpenAPI spec), WebSocket
          channels under <code>/ws</code>, and a health check at <a className="text-eplyd underline" href="/healthz" target="_blank" rel="noreferrer">/healthz</a>.
        </p>
      </Section>

      <Section icon={<Rocket size={17} />} title="Keyboard shortcuts">
        <ul>
          <li><code>Ctrl/Cmd + S</code> — save the open file</li>
          <li><code>Enter</code> in the log search — find next match</li>
        </ul>
      </Section>
    </div>
  );
}
