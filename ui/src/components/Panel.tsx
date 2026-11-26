import type { ReactNode } from 'react';
import { cn } from '../lib/format';

interface PanelProps {
  index: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'danger' | 'success';
}

export function Panel({
  index,
  title,
  actions,
  children,
  className,
  tone = 'default',
}: PanelProps) {
  return (
    <section
      className={cn(
        'relative border bg-panel/75 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.9)] backdrop-blur-sm',
        tone === 'default' && 'border-edge/80',
        tone === 'danger' && 'border-rose/30',
        tone === 'success' && 'border-mint/25',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute -left-px -top-px h-2.5 w-2.5 border-l border-t',
          tone === 'danger'
            ? 'border-rose'
            : tone === 'success'
              ? 'border-mint'
              : 'border-mint/60',
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge/70 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] uppercase tracking-[0.3em] text-mint/60">
            {index}
          </span>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-slate-100">
            {title}
          </h2>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Tag({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'mint' | 'rose' | 'amber' | 'sky';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em]',
        tone === 'default' && 'border-edge/80 bg-void/40 text-dim',
        tone === 'mint' && 'border-mint/30 bg-mint/10 text-mint',
        tone === 'rose' && 'border-rose/35 bg-rose/10 text-rose',
        tone === 'amber' && 'border-amber/35 bg-amber/10 text-amber',
        tone === 'sky' && 'border-sky/35 bg-sky/10 text-sky',
      )}
    >
      {children}
    </span>
  );
}
