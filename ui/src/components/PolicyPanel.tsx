import { useEffect, useState, type FormEvent } from 'react';
import type { PolicyFile } from '../types';
import { cn } from '../lib/format';
import { Panel, Tag } from './Panel';

interface PolicyPanelProps {
  policy: PolicyFile;
  chainName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  onSave: (policy: PolicyFile) => Promise<PolicyFile>;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error'; message: string };

const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function PolicyPanel({
  policy,
  chainName,
  tokenSymbol,
  tokenDecimals,
  onSave,
}: PolicyPanelProps) {
  const [maxTxAmount, setMaxTxAmount] = useState(policy.maxTxAmount);
  const [dailyLimit, setDailyLimit] = useState(policy.dailyLimit);
  const [merchants, setMerchants] = useState(policy.allowedMerchants.join(', '));
  const [tokens, setTokens] = useState(policy.allowedTokens.join('\n'));
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  useEffect(() => {
    setMaxTxAmount(policy.maxTxAmount);
    setDailyLimit(policy.dailyLimit);
    setMerchants(policy.allowedMerchants.join(', '));
    setTokens(policy.allowedTokens.join('\n'));
  }, [policy]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setState({ kind: 'saving' });

    const next: PolicyFile = {
      maxTxAmount: maxTxAmount.trim(),
      dailyLimit: dailyLimit.trim(),
      allowedMerchants: merchants
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      allowedTokens: tokens
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    };

    if (
      !UNSIGNED_INTEGER.test(next.maxTxAmount) ||
      !UNSIGNED_INTEGER.test(next.dailyLimit)
    ) {
      setState({
        kind: 'error',
        message: 'maxTx and dailyLimit must be unsigned integer base units.',
      });
      return;
    }

    if (next.allowedTokens.some((token) => !EVM_ADDRESS.test(token))) {
      setState({
        kind: 'error',
        message: 'Every allowed token must be a 42-character EVM address.',
      });
      return;
    }

    try {
      const saved = await onSave(next);
      setState({
        kind: 'saved',
        at: new Date().toLocaleTimeString([], { hour12: false }),
      });
      setMaxTxAmount(saved.maxTxAmount);
      setDailyLimit(saved.dailyLimit);
      setMerchants(saved.allowedMerchants.join(', '));
      setTokens(saved.allowedTokens.join('\n'));
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <Panel
      title="Spend policy"
      subtitle="Evaluated twice: before create_order and again on the server quote."
      actions={
        <>
          <Tag mono>pre-sign gate</Tag>
          <Tag>persisted</Tag>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-1.5 block">
              Max transaction (base units)
            </span>
            <input
              className="field font-mono"
              value={maxTxAmount}
              onChange={(event) => setMaxTxAmount(event.target.value)}
              inputMode="numeric"
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">
              Daily limit (base units)
            </span>
            <input
              className="field font-mono"
              value={dailyLimit}
              onChange={(event) => setDailyLimit(event.target.value)}
              inputMode="numeric"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-edge bg-canvas/30 px-3 py-2.5 text-xs text-muted">
          <span className="text-ink">{chainName}</span>
          <span className="text-faint">·</span>
          <span className="font-mono">
            {tokenSymbol} / {tokenDecimals} decimals
          </span>
          <span className="ml-auto text-[11px] text-faint">
            Over-limit demo = maxTx + 1
          </span>
        </div>

        <label className="block">
          <span className="label mb-1.5 block">
            Allowed merchants (comma separated)
          </span>
          <input
            className="field"
            value={merchants}
            onChange={(event) => setMerchants(event.target.value)}
            spellCheck={false}
          />
        </label>

        <label className="block">
          <span className="label mb-1.5 block">
            Allowed tokens (one address per line)
          </span>
          <textarea
            className="field min-h-[96px] resize-y font-mono leading-relaxed"
            value={tokens}
            onChange={(event) => setTokens(event.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={state.kind === 'saving'}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-50"
          >
            {state.kind === 'saving' ? 'Saving…' : 'Save policy'}
          </button>

          {state.kind === 'saved' ? (
            <span className="text-xs text-success">
              Saved to data/policy.json · {state.at}
            </span>
          ) : null}
          {state.kind === 'error' ? (
            <span className="text-xs text-danger">{state.message}</span>
          ) : null}
          {state.kind === 'idle' ? (
            <span className="text-xs text-faint">
              Edits apply to the next demo run.
            </span>
          ) : null}
        </div>

        <div
          className={cn(
            'rounded-md border-l-2 pl-3 text-xs leading-relaxed text-faint',
            state.kind === 'error' ? 'border-danger/60' : 'border-edge',
          )}
        >
          A denied intent never reaches the signer. The post-quote check
          re-validates the server total against the approved intent before any
          EIP-712 signature is produced.
        </div>
      </form>
    </Panel>
  );
}
