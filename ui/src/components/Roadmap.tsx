import { Panel, Tag } from './Panel';

const PHASES = [
  {
    title: 'Firewall core',
    status: 'Shipped' as const,
    tone: 'success' as const,
    items: [
      'Deterministic policy gate before order creation',
      'Pre-sign EIP-712 cross-check against approved intent',
      'Attribution verification + HSK receipt anchoring',
    ],
  },
  {
    title: 'Trace control plane',
    status: 'Live' as const,
    tone: 'accent' as const,
    items: [
      'SSE timeline fed by the real state machine',
      'Switchable chain and token profiles at runtime',
      'Persisted policy editor with daily spend ledger',
    ],
  },
  {
    title: 'Agent SDK',
    status: 'Next' as const,
    tone: 'default' as const,
    items: [
      'Drop-in middleware for A2A agent runtimes',
      'Merchant-scoped policy packs and approvals',
      'Additional settlement rails and asset adapters',
    ],
  },
];

export function RoadmapPanel() {
  return (
    <Panel
      title="Roadmap"
      subtitle="From a single guardrail to a shared payment protocol"
      actions={<Tag mono>3 phases</Tag>}
    >
      <div className="space-y-3">
        {PHASES.map((phase) => (
          <div
            key={phase.title}
            className="rounded-md border border-edge bg-canvas/30 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">
                {phase.title}
              </span>
              <Tag tone={phase.tone} mono>
                {phase.status}
              </Tag>
            </div>
            <ul className="mt-2.5 space-y-1.5">
              {phase.items.map((item) => (
                <li
                  key={item}
                  className="flex gap-2 text-xs leading-relaxed text-muted"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-faint" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function WhyPanel() {
  return (
    <Panel
      title="Why this matters"
      subtitle="Autonomy without a pre-sign guardrail is an unauthorized spend waiting to happen"
      tone="success"
      actions={
        <Tag tone="accent" mono>
          before signature
        </Tag>
      }
    >
      <p className="text-sm leading-relaxed text-ink">
        An autonomous agent can hallucinate a merchant, a price, or a token —
        and turn that mistake into an unauthorized spend.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        The firewall sits between intent and signature. It evaluates policy
        before <span className="font-mono text-ink">create_order</span>,
        cross-checks the server&apos;s quote against the approved intent before
        signing, and anchors a receipt only after attribution is verified.
      </p>

      <div className="mt-4 space-y-3">
        {[
          ['Policy gate', 'No order or signature for denied intents.'],
          [
            'Quote cross-check',
            'Server price, recipient, token and chain must match.',
          ],
          [
            'Receipt after settlement',
            'Ledger and anchor update only after SETTLED.',
          ],
        ].map(([title, copy]) => (
          <div key={title} className="flex gap-2.5">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <div className="text-xs font-medium text-ink">{title}</div>
              <div className="text-xs leading-relaxed text-muted">{copy}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-success/25 bg-success/[0.08] px-3 py-2.5 text-xs leading-relaxed text-success">
        Blocked paths never reach the signer. That is the whole point.
      </div>
    </Panel>
  );
}
