import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, BookOpen, Bot, KeyRound, LogOut, Menu } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../state/auth';
import { Badge } from './ui';

export default function Layout(): JSX.Element {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const links = [
    { to: '/projects', label: 'Projects', icon: Bot, show: true },
    { to: '/keys', label: 'Keys', icon: KeyRound, show: me?.role === 'owner' },
    { to: '/activity', label: 'Activity', icon: Activity, show: me?.role === 'owner' },
    { to: '/docs', label: 'Docs', icon: BookOpen, show: true }
  ].filter((l) => l.show);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-ink-border bg-ink-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <button className="md:hidden text-ink-muted" onClick={() => setOpen(!open)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <NavLink to="/projects" className="flex items-center gap-2.5" aria-label="EplyD home">
            <img src="/logo-tight.png" alt="Eply logo" className="h-7 w-auto" />
            <span className="hidden text-xs text-ink-muted sm:inline">— Built by Eply</span>
          </NavLink>
          <nav className={`ml-2 items-center gap-1 md:flex ${open ? 'absolute inset-x-0 top-14 flex flex-col gap-1 border-b border-ink-border bg-ink-panel p-3' : 'hidden'}`}>
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    isActive ? 'bg-eplyd/10 text-eplyd' : 'text-ink-muted hover:bg-ink-panel2 hover:text-ink-text'
                  }`
                }
              >
                <l.icon size={15} />
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {me?.role === 'guest' && <Badge>{me.keyLabel ? `Guest: ${me.keyLabel}` : 'Guest'}</Badge>}
            {me?.role === 'owner' && <Badge className="!text-eplyd !border-eplyd/30">Owner</Badge>}
            <button
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-ink-panel2 hover:text-ink-text"
              aria-label="Log out"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-ink-border py-4 text-center text-xs text-ink-muted">
        EplyD — self-hosted Discord bot hosting · Built by Eply
        <span className="ml-1.5 font-mono opacity-70">
          · build {__BUILD_INFO__.id}
          {__BUILD_INFO__.time ? ` · ${__BUILD_INFO__.time}` : ''}
        </span>
      </footer>
    </div>
  );
}
