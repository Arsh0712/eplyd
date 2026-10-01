import {
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react';
import { AlertCircle, Check, ChevronDown, Copy, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { statusMeta } from '../api/types';

/* ================================================================
 *  EplyD design system — dark-first, green accent, soft focus rings
 * ================================================================ */

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle' | 'outline';

export function Button({
  variant = 'subtle',
  loading,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }): JSX.Element {
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-eplyd text-[#06110c] hover:bg-eplyd-dim font-medium shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_4px_14px_-6px_rgba(61,220,151,0.45)]',
    ghost: 'bg-transparent hover:bg-ink-panel2 text-ink-text',
    danger: 'bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20',
    subtle: 'bg-ink-panel2 border border-ink-border text-ink-text hover:border-eplyd/40 hover:bg-[#1a2422]',
    outline: 'border border-ink-border text-ink-muted hover:text-ink-text hover:border-eplyd/40'
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eplyd/40 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] ${styles[variant]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------
 *  Inputs — consistent height, elevated field background, soft ring
 * ---------------------------------------------------------------- */

const FIELD_BASE =
  'w-full rounded-lg border bg-ink-field text-sm text-ink-text placeholder:text-ink-muted/60 shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-[border-color,box-shadow] duration-150 outline-none disabled:cursor-not-allowed disabled:opacity-50 read-only:text-ink-muted';

const FIELD_STATE = (invalid?: boolean): string =>
  invalid
    ? 'border-red-500/50 hover:border-red-500/70 focus:border-red-500/70 focus:ring-2 focus:ring-red-500/20'
    : 'border-ink-border hover:border-[#2c3a35] focus:border-eplyd/60 focus:ring-2 focus:ring-eplyd/15';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  mono?: boolean;
}

export function Input({ invalid, icon, trailing, mono, className = '', ...rest }: InputProps): JSX.Element {
  const inputCls = `${FIELD_BASE} ${FIELD_STATE(invalid)} h-10 w-full px-3 ${mono ? 'font-mono text-[13px]' : ''} ${
    icon ? 'pl-9' : ''
  } ${trailing ? 'pr-10' : ''}`;
  if (!icon && !trailing) return <input className={`${inputCls} ${className}`} {...rest} />;
  return (
    <div className={`relative w-full ${className}`}>
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true">
          {icon}
        </span>
      )}
      <input className={inputCls} {...rest} />
      {trailing && <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center">{trailing}</span>}
    </div>
  );
}

/** Password field with a built-in show/hide toggle. */
export function PasswordInput({ className = '', ...rest }: InputProps): JSX.Element {
  const [show, setShow] = useState(false);
  return (
    <Input
      {...rest}
      type={show ? 'text' : 'password'}
      className={className}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide value' : 'Show value'}
          className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-ink-panel2 hover:text-ink-text"
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      }
    />
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function TextArea({ invalid, mono, className = '', rows = 4, ...rest }: TextAreaProps): JSX.Element {
  return (
    <textarea
      rows={rows}
      className={`${FIELD_BASE} ${FIELD_STATE(invalid)} resize-y px-3 py-2.5 leading-relaxed ${mono ? 'font-mono text-[13px]' : ''} ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <div className={`relative w-full ${className}`}>
      <select
        className={`${FIELD_BASE} ${FIELD_STATE(false)} h-10 w-full appearance-none px-3 pr-9 [&>option]:bg-ink-panel [&>option]:text-ink-text`}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-all duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-eplyd/40 ${
          checked ? 'border-eplyd bg-eplyd text-[#06110c]' : 'border-ink-border bg-ink-field hover:border-[#2c3a35]'
        }`}
      >
        {checked && <Check size={12} strokeWidth={3.5} />}
      </span>
      <span className="select-none text-sm">
        <span className="text-ink-text">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Label + control + hint/error — the standard way to lay out a field. */
export function TextField({
  label,
  hint,
  error,
  required,
  children,
  className = '',
  action
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-[13px] font-medium text-ink-text">
          {label}
          {required && <span className="ml-0.5 text-eplyd">*</span>}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-red-300" role="alert">
          <AlertCircle size={12} /> {error}
        </p>
      ) : (
        hint && <p className="text-xs leading-relaxed text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

/** Segmented control — for small exclusive choices (tabs, view modes). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: ReactNode; icon?: ReactNode }[];
  size?: 'sm' | 'md';
  ariaLabel?: string;
}): JSX.Element {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';
  return (
    <div className="inline-flex rounded-lg border border-ink-border bg-ink-field p-0.5" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex items-center gap-1.5 rounded-[7px] font-medium transition-all duration-150 ${pad} ${
            value === o.id ? 'bg-eplyd/15 text-eplyd shadow-[0_0_0_1px_rgba(61,220,151,0.25)_inset]' : 'text-ink-muted hover:text-ink-text'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------
 *  Surfaces & feedback
 * ---------------------------------------------------------------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={`rounded-xl border border-ink-border bg-ink-panel ${className}`}>{children}</div>;
}

export function StatusPill({ status, detail }: { status: string; detail?: string }): JSX.Element {
  const m = statusMeta(status);
  const animate = ['running', 'installing', 'building', 'starting', 'queued', 'checking_deps', 'stopping'].includes(status);
  return (
    <span title={detail || m.label} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${animate ? 'animate-pulse' : ''}`} />
      {m.label}
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }): JSX.Element {
  return <Loader2 className={`animate-spin text-eplyd ${className}`} size={20} />;
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink-border bg-ink-panel/50 px-6 py-16 text-center">
      <div className="rounded-full bg-ink-panel2 p-4 text-eplyd">{icon}</div>
      <h3 className="text-base font-medium">{title}</h3>
      <p className="max-w-sm text-sm text-ink-muted">{body}</p>
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }): JSX.Element | null {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-xl border border-ink-border bg-ink-panel p-5 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-muted transition-colors hover:bg-ink-panel2 hover:text-ink-text">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  requireText,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  requireText?: string;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element | null {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  const blocked = !!requireText && text !== requireText;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="mb-3 text-sm leading-relaxed text-ink-muted">{body}</p>
      {requireText && (
        <div className="mb-4">
          <Input
            mono
            placeholder={`Type "${requireText}" to confirm`}
            value={text}
            invalid={text.length > 0 && text !== requireText}
            onChange={(e) => setText(e.target.value)}
            aria-label="Confirmation text"
          />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={blocked} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function CopyButton({ value, label, className = '' }: { value: string; label?: string; className?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant="subtle" className={className} onClick={() => void copy()} aria-label={label || 'Copy'}>
      {copied ? <Check size={14} className="text-eplyd" /> : <Copy size={14} />}
      {copied ? 'Copied' : label || 'Copy'}
    </Button>
  );
}

/** Click-to-copy mono text (keys, ids, tokens). */
export function CopyText({ value, display, className = '' }: { value: string; display?: ReactNode; className?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      title="Click to copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch { /* clipboard unavailable */ }
      }}
      className={`group inline-flex max-w-full items-center gap-1.5 rounded-md border border-ink-border bg-ink-field px-2 py-1 font-mono text-xs text-ink-text transition-colors hover:border-eplyd/40 ${className}`}
    >
      <span className="truncate">{display ?? value}</span>
      {copied ? <Check size={12} className="shrink-0 text-eplyd" /> : <Copy size={12} className="shrink-0 text-ink-muted group-hover:text-ink-text" />}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label || 'Toggle'}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eplyd/40 ${checked ? 'border-eplyd/50 bg-eplyd/30' : 'border-ink-border bg-ink-field'}`}
    >
      <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full transition-all duration-150 ${checked ? 'left-[22px] bg-eplyd' : 'left-0.5 bg-ink-muted'}`} />
    </button>
  );
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <span className={`inline-flex items-center gap-1 rounded-md border border-ink-border bg-ink-panel2 px-1.5 py-0.5 text-[11px] text-ink-muted ${className}`}>{children}</span>;
}

/** Backwards-compatible simple field wrapper (label above control). */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink-text">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
