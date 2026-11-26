import type { ReactNode } from 'react';
import type { PaymentRecord } from '../types';
import { formatAmount, shortHash } from '../lib/format';
import { CopyValue } from './CopyValue';
import { Panel, Tag } from './Panel';

function Rail({
  tone,
  eyebrow,
  title,
  children,
}: {
  tone: 'mint' | 'sky';
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className={
        tone === 'mint'
          ? 'border border-mint/25 bg-mint/[0.04] p-3'
          : 'border border-sky/25 bg-sky/[0.04] p-3'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={
            tone === 'mint'
              ? 'text-[9px] uppercase tracking-[0.22em] text-mint/80'
              : 'text-[9px] uppercase tracking-[0.22em] text-sky/80'
          }
        >
          {eyebrow}
        </span>
        <span className="text-[9px] text-dim/60">{title}</span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function ReceiptPanel({ record }: { record: PaymentRecord | null }) {
  return (
    <Panel
      index="06 / receipt"
      title="Settlement rails"
      actions={<Tag>{record ? record.status : 'idle'}</Tag>}
    >
      {!record ? (
        <div className="border border-dashed border-edge/60 bg-void/20 px-3 py-10 text-center text-[10px] text-dim/60">
          run a scenario to see payment and receipt rails
        </div>
      ) : (
        <div className="space-y-3">
          <Rail
            tone="mint"
            eyebrow={`Payment: HSP QA (${record.chain.chain_name ?? record.chain.chain_id})`}
            title={`chain ${record.chain.chain_id}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-slate-100">
                {formatAmount(
                  record.outcome?.amountRaw ?? record.request.amountRaw,
                  record.chain.token.decimals,
                )}{' '}
                <span className="text-[10px] text-dim">
                  {record.chain.token.symbol}
                </span>
              </span>
              <span className="text-[9px] uppercase tracking-[0.16em] text-mint/70">
                {record.verdict}
              </span>
            </div>

            <div className="mt-2 border-t border-mint/15 pt-2">
              <div className="label mb-1">payment tx</div>
              {record.paymentExplorerUrl && record.outcome?.txSignature ? (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={record.paymentExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-mint/90 underline decoration-mint/30 underline-offset-2 hover:text-mint"
                  >
                    view payment tx ↗
                  </a>
                  <span className="text-[10px] text-dim">
                    {shortHash(record.outcome.txSignature, 10, 8)}
                  </span>
                </div>
              ) : (
                <div className="text-[10px] text-rose/70">
                  no payment tx — blocked before submission
                </div>
              )}
            </div>
          </Rail>

          <Rail
            tone="sky"
            eyebrow={`Receipt anchor: ${record.receipt.chainName}`}
            title={`chain ${record.receipt.chainId}`}
          >
            <div className="label mb-1">registry</div>
            <CopyValue
              value={record.receipt.registryAddress}
              href={
                record.receipt.explorerUrl && record.receipt.registryAddress
                  ? `${record.receipt.explorerUrl}/address/${record.receipt.registryAddress}`
                  : undefined
              }
              display={shortHash(record.receipt.registryAddress, 12, 8)}
            />

            <div className="mt-2 border-t border-sky/15 pt-2">
              <div className="label mb-1">receipt tx</div>
              {record.receiptExplorerUrl && record.outcome?.receiptTxHash ? (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={record.receiptExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-sky/90 underline decoration-sky/30 underline-offset-2 hover:text-sky"
                  >
                    view receipt anchor ↗
                  </a>
                  <span className="text-[10px] text-dim">
                    {shortHash(record.outcome.receiptTxHash, 10, 8)}
                  </span>
                </div>
              ) : (
                <div className="text-[10px] text-dim/70">
                  not written — receipt is only emitted after SETTLED +
                  attribution verified
                </div>
              )}
            </div>
          </Rail>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 border border-edge/50 bg-void/30 px-3 py-2 text-[10px]">
            <span className="label">order</span>
            <span className="truncate text-slate-200">
              {record.outcome?.orderId ?? '—'}
            </span>
            <span className="label">flow</span>
            <span className="truncate text-slate-200">
              {record.outcome?.flowId ?? '—'}
            </span>
            <span className="label">payment</span>
            <span className="truncate text-slate-200">
              {record.outcome?.paymentId ?? '—'}
            </span>
            <span className="label">signature</span>
            <span className="truncate text-slate-200">
              {record.outcome?.signature
                ? shortHash(record.outcome.signature, 10, 8)
                : 'not signed'}
            </span>
          </div>

          <p className="border-l border-edge/60 pl-3 text-[9px] leading-relaxed text-dim/60">
            Demo rails: payment hash and receipt hash are deterministic mock
            fixtures. Links resolve against the active chain config returned by
            the server; the receipt anchor always targets HSK Chain.
          </p>
        </div>
      )}
    </Panel>
  );
}
