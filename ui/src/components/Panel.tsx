import type { ReactNode } from 'react';
import { cn } from '../lib/format';

interface PanelProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'danger' | 'success';
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  tone = 'default',
}: PanelProps) {
  return (
    <section
      className={cn(
        'rounded-lg border bg-surface',
        tone === 'default' && 'border-edge',
        tone === 'danger' && 'border-danger/35',
        tone === 'success' && 'border-success/30',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Tag({
  children,
  tone = 'default',
  mono = false,
}: {
  children: ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'danger' | 'warning';
  mono?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium',
        mono ? 'font-mono' : 'font-sans',
        tone === 'default' && 'border-edge bg-elevated text-muted',
        tone === 'accent' && 'border-accent/35 bg-accent/[0.12] text-accent',
        tone === 'success' &&
          'border-success/30 bg-success/10 text-success',
        tone === 'danger' && 'border-danger/30 bg-danger/10 text-danger',
        tone === 'warning' && 'border-warning/30 bg-warning/10 text-warning',
      )}
    >
      {children}
    </span>
  );
}
