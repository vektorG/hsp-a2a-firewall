import { useEffect, useRef } from 'react';
import type { PaymentRecord, PaymentState } from '../types';
import { cn, formatAmount, formatTime, shortHash } from '../lib/format';
import { Panel, Tag } from './Panel';

const STEPS = [
  { label: 'Quote', hint: 'order + prepare' },
  { label: 'Policy', hint: 'pre / post quote' },
  { label: 'Cross-check', hint: 'intent vs eip712' },
  { label: 'Sign', hint: 'server payload' },
  { label: 'Settlement', hint: 'finalize + poll' },
  { label: 'Receipt', hint: 'HSK anchor' },
] as const;

const POLICY_REASONS = new Set([
  'INVALID_AMOUNT',
  'UNSUPPORTED_TOKEN',
  'UNTRUSTED_MERCHANT',
  'EXCEEDS_MAX_TX',
  'EXCEEDS_DAILY_LIMIT',
]);

type StepStatus = 'done' | 'active' | 'blocked' | 'pending';

function hasState(record: PaymentRecord, state: PaymentState): boolean {
  return record.trace.some((event) => event.toState === state);
}

function blockedStep(record: PaymentRecord): number | null {
  if (record.status !== 'FAILED') {
    return null;
  }

  const reason = record.outcome?.reason ?? '';

  if (POLICY_REASONS.has(reason)) {
    return 1;
  }
  if (reason === 'POLICY_MISMATCH') {
    return 2;
  }
  if (reason === 'ATTRIBUTION_MISMATCH' || reason === 'POLL_TIMEOUT') {
    return 4;
  }
  if (reason === 'QUOTE_EXPIRED') {
    return 0;
  }
  return 3;
}

function stepStatuses(record: PaymentRecord): StepStatus[] {
  const flags = [
    hasState(record, 'ORDER_CREATED') || hasState(record, 'REQUOTING'),
    hasState(record, 'POLICY_CHECKED'),
    hasState(record, 'SIGNED') ||
      record.outcome?.reason === 'POLICY_MISMATCH',
    hasState(record, 'SIGNED'),
    ['FINALIZED', 'SUBMITTED', 'POLLING', 'SAFE_AWAITING_FINALITY', 'SETTLED'].some(
      (state) => hasState(record, state as PaymentState),
    ) || record.status === 'SETTLED',
    Boolean(record.outcome?.receiptTxHash) || record.status === 'SETTLED',
  ];

  const blocked = blockedStep(record);
  let activeAssigned = false;

  return flags.map((done, index) => {
    if (blocked === index) {
      return 'blocked';
    }
    if (done) {
      return 'done';
    }
    if (record.status === 'running' && !activeAssigned) {
      activeAssigned = true;
      return 'active';
    }
    return 'pending';
  });
}

function failureCategory(reason: string | undefined): string | null {
  if (!reason) {
    return null;
  }
  if (POLICY_REASONS.has(reason)) {
    return 'POLICY_BLOCKED';
  }
  return reason;
}

function stateTone(state: PaymentState): string {
  switch (state) {
    case 'SETTLED':
      return 'border-mint/35 bg-mint/10 text-mint';
    case 'FAILED':
      return 'border-rose/35 bg-rose/10 text-rose';
    case 'REQUOTING':
    case 'SAFE_AWAITING_FINALITY':
      return 'border-amber/35 bg-amber/10 text-amber';
    case 'SIGNED':
    case 'FINALIZED':
    case 'SUBMITTED':
      return 'border-sky/35 bg-sky/10 text-sky';
    default:
      return 'border-edge/70 bg-void/60 text-slate-200';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizeMeta(meta: Record<string, unknown> | undefined): string[] {
  if (!meta) {
    return [];
  }

  const chips: string[] = [];

  if (isRecord(meta.decision)) {
    const decision = meta.decision;
    chips.push(
      `policy=${decision.allowed === true ? 'allow' : 'deny'}${
        typeof decision.reason === 'string' ? `:${decision.reason}` : ''
      }`,
    );
  }

  for (const key of [
    'phase',
    'trigger',
    'status',
    'check',
    'reason',
    'quotedTotalRaw',
    'token_total_raw',
    'attempt',
    'timeoutRetries',
    'attribution_verified',
  ]) {
    const value = meta[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      chips.push(`${key}=${String(value)}`);
    }
  }

  if (typeof meta.expected === 'string') {
    chips.push(`expected=${shortHash(meta.expected, 10, 6)}`);
  }
  if (typeof meta.actual === 'string') {
    chips.push(`actual=${shortHash(meta.actual, 10, 6)}`);
  }

  return chips.slice(0, 8);
}

function CallChip({ label, count }: { label: string; count: number }) {
  const highlighted = label === 'prepare_payment' && count > 1;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px]',
        highlighted
          ? 'border-amber/40 bg-amber/10 text-amber'
          : count > 0
            ? 'border-edge/80 bg-void/50 text-slate-200'
            : 'border-edge/40 bg-void/20 text-dim/50',
      )}
    >
      {label}
      <span className={highlighted ? 'text-amber' : 'text-mint'}>×{count}</span>
    </span>
  );
}

export function Timeline({ record }: { record: PaymentRecord | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [record?.trace.length]);

  const actions = (
    <>
      <Tag>{record ? `${record.trace.length} trace events` : 'idle'}</Tag>
      <Tag tone={record?.status === 'FAILED' ? 'rose' : 'default'}>
        {record?.status ?? 'waiting'}
      </Tag>
    </>
  );

  return (
    <Panel
      index="05 / live trace"
      title="Execution timeline"
      actions={actions}
      tone={record?.status === 'FAILED' ? 'danger' : 'default'}
      className="crt"
    >
      {!record ? (
        <div className="flex min-h-[420px] flex-col items-center justify-center border border-dashed border-edge/60 bg-void/20 px-6 py-16 text-center">
          <div className="text-2xl text-mint/40">$</div>
          <p className="mt-4 text-xs uppercase tracking-[0.2em] text-dim">
            no trace selected
          </p>
          <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-dim/70">
            Run one of the seven scenarios above. The timeline is fed live over
            SSE from the state machine, not replayed in the browser.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-dim">
                {record.id} · {record.scenario}
              </div>
              <h3 className="mt-1 text-base font-semibold text-slate-100">
                {record.label}
              </h3>
              <p className="mt-1 text-[11px] text-dim">{record.note}</p>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] text-dim/70">
                amount
              </div>
              <div className="text-sm text-slate-100">
                {formatAmount(
                  record.outcome?.amountRaw ?? record.request.amountRaw,
                  record.chain.token.decimals,
                )}{' '}
                <span className="text-[10px] text-dim">
                  {record.chain.token.symbol}
                </span>
              </div>
              <div className="text-[10px] text-dim/60">
                {record.request.merchantName}
              </div>
            </div>
          </div>

          {record.status === 'FAILED' ? (
            <div className="border border-rose/35 bg-rose/10 px-3 py-2.5 shadow-roseglow">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-semibold uppercase tracking-[0.18em] text-rose">
                  blocked
                </span>
                <span className="text-rose/80">
                  {failureCategory(record.outcome?.reason)}
                </span>
                {failureCategory(record.outcome?.reason) !==
                record.outcome?.reason ? (
                  <>
                    <span className="text-dim">·</span>
                    <span className="text-rose/70">
                      {record.outcome?.reason}
                    </span>
                  </>
                ) : null}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-rose/70">
                Stopped before the signer. No payment signature or receipt was
                produced.
              </p>
            </div>
          ) : record.status === 'SETTLED' ? (
            <div className="border border-mint/30 bg-mint/5 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-semibold uppercase tracking-[0.18em] text-mint">
                  settled
                </span>
                <span className="text-mint/70">
                  payment-finalized · attribution verified
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-mint/60">
                Receipt anchored only after attribution. Ledger updated after
                SETTLED.
              </p>
            </div>
          ) : (
            <div className="border border-amber/30 bg-amber/5 px-3 py-2.5 text-[11px] text-amber">
              <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse bg-amber align-middle" />
              streaming trace from the state machine…
            </div>
          )}

          {record.calls.prepare_payment > 1 ? (
            <div className="border border-amber/30 bg-amber/5 px-3 py-2 text-[10px] text-amber">
              re-quote path: <span className="font-semibold">prepare_payment ×{record.calls.prepare_payment}</span>{' '}
              on the same order, <span className="font-semibold">create_order ×{record.calls.create_order}</span>.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {STEPS.map((step, index) => {
              const status = stepStatuses(record)[index] ?? 'pending';
              return (
                <div
                  key={step.label}
                  className={cn(
                    'border px-2 py-2',
                    status === 'done' && 'border-mint/25 bg-mint/5',
                    status === 'active' && 'border-amber/40 bg-amber/5',
                    status === 'blocked' && 'border-rose/40 bg-rose/10',
                    status === 'pending' && 'border-edge/50 bg-void/20',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'h-1.5 w-1.5',
                        status === 'done' && 'bg-mint',
                        status === 'active' && 'animate-pulse bg-amber',
                        status === 'blocked' && 'bg-rose',
                        status === 'pending' && 'bg-dim/40',
                      )}
                    />
                    <span
                      className={cn(
                        'text-[9px] uppercase tracking-[0.15em]',
                        status === 'done' && 'text-mint',
                        status === 'active' && 'text-amber',
                        status === 'blocked' && 'text-rose',
                        status === 'pending' && 'text-dim/60',
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                  <div className="mt-1 text-[9px] text-dim/60">{step.hint}</div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-y border-edge/50 py-2">
            <span className="mr-1 text-[9px] uppercase tracking-[0.2em] text-dim/60">
              mcp calls
            </span>
            <CallChip label="create_order" count={record.calls.create_order} />
            <CallChip label="prepare_payment" count={record.calls.prepare_payment} />
            <CallChip label="finalize_payment" count={record.calls.finalize_payment} />
            <CallChip label="submit_payment" count={record.calls.submit_payment} />
            <CallChip label="query_payment" count={record.calls.query_payment} />
            <CallChip label="get_chain_config" count={record.calls.get_chain_config} />
          </div>

          <div
            ref={scrollRef}
            className="max-h-[520px] space-y-0 overflow-y-auto pr-1"
          >
            <ol className="space-y-0">
              {record.trace.map((event, index) => {
                const chips = summarizeMeta(event.meta);
                const failed = event.toState === 'FAILED';
                const settled = event.toState === 'SETTLED';
                return (
                  <li
                    key={`${event.timestamp}-${index}`}
                    className={cn(
                      'relative border-l pl-4 pb-4',
                      failed
                        ? 'border-rose/50'
                        : settled
                          ? 'border-mint/50'
                          : 'border-edge/60',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute -left-[4px] top-1 h-2 w-2 border',
                        failed
                          ? 'border-rose bg-rose'
                          : settled
                            ? 'border-mint bg-mint'
                            : 'border-edge bg-panel',
                      )}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[9px] text-dim/50">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[9px] text-dim/60">
                        {formatTime(event.timestamp)}
                      </span>
                      <span className="text-[10px] text-dim/50">
                        {event.fromState}
                      </span>
                      <span className="text-dim/40">→</span>
                      <span
                        className={cn(
                          'border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]',
                          stateTone(event.toState),
                        )}
                      >
                        {event.toState}
                      </span>
                      {event.orderId ? (
                        <span className="text-[9px] text-dim/50">
                          {event.orderId}
                        </span>
                      ) : null}
                    </div>
                    {chips.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {chips.map((chip) => (
                          <span key={chip} className="chip">
                            {chip}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {record.status === 'running' ? (
              <div className="border-l border-edge/60 pl-4 text-[10px] text-amber">
                <span className="animate-pulse">▌</span> waiting for next state…
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}
