import { useState } from 'react';

export function CopyValue({
  value,
  href,
  display,
}: {
  value: string;
  href?: string;
  display?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="truncate text-mint/90 underline decoration-mint/30 underline-offset-2 transition hover:text-mint"
        >
          {display ?? value}
        </a>
      ) : (
        <span className="truncate text-slate-200">{display ?? value}</span>
      )}
      <button
        type="button"
        onClick={copy}
        className="shrink-0 border border-edge/70 px-1 py-0.5 text-[9px] uppercase tracking-wider text-dim transition hover:border-mint/40 hover:text-mint"
        title="Copy value"
      >
        {copied ? 'ok' : 'cp'}
      </button>
    </span>
  );
}
