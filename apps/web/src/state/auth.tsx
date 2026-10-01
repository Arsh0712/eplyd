import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { Me } from '../api/types';

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  login: (password: string, remember: boolean) => Promise<{ role: string; keyLabel?: string }>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ me: null, loading: true, refresh: async () => null, login: async () => ({ role: '' }), logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async (): Promise<Me | null> => {
    try {
      const m = await api<Me>('/auth/me');
      setMe(m);
      return m;
    } catch {
      setMe({ authenticated: false });
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      me,
      loading,
      refresh,
      login: async (password, remember) => {
        const res = await api<{ ok: boolean; role: string; keyLabel?: string }>('/auth/login', {
          method: 'POST',
          body: { password, remember }
        });
        await refresh();
        return res;
      },
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST', body: {} });
        } finally {
          setMe({ authenticated: false });
        }
      }
    }),
    [me, loading]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  return useContext(Ctx);
}
