import { useEffect, useRef } from 'react';
import type { PaymentRecord, PaymentState } from '../types';
import { cn, formatAmount, formatTime, shortHash } from '../lib/format';
import { Panel, Tag } from './Panel';

const STEPS = [
  { label: 'Quote', hint: 'order + prepare' },
  { label: 'Policy', hint: 'pre / post quote' },
  { label: 'Cross-check', hint: 'intent vs EIP-712' },
  { label: 'Sign', hint: 'server payload' },
  { label: 'Settle', hint: 'finalize + poll' },
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
    hasState(record, 'SIGNED') || record.outcome?.reason === 'POLICY_MISMATCH',
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

function stateTone(state: PaymentState): string {
  switch (state) {
    case 'SETTLED':
      return 'border-success/30 bg-success/10 text-success';
    case 'FAILED':
      return 'border-danger/30 bg-danger/10 text-danger';
    case 'REQUOTING':
    case 'SAFE_AWAITING_FINALITY':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'SIGNED':
    case 'FINALIZED':
    case 'SUBMITTED':
    case 'POLLING':
    case 'PREPARED':
      return 'border-accent/35 bg-accent/[0.12] text-accent';
    default:
      return 'border-edge bg-elevated text-muted';
  }
}

function statusTone(
  status: PaymentRecord['status'],
): 'default' | 'success' | 'danger' | 'warning' {
  if (status === 'SETTLED') {
    return 'success';
  }
  if (status === 'FAILED') {
    return 'danger';
  }
  if (status === 'running') {
    return 'warning';
  }
  return 'default';
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

function chipTone(chip: string): string {
  if (
    chip.startsWith('policy=deny') ||
    chip.startsWith('reason=') ||
    chip.startsWith('check=')
  ) {
    return 'border-danger/30 bg-danger/10 text-danger';
  }
  if (chip === 'attribution_verified=true') {
    return 'border-success/30 bg-success/10 text-success';
  }
  return 'border-edge bg-elevated text-muted';
}

function decisionDetails(
  record: PaymentRecord,
): Record<string, unknown> | undefined {
  for (const event of record.trace) {
    const meta = event.meta;
    if (!isRecord(meta)) {
      continue;
    }
    for (const candidate of [meta.policy, meta.decision, meta.validation]) {
      if (isRecord(candidate) && isRecord(candidate.details)) {
        return candidate.details;
      }
    }
  }
  return undefined;
}

function mismatchAmounts(
  record: PaymentRecord,
): { expected: string; actual: string } | null {
  for (const event of record.trace) {
    const meta = event.meta;
    if (
      isRecord(meta) &&
      meta.reason === 'POLICY_MISMATCH' &&
      typeof meta.expected === 'string' &&
      typeof meta.actual === 'string'
    ) {
      return { expected: meta.expected, actual: meta.actual };
    }
  }
  return null;
}

function amountText(raw: string | undefined, record: PaymentRecord): string {
  return formatAmount(raw, record.chain.token.decimals);
}

function VerdictCallout({ record }: { record: PaymentRecord }) {
  const symbol = record.chain.token.symbol;

  if (record.status === 'SETTLED') {
    return (
      <div className="rounded-md border border-success/30 border-l-2 border-l-success bg-success/[0.08] p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Settled &amp; attribution verified
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Payment finalized and the receipt anchored to AgentReceiptRegistry
          only after the attribution check matched.
        </p>
      </div>
    );
  }

  if (record.status === 'FAILED') {
    const reason = record.outcome?.reason ?? 'BLOCKED';

    if (reason === 'POLICY_MISMATCH') {
      const mismatch = mismatchAmounts(record);
      const approved = mismatch?.expected ?? record.request.amountRaw;
      const quoted = mismatch?.actual;

      return (
        <div className="rounded-md border border-danger/30 border-l-2 border-l-danger bg-danger/[0.08] p-4">
          <div className="text-sm font-semibold text-ink">
            Blocked before EIP-712 signature{' '}
            <span className="font-mono text-danger">— POLICY_MISMATCH</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-edge bg-canvas/50 px-3 py-2">
              <div className="text-[11px] text-faint">Approved intent</div>
              <div className="mt-0.5 font-mono text-sm text-ink">
                {amountText(approved, record)}{' '}
                <span className="text-xs text-muted">{symbol}</span>
              </div>
            </div>
            <div className="rounded-md border border-danger/25 bg-danger/[0.06] px-3 py-2">
              <div className="text-[11px] text-faint">Server quote</div>
              <div className="mt-0.5 font-mono text-sm text-danger">
                {quoted ? amountText(quoted, record) : '—'}{' '}
                <span className="text-xs text-danger/70">{symbol}</span>
              </div>
            </div>
            <div className="rounded-md border border-edge bg-canvas/50 px-3 py-2">
              <div className="text-[11px] text-faint">Signer called</div>
              <div className="mt-0.5 text-sm font-medium text-success">No</div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            The server quote did not match the approved intent, so no
            authorization was signed and no payment was broadcast.
          </p>
        </div>
      );
    }

    if (reason === 'EXCEEDS_DAILY_LIMIT') {
      const details = decisionDetails(record);
      const spent = details?.spentToday;
      const limit = details?.dailyLimit;
      const requested = details?.amount ?? record.request.amountRaw;

      return (
        <div className="rounded-md border border-danger/30 border-l-2 border-l-danger bg-danger/[0.08] p-4">
          <div className="text-sm font-semibold text-ink">
            Blocked before order creation{' '}
            <span className="font-mono text-danger">— EXCEEDS_DAILY_LIMIT</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-edge bg-canvas/50 px-3 py-2">
              <div className="text-[11px] text-faint">Ledger usage</div>
              <div className="mt-0.5 font-mono text-sm text-ink">
                {typeof spent === 'string' ? amountText(spent, record) : '—'} /{' '}
                {typeof limit === 'string' ? amountText(limit, record) : '—'}{' '}
                <span className="text-xs text-muted">{symbol}</span>
              </div>
            </div>
            <div className="rounded-md border border-danger/25 bg-danger/[0.06] px-3 py-2">
              <div className="text-[11px] text-faint">Requested</div>
              <div className="mt-0.5 font-mono text-sm text-danger">
                {amountText(
                  typeof requested === 'string' ? requested : undefined,
                  record,
                )}{' '}
                <span className="text-xs text-danger/70">{symbol}</span>
              </div>
            </div>
            <div className="rounded-md border border-edge bg-canvas/50 px-3 py-2">
              <div className="text-[11px] text-faint">Order created</div>
              <div className="mt-0.5 text-sm font-medium text-success">No</div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            The intent would push today&apos;s spend past the daily limit, so it
            never reached create_order or the signer.
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-md border border-danger/30 border-l-2 border-l-danger bg-danger/[0.08] p-4">
        <div className="text-sm font-semibold text-ink">
          Blocked before the signer{' '}
          <span className="font-mono text-danger">— {reason}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          The intent failed the pre-sign gate. No payment signature or receipt
          was produced.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-warning/30 border-l-2 border-l-warning bg-warning/[0.06] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
        Running — streaming trace from the state machine
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Each step appears as the orchestrator emits it over SSE.
      </p>
    </div>
  );
}

function StepIcon({ status, index }: { status: StepStatus; index: number }) {
  return (
    <span
      className={cn(
        'relative z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-surface',
        status === 'done' && 'border-success/40 text-success',
        status === 'blocked' && 'border-danger/40 text-danger',
        status === 'active' && 'border-accent/60 text-accent',
        status === 'pending' && 'border-edge text-faint',
      )}
    >
      {status === 'done' ? (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : status === 'blocked' ? (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      ) : status === 'active' ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
      ) : (
        <span className="font-mono text-[10px]">{index + 1}</span>
      )}
    </span>
  );
}

function PipelineStepper({ record }: { record: PaymentRecord }) {
  const statuses = stepStatuses(record);

  return (
    <ol className="flex items-start">
      {STEPS.map((step, index) => {
        const status = statuses[index] ?? 'pending';
        const previousDone = index > 0 && statuses[index - 1] === 'done';
        return (
          <li
            key={step.label}
            className="relative flex flex-1 flex-col items-center px-1 text-center"
          >
            {index > 0 ? (
              <span
                className={cn(
                  'absolute left-0 right-1/2 top-3 h-px',
                  previousDone ? 'bg-success/40' : 'bg-edge',
                )}
              />
            ) : null}
            {index < STEPS.length - 1 ? (
              <span
                className={cn(
                  'absolute left-1/2 right-0 top-3 h-px',
                  status === 'done' ? 'bg-success/40' : 'bg-edge',
                )}
              />
            ) : null}
            <StepIcon status={status} index={index} />
            <span
              className={cn(
                'mt-2 text-xs font-medium',
                status === 'blocked'
                  ? 'text-danger'
                  : status === 'active'
                    ? 'text-accent'
                    : status === 'done'
                      ? 'text-ink'
                      : 'text-faint',
              )}
            >
              {step.label}
            </span>
            <span className="mt-0.5 hidden text-[10px] text-faint sm:block">
              {step.hint}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CallChip({ label, count }: { label: string; count: number }) {
  const highlighted = label === 'prepare_payment' && count > 1;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]',
        highlighted
          ? 'border-warning/30 bg-warning/10 text-warning'
          : count > 0
            ? 'border-edge bg-elevated text-muted'
            : 'border-edge/60 bg-canvas/40 text-faint',
      )}
    >
      {label}
      <span className={highlighted ? 'text-warning' : 'text-ink'}>×{count}</span>
    </span>
  );
}

export function Timeline({
  record,
  mode = 'live',
}: {
  record: PaymentRecord | null;
  mode?: 'live' | 'static';
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    element.scrollTop =
      record?.status === 'running' ? element.scrollHeight : 0;
  }, [record?.id, record?.status, record?.trace.length]);

  if (!record) {
    return (
      <Panel
        title="Execution trace"
        subtitle={
          mode === 'static'
            ? 'Pre-recorded trace fixtures'
            : 'Live trace from the state machine'
        }
      >
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-edge bg-canvas/30 px-6 py-16 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-edge bg-elevated text-muted">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M4 6h16M4 12h10M4 18h7" strokeLinecap="round" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-medium text-ink">No trace selected</p>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">
            Choose a scenario above to inspect the policy decisions, signature
            boundary, settlement and receipt anchor.
          </p>
        </div>
      </Panel>
    );
  }

  const amount = formatAmount(
    record.outcome?.amountRaw ?? record.request.amountRaw,
    record.chain.token.decimals,
  );

  return (
    <Panel
      title={record.label}
      subtitle={`${record.id} · ${record.note}`}
      tone={record.status === 'FAILED' ? 'danger' : record.status === 'SETTLED' ? 'success' : 'default'}
      actions={
        <>
          <span className="text-right">
            <span className="block font-mono text-sm text-ink">
              {amount}{' '}
              <span className="text-xs text-muted">
                {record.chain.token.symbol}
              </span>
            </span>
            <span className="block text-[11px] text-faint">
              {record.request.merchantName}
            </span>
          </span>
          <Tag tone={statusTone(record.status)} mono>
            {record.status}
          </Tag>
        </>
      }
    >
      <div className="space-y-5">
        <VerdictCallout record={record} />

        <div className="rounded-lg border border-edge bg-canvas/30 px-4 py-4">
          <PipelineStepper record={record} />
        </div>

        {record.calls.prepare_payment > 1 ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
            Re-quote path: prepare_payment ×{record.calls.prepare_payment} on the
            same order, create_order ×{record.calls.create_order}.
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium text-muted">MCP calls</span>
          <CallChip label="create_order" count={record.calls.create_order} />
          <CallChip label="prepare_payment" count={record.calls.prepare_payment} />
          <CallChip label="finalize_payment" count={record.calls.finalize_payment} />
          <CallChip label="submit_payment" count={record.calls.submit_payment} />
          <CallChip label="query_payment" count={record.calls.query_payment} />
          <CallChip label="get_chain_config" count={record.calls.get_chain_config} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-ink">Trace steps</h3>
            <span className="text-[11px] text-faint">
              {record.trace.length} events
            </span>
          </div>

          <div
            ref={scrollRef}
            className="max-h-[420px] overflow-y-auto rounded-lg border border-edge bg-canvas/30"
          >
            <ol className="divide-y divide-edge">
              {record.trace.map((event, index) => {
                const chips = summarizeMeta(event.meta);
                return (
                  <li key={`${event.timestamp}-${index}`} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="w-5 font-mono text-[11px] text-faint">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="font-mono text-[11px] text-faint">
                        {formatTime(event.timestamp)}
                      </span>
                      <span className="font-mono text-[11px] text-muted">
                        {event.fromState}
                      </span>
                      <span className="text-faint">→</span>
                      <span
                        className={cn(
                          'rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium',
                          stateTone(event.toState),
                        )}
                      >
                        {event.toState}
                      </span>
                      {event.orderId ? (
                        <span className="font-mono text-[11px] text-faint">
                          {event.orderId}
                        </span>
                      ) : null}
                    </div>
                    {chips.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
                        {chips.map((chip) => (
                          <span
                            key={chip}
                            className={cn(
                              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]',
                              chipTone(chip),
                            )}
                          >
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
              <div className="border-t border-edge px-4 py-3 text-xs text-warning">
                <span className="animate-pulse">▌</span> Waiting for next state…
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}
