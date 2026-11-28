import type { ReactNode } from 'react';
import type { PaymentRecord } from '../types';
import { formatAmount, shortHash } from '../lib/format';
import { Panel, Tag } from './Panel';

function KeyRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-3 px-4 py-3">
      <span className="pt-0.5 text-xs text-muted">{label}</span>
      <div className="min-w-0 text-xs leading-relaxed">{children}</div>
    </div>
  );
}

function TxValue({
  hash,
  mock,
  explorerUrl,
}: {
  hash: string;
  mock: boolean;
  explorerUrl?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mock ? (
        <Tag tone="warning" mono>
          MOCK FIXTURE
        </Tag>
      ) : explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-accent transition hover:text-accent-hover hover:underline hover:underline-offset-2"
        >
          View on explorer ↗
        </a>
      ) : null}
      <span className="font-mono text-xs text-muted">
        {shortHash(hash, 10, 8)}
      </span>
    </div>
  );
}

export function ReceiptPanel({ record }: { record: PaymentRecord | null }) {
  const isMockFixture = record?.request.metadata?.mock === true;

  return (
    <Panel
      title="Settlement rails"
      subtitle="Payment and receipt evidence for the selected run"
      actions={
        <Tag mono>{record ? `chain ${record.chain.chain_id}` : 'idle'}</Tag>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-warning">
          <span className="font-semibold">Note.</span> Payment and receipt
          hashes are deterministic mock fixtures (HSP QA IP access pending), so
          they are badged MOCK FIXTURE and never hyperlinked. The
          AgentReceiptRegistry deployment below is a real on-chain transaction.
        </div>

        {!record ? (
          <div className="rounded-lg border border-dashed border-edge bg-canvas/30 px-4 py-10 text-center text-xs text-faint">
            Run a scenario to see the payment and receipt rails.
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-edge">
              <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
                <span className="text-xs font-semibold text-ink">
                  Payment
                </span>
                <span className="text-[11px] text-faint">
                  {record.chain.chain_name ?? record.chain.chain_id}
                </span>
              </div>
              <div className="divide-y divide-edge">
                <KeyRow label="Amount">
                  <span className="font-mono text-sm text-ink">
                    {formatAmount(
                      record.outcome?.amountRaw ?? record.request.amountRaw,
                      record.chain.token.decimals,
                    )}{' '}
                    <span className="text-xs text-muted">
                      {record.chain.token.symbol}
                    </span>
                  </span>
                </KeyRow>
                <KeyRow label="Payment TX">
                  {record.outcome?.txSignature ? (
                    <TxValue
                      hash={record.outcome.txSignature}
                      mock={isMockFixture}
                      explorerUrl={record.paymentExplorerUrl}
                    />
                  ) : (
                    <span className="text-xs text-muted">
                      No payment tx — blocked before submission.
                    </span>
                  )}
                </KeyRow>
                <KeyRow label="Receipt TX">
                  {record.outcome?.receiptTxHash ? (
                    <TxValue
                      hash={record.outcome.receiptTxHash}
                      mock={isMockFixture}
                      explorerUrl={record.receiptExplorerUrl}
                    />
                  ) : (
                    <span className="text-xs text-muted">
                      Not written — receipts are emitted only after SETTLED and
                      attribution verified.
                    </span>
                  )}
                </KeyRow>
              </div>
            </div>

            <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border border-edge bg-canvas/30 px-4 py-3 text-xs">
              <span className="text-muted">Order</span>
              <span className="truncate font-mono text-ink">
                {record.outcome?.orderId ?? '—'}
              </span>
              <span className="text-muted">Flow</span>
              <span className="truncate font-mono text-ink">
                {record.outcome?.flowId ?? '—'}
              </span>
              <span className="text-muted">Payment</span>
              <span className="truncate font-mono text-ink">
                {record.outcome?.paymentId ?? '—'}
              </span>
              <span className="text-muted">Signature</span>
              <span className="truncate font-mono text-ink">
                {record.outcome?.signature
                  ? shortHash(record.outcome.signature, 10, 8)
                  : 'Not signed'}
              </span>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
