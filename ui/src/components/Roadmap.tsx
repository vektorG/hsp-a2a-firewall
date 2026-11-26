import { Panel, Tag } from './Panel';

const PHASES = [
  {
    id: '01',
    title: 'Firewall core',
    status: 'shipped' as const,
    items: [
      'Deterministic policy gate before order creation',
      'Pre-sign EIP-712 cross-check against approved intent',
      'Attribution verification + HSK receipt anchoring',
    ],
  },
  {
    id: '02',
    title: 'Trace control plane',
    status: 'live' as const,
    items: [
      'SSE timeline fed by the real state machine',
      'Switchable chain / token profiles at runtime',
      'Persisted policy editor with daily spend ledger',
    ],
  },
  {
    id: '03',
    title: 'Agent SDK',
    status: 'next' as const,
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
      index="07 / roadmap"
      title="From guardrail to protocol"
      actions={<Tag>3 phases</Tag>}
    >
      <div className="space-y-2">
        {PHASES.map((phase) => (
          <div
            key={phase.id}
            className="border border-edge/60 bg-void/30 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] text-dim/50">{phase.id}</span>
                <span className="text-[11px] font-semibold text-slate-100">
                  {phase.title}
                </span>
              </div>
              <span
                className={
                  phase.status === 'shipped'
                    ? 'border border-mint/30 bg-mint/10 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em] text-mint'
                    : phase.status === 'live'
                      ? 'border border-sky/30 bg-sky/10 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em] text-sky'
                      : 'border border-edge/70 bg-void/40 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em] text-dim'
                }
              >
                {phase.status}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {phase.items.map((item) => (
                <li
                  key={item}
                  className="flex gap-2 text-[10px] leading-relaxed text-dim"
                >
                  <span className="text-mint/40">›</span>
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
      index="08 / why"
      title="Why this matters"
      tone="success"
      actions={<Tag tone="mint">before signature</Tag>}
    >
      <p className="text-[12px] leading-relaxed text-slate-200">
        An autonomous agent can hallucinate a merchant, a price, or a token —
        and turn that mistake into an unauthorized spend.
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-dim">
        The firewall sits between intent and signature. It evaluates policy
        before <span className="text-slate-300">create_order</span>, cross-checks
        the server&apos;s quote against the approved intent before signing, and
        anchors a receipt only after attribution is verified.
      </p>

      <div className="mt-4 space-y-2">
        {[
          ['01', 'Policy gate', 'No order or signature for denied intents.'],
          ['02', 'Quote cross-check', 'Server price, recipient, token and chain must match.'],
          ['03', 'Receipt after settlement', 'Ledger and anchor update only after SETTLED.'],
        ].map(([id, title, copy]) => (
          <div
            key={id}
            className="grid grid-cols-[26px_minmax(0,1fr)] gap-2 border-l border-mint/30 pl-2"
          >
            <span className="text-[10px] text-mint/60">{id}</span>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200">
                {title}
              </div>
              <div className="text-[10px] leading-relaxed text-dim">{copy}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border border-mint/20 bg-mint/5 px-3 py-2 text-[10px] leading-relaxed text-mint/80">
        Blocked paths never reach the signer. That is the whole point.
      </div>
    </Panel>
  );
}
