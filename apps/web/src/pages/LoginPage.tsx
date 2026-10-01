import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Button, Checkbox, PasswordInput, Spinner, TextField } from '../components/ui';
import { useTitle } from '../lib/format';

export default function LoginPage(): JSX.Element {
  useTitle('Sign in');
  const { me, loading, login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!loading && me?.authenticated) return <Navigate to={params.get('next') || '/projects'} replace />;

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await login(password, remember);
      toast.push(`Welcome back (${res.role})`, 'ok');
      navigate(params.get('next') ? decodeURIComponent(params.get('next')!) : '/projects', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="login-bg" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img
            src="/logo.png"
            alt="Eply logo"
            className="glow-ring h-24 w-24 rounded-3xl bg-[#0d1312] p-3.5"
          />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-ink-muted">Sign in to manage your bots — online 24/7.</p>
          </div>
        </div>
        <form
          onSubmit={submit}
          className="rounded-2xl border border-ink-border bg-ink-panel/80 p-6 shadow-2xl backdrop-blur"
          aria-label="Login form"
        >
          <TextField label="Access key / password" error={error || undefined}>
            <PasswordInput
              autoFocus
              autoComplete="current-password"
              placeholder="Owner password or guest key"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              icon={<KeyRound size={15} />}
              invalid={!!error}
            />
          </TextField>
          <div className="mb-5 mt-4">
            <Checkbox checked={remember} onChange={setRemember} label="Remember me for 30 days" />
          </div>
          <Button type="submit" variant="primary" className="h-10 w-full" loading={busy}>
            {busy ? 'Checking…' : 'Unlock dashboard'}
          </Button>
          {loading && (
            <div className="mt-3 flex justify-center">
              <Spinner className="h-4 w-4" />
            </div>
          )}
        </form>
        <p className="mt-6 text-center text-xs text-ink-muted">
          EplyD · Built by Eply · <span className="font-mono">eplyd.dpdns.org</span>
        </p>
      </div>
    </div>
  );
}
