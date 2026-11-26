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
      index="03 / policy"
      title="Spend policy"
      actions={
        <>
          <Tag>persisted local</Tag>
          <Tag tone="mint">pre-sign gate</Tag>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-1.5 block">maxTx / base units</span>
            <input
              className="field"
              value={maxTxAmount}
              onChange={(event) => setMaxTxAmount(event.target.value)}
              inputMode="numeric"
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">dailyLimit / base units</span>
            <input
              className="field"
              value={dailyLimit}
              onChange={(event) => setDailyLimit(event.target.value)}
              inputMode="numeric"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border border-edge/50 bg-void/30 px-3 py-2 text-[10px] text-dim">
          <span className="text-mint/70">active rail</span>
          <span className="text-slate-200">{chainName}</span>
          <span>·</span>
          <span>
            {tokenSymbol} / {tokenDecimals} decimals
          </span>
          <span className="ml-auto text-dim/60">
            over-limit demo = maxTx + 1
          </span>
        </div>

        <label className="block">
          <span className="label mb-1.5 block">allowedMerchants / comma separated</span>
          <input
            className="field"
            value={merchants}
            onChange={(event) => setMerchants(event.target.value)}
            spellCheck={false}
          />
        </label>

        <label className="block">
          <span className="label mb-1.5 block">allowedTokens / one address per line</span>
          <textarea
            className="field min-h-[86px] resize-y leading-relaxed"
            value={tokens}
            onChange={(event) => setTokens(event.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={state.kind === 'saving'}
            className="border border-mint/40 bg-mint/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-mint transition hover:bg-mint/20 disabled:cursor-wait disabled:opacity-50"
          >
            {state.kind === 'saving' ? 'saving…' : 'save policy'}
          </button>

          {state.kind === 'saved' ? (
            <span className="text-[10px] text-mint/80">
              saved to data/policy.json · {state.at}
            </span>
          ) : null}
          {state.kind === 'error' ? (
            <span className="text-[10px] text-rose">{state.message}</span>
          ) : null}
          {state.kind === 'idle' ? (
            <span className="text-[10px] text-dim/60">
              edits apply to the next demo run
            </span>
          ) : null}
        </div>

        <div
          className={cn(
            'border-l pl-3 text-[10px] leading-relaxed text-dim',
            state.kind === 'error' ? 'border-rose/40' : 'border-edge/60',
          )}
        >
          Policy is evaluated twice: once before <span className="text-slate-300">create_order</span>,
          then again on the server-quoted total before signing. A denied intent
          never reaches the signer.
        </div>
      </form>
    </Panel>
  );
}
