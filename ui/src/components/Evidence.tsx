import {
  GITHUB_URL,
  RECEIPT_DEPLOY_TX,
  RECEIPT_REGISTRY_ADDRESS,
  STATIC_RECEIPT,
  TEAM_NAME,
} from '../staticPreview';
import { shortHash } from '../lib/format';
import { CopyValue } from './CopyValue';
import { Panel, Tag } from './Panel';

const PIPELINE = [
  {
    id: '01',
    title: 'Agent intent',
    detail: 'merchant · token · amount',
  },
  {
    id: '02',
    title: 'Policy gate',
    detail: 'maxTx · daily ledger · allowlists',
  },
  {
    id: '03',
    title: 'Quote cross-check',
    detail: 'EIP-712 amount / recipient / token / chainId',
  },
  {
    id: '04',
    title: 'HSP settlement',
    detail: 'create → prepare → finalize → submit → query',
  },
  {
    id: '05',
    title: 'Receipt anchor',
    detail: 'AgentReceiptRegistry on HSK after attribution',
  },
];

export function ArchitecturePanel() {
  return (
    <Panel
      index="01 / architecture"
      title="Guardrail pipeline"
      actions={<Tag tone="mint">before signature</Tag>}
    >
      <div className="space-y-2">
        {PIPELINE.map((step, index) => (
          <div
            key={step.id}
            className="grid grid-cols-[30px_minmax(0,1fr)] items-start gap-3 border border-edge/60 bg-void/30 px-3 py-2"
          >
            <span className="text-[10px] text-mint/60">{step.id}</span>
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-semibold text-slate-100">
                  {step.title}
                </span>
                {index < PIPELINE.length - 1 ? (
                  <span className="text-[9px] text-dim/50">↓</span>
                ) : null}
              </div>
              <div className="text-[10px] leading-relaxed text-dim">
                {step.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 border-l border-mint/30 pl-3 text-[10px] leading-relaxed text-dim">
        Denied intents never create an order and never reach the signer. The
        receipt is anchored only after{' '}
        <span className="text-slate-300">SETTLED</span> plus attribution
        verification.
      </p>
    </Panel>
  );
}

export function EvidencePanel() {
  return (
    <Panel
      index="09 / on-chain evidence"
      title="Receipt registry"
      actions={<Tag tone="sky">HSK Chain</Tag>}
    >
      <div className="space-y-3">
        <div>
          <div className="label mb-1">AgentReceiptRegistry</div>
          <CopyValue
            value={RECEIPT_REGISTRY_ADDRESS}
            href={`${STATIC_RECEIPT.explorerUrl}/address/${RECEIPT_REGISTRY_ADDRESS}`}
            display={shortHash(RECEIPT_REGISTRY_ADDRESS, 12, 8)}
          />
          <div className="mt-1 text-[9px] text-dim/60">
            chain {STATIC_RECEIPT.chainId} · deployed{' '}
            {STATIC_RECEIPT.deployedAt?.slice(0, 10)}
          </div>
        </div>

        <div className="border-t border-edge/50 pt-3">
          <div className="label mb-1">deployment tx</div>
          <a
            href={`${STATIC_RECEIPT.explorerTxUrl}${RECEIPT_DEPLOY_TX}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-sky/90 underline decoration-sky/30 underline-offset-2 hover:text-sky"
          >
            view on explorer ↗
          </a>
          <div className="mt-1 text-[9px] text-dim/60">
            {shortHash(RECEIPT_DEPLOY_TX, 12, 8)}
          </div>
        </div>

        <div className="border-t border-edge/50 pt-3">
          <div className="label mb-1">team</div>
          <div className="text-[11px] text-slate-200">{TEAM_NAME}</div>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-[10px] text-mint/90 underline decoration-mint/30 underline-offset-2 hover:text-mint"
          >
            github.com/vektorG/hsp-a2a-firewall ↗
          </a>
        </div>
      </div>
    </Panel>
  );
}
