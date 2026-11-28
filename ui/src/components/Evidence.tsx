import type { ReactNode } from 'react';
import {
  RECEIPT_DEPLOY_TX,
  RECEIPT_REGISTRY_ADDRESS,
  STATIC_RECEIPT,
} from '../staticPreview';
import { shortHash } from '../lib/format';
import { CopyValue } from './CopyValue';
import { Panel, Tag } from './Panel';

const PIPELINE = [
  {
    title: 'Agent intent',
    detail: 'Merchant, token and amount requested by the agent.',
  },
  {
    title: 'Policy gate',
    detail: 'maxTx, daily spend ledger and merchant/token allowlists.',
  },
  {
    title: 'Quote cross-check',
    detail: 'EIP-712 amount, recipient, token and chainId versus the intent.',
  },
  {
    title: 'HSP settlement',
    detail: 'create → prepare → finalize → submit → query.',
  },
  {
    title: 'Receipt anchor',
    detail: 'AgentReceiptRegistry on HSK only after attribution verification.',
  },
];

export function ArchitecturePanel() {
  return (
    <Panel
      title="Guardrail pipeline"
      subtitle="Five checks between an agent intent and a signed payment"
      actions={
        <Tag tone="accent" mono>
          before signature
        </Tag>
      }
    >
      <ol className="space-y-0">
        {PIPELINE.map((step, index) => (
          <li
            key={step.title}
            className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-4 last:pb-0"
          >
            {index < PIPELINE.length - 1 ? (
              <span className="absolute bottom-0 left-[13px] top-7 w-px bg-edge" />
            ) : null}
            <span className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full border border-edge bg-elevated text-xs font-medium text-muted">
              {index + 1}
            </span>
            <div className="pt-0.5">
              <div className="text-sm font-medium text-ink">{step.title}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted">
                {step.detail}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-md border border-accent/35 bg-accent/[0.12] px-4 py-3 text-xs leading-relaxed text-muted">
        Denied intents never create an order and never reach the signer. The
        receipt is anchored only after{' '}
        <span className="font-mono text-ink">SETTLED</span> plus attribution
        verification.
      </div>
    </Panel>
  );
}

function EvidenceRow({
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

export function EvidencePanel() {
  return (
    <Panel
      title="On-chain evidence"
      subtitle="Real HSK Chain deployment, separate from the mock fixtures"
      actions={
        <Tag tone="accent" mono>
          chain {STATIC_RECEIPT.chainId}
        </Tag>
      }
    >
      <div className="divide-y divide-edge rounded-lg border border-edge">
        <EvidenceRow label="Registry">
          <CopyValue
            value={RECEIPT_REGISTRY_ADDRESS}
            href={`${STATIC_RECEIPT.explorerUrl}/address/${RECEIPT_REGISTRY_ADDRESS}`}
            display={shortHash(RECEIPT_REGISTRY_ADDRESS, 12, 8)}
          />
          <div className="mt-1 text-[11px] text-faint">
            AgentReceiptRegistry
          </div>
        </EvidenceRow>

        <EvidenceRow label="Deployment TX">
          <a
            href={`${STATIC_RECEIPT.explorerTxUrl}${RECEIPT_DEPLOY_TX}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent transition hover:text-accent-hover hover:underline hover:underline-offset-2"
          >
            View deployment ↗
          </a>
          <div className="mt-1 font-mono text-[11px] text-faint">
            {shortHash(RECEIPT_DEPLOY_TX, 12, 8)}
          </div>
        </EvidenceRow>

        <EvidenceRow label="Deployed">
          <span className="font-mono text-xs text-ink">
            {STATIC_RECEIPT.deployedAt?.slice(0, 10) ?? '—'}
          </span>
          <div className="mt-1 text-[11px] text-faint">
            {STATIC_RECEIPT.chainName} · chain {STATIC_RECEIPT.chainId}
          </div>
        </EvidenceRow>
      </div>
    </Panel>
  );
}
