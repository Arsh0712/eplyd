/** Hand-written OpenAPI 3.0 summary of the EplyD REST API. */
export function openApiSpec(): Record<string, unknown> {
  const errorRef = {
    description: 'Error envelope',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } }
        }
      }
    }
  };
  const ok = (description: string) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });

  const path = (summary: string, responses: Record<string, unknown> = { '200': ok('Success') }, extra: Record<string, unknown> = {}) => ({
    summary,
    responses: { ...responses, '400': errorRef, '401': errorRef, '403': errorRef },
    ...extra
  });

  return {
    openapi: '3.0.3',
    info: { title: 'EplyD API', version: '1.0.0', description: 'Self-hosted Discord bot hosting platform API' },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'eplyd_session' }
      }
    },
    security: [{ cookieAuth: [] }],
    paths: {
      '/auth/login': { post: path('Login with owner password or guest key. Sets session + CSRF cookies.', { '200': ok('ok, role') }) },
      '/auth/logout': { post: path('Destroy the current session') },
      '/auth/me': { get: path('Current actor (owner / guest / unauthenticated)') },
      '/keys': {
        get: path('List guest keys (owner only)'),
        post: path('Generate a guest key — full value returned once', { '201': ok('id, label, key') })
      },
      '/keys/{id}': {
        delete: path('Revoke a guest key (kills its sessions)'),
        patch: path('Rename a guest key')
      },
      '/keys/{id}/reveal': { post: path('Reveal a guest key (owner only)') },
      '/projects': {
        get: path('List visible projects with live status'),
        post: path('Create a project (template / git import)', { '201': ok('project') })
      },
      '/projects/bulk': { post: path('Bulk start/stop/restart by ids') },
      '/projects/{id}': {
        get: path('Project detail + live process snapshot'),
        patch: path('Update project settings'),
        delete: path('Delete project (must be stopped)')
      },
      '/projects/{id}/upload-zip': { post: path('Upload ZIP (?mode=replace|merge)', { '200': ok('extraction stats') }) },
      '/projects/{id}/download': { get: path('Download project as ZIP') },
      '/projects/{id}/start': { post: path('Start pipeline: deps → build → run') },
      '/projects/{id}/stop': { post: path('Graceful stop (SIGTERM → SIGKILL)') },
      '/projects/{id}/restart': { post: path('Restart') },
      '/projects/{id}/kill': { post: path('SIGKILL the process group') },
      '/projects/{id}/install': { post: path('Run dependency install without starting') },
      '/projects/{id}/git-pull': { post: path('Pull latest from the configured Git remote') },
      '/projects/{id}/logs': {
        get: path('Tail recent log lines'),
        delete: path('Clear persisted logs')
      },
      '/projects/{id}/logs/download': { get: path('Download full log as text') },
      '/projects/{id}/files': {
        get: path('List a directory (?path=)'),
        delete: path('Delete file/folder (?path=)')
      },
      '/projects/{id}/files/content': {
        get: path('Read file content'),
        put: path('Save file content')
      },
      '/projects/{id}/files/raw': { get: path('Raw file (image preview / download)') },
      '/projects/{id}/files/mkdir': { post: path('Create folder') },
      '/projects/{id}/files/move': { post: path('Rename/move') },
      '/projects/{id}/files/copy': { post: path('Duplicate') },
      '/projects/{id}/files/upload': { post: path('Upload single file (raw body, ?path=&name=)') },
      '/projects/{id}/env': {
        get: path('List env vars (masked unless ?reveal=1)'),
        put: path('Set/delete env vars')
      },
      '/projects/{id}/env/import': { post: path('Bulk import .env text') },
      '/projects/{id}/env/export': { get: path('Export .env text') },
      '/projects/{id}/activity': { get: path('Per-project activity feed') },
      '/activity': { get: path('Global activity feed (owner)') },
      '/metrics': { get: path('Host + per-project metrics (owner)') },
      '/runtimes': { get: path('Detected runtime versions (owner)') },
      '/storage': { get: path('Cache sizes + install stats (owner)') },
      '/storage/clear': { post: path('Clear a cache scope / GC unused venvs') },
      '/settings': {
        get: path('Platform settings (owner)'),
        put: path('Update platform settings')
      },
      '/notifications/test': { post: path('Send a test webhook') },
      '/sessions': { get: path('Active sessions (owner)') },
      '/hooks/github': { post: path('HMAC-verified platform auto-update webhook', { '202': ok('update started') }) }
    }
  };
}
