import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Cpu, HardDrive, Bell, ShieldCheck, SlidersHorizontal } from 'lucide-react';

const SECTIONS = [
  { to: 'general', label: 'General', icon: SlidersHorizontal },
  { to: 'runtimes', label: 'Runtimes', icon: Cpu },
  { to: 'storage', label: 'Storage', icon: HardDrive },
  { to: 'notifications', label: 'Notifications', icon: Bell },
  { to: 'security', label: 'Security', icon: ShieldCheck }
];

export default function PlatformSettings(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Platform settings</h1>
        <p className="text-sm text-ink-muted">Host-wide configuration, caches and security.</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-ink-border">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm ${
                isActive ? 'border-eplyd text-eplyd' : 'border-transparent text-ink-muted hover:text-ink-text'
              }`
            }
          >
            <s.icon size={14} /> {s.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}

export { SECTIONS };
