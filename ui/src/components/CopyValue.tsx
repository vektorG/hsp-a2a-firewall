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
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="truncate font-mono text-xs text-accent transition hover:text-accent-hover hover:underline hover:underline-offset-2"
        >
          {display ?? value}
        </a>
      ) : (
        <span className="truncate font-mono text-xs text-ink">
          {display ?? value}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-md border border-edge px-2 py-0.5 text-[11px] text-muted transition hover:border-edge-hover hover:text-ink"
        title="Copy value"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}
