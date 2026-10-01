import { Link } from 'react-router-dom';
import { ShieldAlert, TriangleAlert, HelpCircle } from 'lucide-react';
import { useTitle } from '../lib/format';

const KINDS: Record<string, { code: string; title: string; body: string; icon: typeof ShieldAlert }> = {
  '403': {
    code: '403',
    title: 'No access',
    body: 'This page is owner-only, or this project belongs to another key. Guests can only manage projects they created.',
    icon: ShieldAlert
  },
  '404': {
    code: '404',
    title: 'Page not found',
    body: 'The page you are looking for does not exist or was moved.',
    icon: TriangleAlert
  },
  '500': {
    code: '500',
    title: 'Something broke',
    body: 'An unexpected error occurred on the platform. Check the platform logs with `pm2 logs eplyd`.',
    icon: HelpCircle
  }
};

export default function ErrorPage({ kind }: { kind: string }): JSX.Element {
  useTitle(KINDS[kind]?.title || 'Error');
  const meta = KINDS[kind] || KINDS['404']!;
  const Icon = meta.icon;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <Link to="/" aria-label="EplyD home">
        <img src="/logo-tight.png" alt="Eply" className="h-9 w-auto opacity-90" />
      </Link>
      <div className="rounded-full border border-ink-border bg-ink-panel p-5 text-eplyd">
        <Icon size={30} />
      </div>
      <h1 className="font-mono text-4xl font-bold text-eplyd">{meta.code}</h1>
      <h2 className="text-lg font-medium">{meta.title}</h2>
      <p className="max-w-md text-sm text-ink-muted">{meta.body}</p>
      <div className="mt-1 flex items-center gap-2">
        <Link to="/projects" className="rounded-lg bg-eplyd px-4 py-2 text-sm font-medium text-[#06110c] hover:bg-eplyd-dim">
          Back to projects
        </Link>
        <Link to="/" className="rounded-lg border border-ink-border px-4 py-2 text-sm text-ink-muted transition-colors hover:text-ink-text">
          Home page
        </Link>
      </div>
    </div>
  );
}
