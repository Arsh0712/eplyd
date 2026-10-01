import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  message: string;
}

interface ToastCtx {
  push: (message: string, kind?: Toast['kind']) => void;
}

const Ctx = createContext<ToastCtx>({ push: () => {} });
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg backdrop-blur ${
              t.kind === 'ok'
                ? 'border-eplyd/30 bg-eplyd-dark/90 text-eplyd'
                : t.kind === 'error'
                  ? 'border-red-500/30 bg-[#2a1414]/95 text-red-200'
                  : 'border-ink-border bg-ink-panel/95 text-ink-text'
            }`}
          >
            {t.kind === 'ok' ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            ) : t.kind === 'error' ? (
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            ) : (
              <Info size={16} className="mt-0.5 shrink-0 text-ink-muted" />
            )}
            <span className="flex-1 break-words">{t.message}</span>
            <button
              aria-label="Dismiss"
              className="shrink-0 opacity-60 hover:opacity-100"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  return useContext(Ctx);
}
