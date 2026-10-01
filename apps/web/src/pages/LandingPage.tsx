import { Link, Navigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Bot,
  FileCode2,
  Infinity as InfinityIcon,
  Lock,
  PackageCheck,
  Rocket,
  TerminalSquare,
  Zap
} from 'lucide-react';
import { useAuth } from '../state/auth';
import { useTitle } from '../lib/format';

const FEATURES = [
  {
    icon: InfinityIcon,
    title: 'Always online — 24/7',
    body: 'Bots restart themselves if they crash and come back automatically if the server reboots. No sleeping, no idle timeouts — your community never notices.'
  },
  {
    icon: PackageCheck,
    title: 'First-start deploys',
    body: 'Press Start and EplyD installs dependencies automatically, fingerprints them, and skips re-installs on the next boot. npm, pnpm, pip, uv, Maven and Gradle are supported.'
  },
  {
    icon: TerminalSquare,
    title: 'Live console & shell',
    body: 'Stream stdout/stderr with ANSI colors the moment they happen, reopen the history after a restart, or drop into a real interactive shell in the project directory.'
  },
  {
    icon: FileCode2,
    title: 'Built-in code editor',
    body: 'Edit any file with Monaco (the VS Code editor). Ctrl+S saves instantly — or Save & Restart to ship a fix in one keystroke.'
  },
  {
    icon: Lock,
    title: 'Encrypted secrets',
    body: 'Paste a .env file and EplyD detects every variable automatically — tokens and passwords are encrypted at rest with AES-256-GCM and masked in the UI.'
  },
  {
    icon: Bot,
    title: 'Unlimited projects',
    body: 'No project caps and no bot caps. A live capacity panel shows exactly how much CPU, RAM and disk your host has left as you grow.'
  }
];

const STEPS = [
  { icon: Rocket, title: 'Deploy', body: 'Upload a ZIP, start from a discord.js / discord.py template, or clone from GitHub.' },
  { icon: Activity, title: 'Configure', body: 'Edit files in the browser, paste your .env — secrets are detected and encrypted automatically.' },
  { icon: Zap, title: 'Run forever', body: 'Press Start. Dependencies install on the first boot, the supervisor keeps it alive, and it stays online 24/7.' }
];

export default function LandingPage(): JSX.Element {
  useTitle('EplyD — Discord Bot Hosting');
  const { me, loading } = useAuth();
  if (!loading && me?.authenticated) return <Navigate to="/projects" replace />;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="land-bg" aria-hidden="true" />

      {/* Nav */}
      <header className="relative z-10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <img src="/logo-tight.png" alt="Eply logo" className="h-8 w-auto" />
            <span className="hidden text-xs text-ink-muted sm:inline">— Built by Eply</span>
          </div>
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 rounded-lg bg-eplyd px-4 py-2 text-sm font-medium text-[#06110c] shadow-[0_4px_14px_-6px_rgba(61,220,151,0.5)] transition-colors hover:bg-eplyd-dim"
          >
            Open dashboard <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10">
        <section className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-16 pt-10 text-center sm:pt-16">
          <img src="/logo.png" alt="Eply" className="float-y glow-ring mb-8 h-36 w-36 rounded-3xl bg-[#0d1312] p-5 sm:h-44 sm:w-44" />
          <h1 className="rise rise-1 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Your Discord bots, <span className="text-eplyd">online 24/7</span>.
          </h1>
          <p className="rise rise-2 mt-5 max-w-2xl text-pretty text-base leading-relaxed text-ink-muted sm:text-lg">
            EplyD is self-hosted bot hosting that runs on your own hardware. Deploy from a ZIP or Git, edit code in the browser,
            add secrets in seconds — and never worry about uptime again.
          </p>
          <div className="rise rise-3 mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-eplyd px-6 text-sm font-semibold text-[#06110c] shadow-[0_10px_30px_-10px_rgba(61,220,151,0.6)] transition-all hover:bg-eplyd-dim active:scale-[0.98]"
            >
              Open dashboard <ArrowRight size={15} />
            </Link>
            <Link
              to="/docs"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-border bg-ink-panel/70 px-6 text-sm text-ink-text backdrop-blur transition-colors hover:border-eplyd/40"
            >
              Read the docs
            </Link>
          </div>
          <div className="rise rise-4 mt-8 flex flex-wrap items-center justify-center gap-2 text-xs text-ink-muted">
            {['24/7 uptime', 'Unlimited bots', 'Zero-config deploys', 'Your server, your data'].map((c) => (
              <span key={c} className="rounded-full border border-ink-border bg-ink-panel/60 px-3 py-1 backdrop-blur">
                {c}
              </span>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 pb-20" aria-label="Features">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-ink-border bg-ink-panel/70 p-5 backdrop-blur transition-colors hover:border-eplyd/35"
              >
                <div className="mb-3 inline-grid h-10 w-10 place-items-center rounded-xl bg-eplyd/10 text-eplyd transition-colors group-hover:bg-eplyd/15">
                  <f.icon size={19} />
                </div>
                <h3 className="mb-1.5 font-medium">{f.title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Steps */}
        <section className="mx-auto max-w-6xl px-4 pb-24" aria-label="How it works">
          <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight">Up and running in minutes</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative rounded-2xl border border-ink-border bg-ink-panel/70 p-6 backdrop-blur">
                <span className="absolute right-5 top-4 font-mono text-4xl font-bold text-eplyd/15">0{i + 1}</span>
                <div className="mb-3 inline-grid h-10 w-10 place-items-center rounded-xl bg-eplyd/10 text-eplyd">
                  <s.icon size={19} />
                </div>
                <h3 className="mb-1.5 font-medium">{s.title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-ink-border py-6 text-center text-xs text-ink-muted">
        <div className="flex flex-col items-center gap-2">
          <img src="/logo-tight.png" alt="Eply" className="h-5 w-auto opacity-80" />
          <p>
            EplyD — self-hosted Discord bot hosting · Built by Eply · <span className="font-mono">eplyd.dpdns.org</span>
            <span className="ml-1.5 font-mono opacity-70">
              · build {__BUILD_INFO__.id}
              {__BUILD_INFO__.time ? ` · ${__BUILD_INFO__.time}` : ''}
            </span>
          </p>
        </div>
      </footer>
    </div>
  );
}
