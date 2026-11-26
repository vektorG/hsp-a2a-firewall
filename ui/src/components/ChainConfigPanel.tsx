import type { ReactNode } from 'react';
import type { ProfileId, ServerConfig } from '../types';
import { cn, shortHash } from '../lib/format';
import { CopyValue } from './CopyValue';
import { Panel, Tag } from './Panel';

interface ChainConfigPanelProps {
  config: ServerConfig;
  switching: boolean;
  onSwitchProfile: (profile: ProfileId) => void;
}

function Row({
  label,
  children,
  mono = true,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] items-start gap-3 border-b border-edge/40 py-2 last:border-b-0">
      <span className="label pt-0.5">{label}</span>
      <div
        className={cn(
          'min-w-0 text-xs leading-relaxed',
          mono ? 'font-mono' : 'font-sans',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function BoolBadge({ value }: { value: boolean | undefined }) {
  const enabled = value === true;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em]',
        enabled
          ? 'border-mint/30 bg-mint/10 text-mint'
          : 'border-edge/80 bg-void/40 text-dim',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5',
          enabled ? 'bg-mint' : 'bg-dim/60',
        )}
      />
      {enabled ? 'enabled' : 'disabled'}
    </span>
  );
}

export function ChainConfigPanel({
  config,
  switching,
  onSwitchProfile,
}: ChainConfigPanelProps) {
  const chain = config.chain;
  const token = chain.token;

  return (
    <Panel
      index="02 / chain_config"
      title="Runtime chain configuration"
      actions={
        <>
          <Tag tone="mint">get_chain_config()</Tag>
          <Tag>profile: {chain.profile_id}</Tag>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {config.profiles.map((profile) => {
          const active = profile.id === config.activeProfile;
          return (
            <button
              key={profile.id}
              type="button"
              disabled={switching}
              onClick={() => onSwitchProfile(profile.id)}
              className={cn(
                'group border px-3 py-2 text-left transition disabled:cursor-wait disabled:opacity-60',
                active
                  ? 'border-mint/50 bg-mint/10 text-mint shadow-glow'
                  : 'border-edge/80 bg-void/40 text-dim hover:border-mint/30 hover:text-slate-200',
              )}
            >
              <span className="block text-[10px] uppercase tracking-[0.18em]">
                {profile.chainName}
              </span>
              <span className="mt-0.5 block text-[10px] text-dim/80">
                {profile.tokenSymbol} · chain {profile.chainId}
              </span>
            </button>
          );
        })}
        <span className="flex items-center px-2 text-[10px] text-dim/60">
          {switching ? 'switching rail…' : 'switch rail →'}
        </span>
      </div>

      <div className="border border-edge/50 bg-void/30 px-3">
        <Row label="chain_id">
          <span className="text-mint">{chain.chain_id}</span>
        </Row>
        <Row label="chain_name">
          <span className="text-slate-100">{chain.chain_name ?? '—'}</span>
          <span className="ml-2 text-[10px] text-dim">
            {chain.profile_label}
          </span>
        </Row>
        <Row label="token.symbol">
          <span className="text-slate-100">{token.symbol}</span>
          {token.name ? (
            <span className="ml-2 text-[10px] text-dim">{token.name}</span>
          ) : null}
        </Row>
        <Row label="token.address">
          <CopyValue
            value={token.address}
            href={
              chain.explorer_address_url
                ? `${chain.explorer_address_url}${token.address}`
                : undefined
            }
            display={shortHash(token.address, 12, 8)}
          />
        </Row>
        <Row label="token.decimals">
          <span className="text-slate-100">{token.decimals}</span>
        </Row>
        <Row label="payment_protocol">
          <span className="text-sky">{chain.payment_protocol ?? '—'}</span>
        </Row>
        <Row label="gas_fee_advanced">
          <BoolBadge value={chain.gas_fee_advanced} />
        </Row>
        <Row label="permit2">
          {chain.permit2 ? (
            <CopyValue
              value={chain.permit2}
              href={
                chain.explorer_address_url
                  ? `${chain.explorer_address_url}${chain.permit2}`
                  : undefined
              }
              display={shortHash(chain.permit2, 12, 8)}
            />
          ) : (
            <span className="text-dim">not advertised</span>
          )}
        </Row>
        <Row label="explorer">
          {chain.explorer_url ? (
            <a
              href={chain.explorer_url}
              target="_blank"
              rel="noreferrer"
              className="text-mint/90 underline decoration-mint/30 underline-offset-2 hover:text-mint"
            >
              {chain.explorer_url}
            </a>
          ) : (
            <span className="text-dim">—</span>
          )}
        </Row>
      </div>

      <p className="mt-3 border-l border-mint/30 pl-3 text-[10px] leading-relaxed text-dim">
        Every value above is returned by the mock server&apos;s{' '}
        <span className="text-mint/80">get_chain_config</span>. The dashboard
        never hardcodes a chain id, token address, decimals, protocol or
        explorer base.
      </p>
    </Panel>
  );
}
