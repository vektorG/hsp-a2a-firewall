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
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] items-start gap-3 px-4 py-3">
      <span className="pt-0.5 text-xs text-muted">{label}</span>
      <div className="min-w-0 text-xs leading-relaxed">{children}</div>
    </div>
  );
}

function BoolBadge({ value }: { value: boolean | undefined }) {
  const enabled = value === true;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium',
        enabled
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-edge bg-elevated text-muted',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          enabled ? 'bg-success' : 'bg-faint',
        )}
      />
      {enabled ? 'Enabled' : 'Disabled'}
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
  const showProfileLabel =
    Boolean(chain.profile_label) && chain.profile_label !== chain.chain_name;

  return (
    <Panel
      title="Runtime chain configuration"
      subtitle="Every value is returned by the server's get_chain_config()."
      actions={<Tag mono>{chain.profile_id}</Tag>}
    >
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {config.profiles.map((profile) => {
          const active = profile.id === config.activeProfile;
          return (
            <button
              key={profile.id}
              type="button"
              disabled={switching}
              onClick={() => onSwitchProfile(profile.id)}
              className={cn(
                'rounded-md border px-3 py-2.5 text-left transition disabled:cursor-wait disabled:opacity-60',
                active
                  ? 'border-accent bg-accent/[0.12]'
                  : 'border-edge bg-canvas/30 hover:border-edge-hover hover:bg-elevated',
              )}
            >
              <span
                className={cn(
                  'block text-sm font-medium',
                  active ? 'text-ink' : 'text-muted',
                )}
              >
                {profile.chainName}
              </span>
              <span className="mt-0.5 block font-mono text-[11px] text-faint">
                {profile.tokenSymbol} · {profile.chainId}
              </span>
            </button>
          );
        })}
      </div>

      {switching ? (
        <div className="mb-3 text-xs text-warning">Switching rail…</div>
      ) : null}

      <div className="divide-y divide-edge rounded-lg border border-edge">
        <Row label="Chain ID">
          <span className="font-mono text-ink">{chain.chain_id}</span>
        </Row>
        <Row label="Chain name">
          <span className="text-ink">{chain.chain_name ?? '—'}</span>
          {showProfileLabel ? (
            <span className="ml-2 text-xs text-muted">
              {chain.profile_label}
            </span>
          ) : null}
        </Row>
        <Row label="Token">
          <span className="text-ink">{token.symbol}</span>
          {token.name ? (
            <span className="ml-2 text-xs text-muted">{token.name}</span>
          ) : null}
        </Row>
        <Row label="Token address">
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
        <Row label="Decimals">
          <span className="font-mono text-ink">{token.decimals}</span>
        </Row>
        <Row label="Payment protocol">
          <span className="font-mono text-ink">
            {chain.payment_protocol ?? '—'}
          </span>
        </Row>
        <Row label="Gas fee advanced">
          <BoolBadge value={chain.gas_fee_advanced} />
        </Row>
        <Row label="Permit2">
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
            <span className="text-muted">Not advertised</span>
          )}
        </Row>
        <Row label="Explorer">
          {chain.explorer_url ? (
            <a
              href={chain.explorer_url}
              target="_blank"
              rel="noreferrer"
              className="text-accent transition hover:text-accent-hover hover:underline hover:underline-offset-2"
            >
              {chain.explorer_url}
            </a>
          ) : (
            <span className="text-muted">—</span>
          )}
        </Row>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-faint">
        The dashboard never hardcodes a chain id, token address, decimals,
        payment protocol or explorer base. Switching profiles calls the server
        and re-renders the same layout.
      </p>
    </Panel>
  );
}
