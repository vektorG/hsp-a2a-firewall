import { useEffect, useRef, useState } from 'react';
import { API_BASE, api } from './api';
import type {
  PaymentRecord,
  PolicyFile,
  ProfileId,
  ScenarioId,
  ServerConfig,
  StreamEvent,
} from './types';
import { cn } from './lib/format';
import { ChainConfigPanel } from './components/ChainConfigPanel';
import { DemoControls } from './components/DemoControls';
import { ArchitecturePanel, EvidencePanel } from './components/Evidence';
import { PolicyPanel } from './components/PolicyPanel';
import { ReceiptPanel } from './components/ReceiptPanel';
import { RoadmapPanel, WhyPanel } from './components/Roadmap';
import { Timeline } from './components/Timeline';
import {
  GITHUB_URL,
  STATIC_PAYMENTS,
  staticConfig,
  staticPaymentForScenario,
  TEAM_NAME,
} from './staticPreview';

type Mode = 'loading' | 'live' | 'static';

const IS_GITHUB_PAGES =
  typeof window !== 'undefined' &&
  window.location.hostname.endsWith('github.io');

function sortPayments(payments: PaymentRecord[]): PaymentRecord[] {
  return [...payments].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function upsertPayment(
  payments: PaymentRecord[],
  incoming: PaymentRecord,
): PaymentRecord[] {
  const existing = payments.some((payment) => payment.id === incoming.id);
  if (!existing) {
    return sortPayments([incoming, ...payments]);
  }
  return payments.map((payment) =>
    payment.id === incoming.id ? incoming : payment,
  );
}

function ShieldMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden
    >
      <path d="M12 3 5 6v5.2c0 4.4 2.9 8.2 7 9.8 4.1-1.6 7-5.4 7-9.8V6l-7-3Z" />
      <path d="M9.2 12.1l1.9 1.9 3.8-3.9" />
    </svg>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() =>
    IS_GITHUB_PAGES ? 'static' : 'loading',
  );
  const [config, setConfig] = useState<ServerConfig | null>(() =>
    IS_GITHUB_PAGES ? staticConfig() : null,
  );
  const [payments, setPayments] = useState<PaymentRecord[]>(() =>
    IS_GITHUB_PAGES ? [...STATIC_PAYMENTS] : [],
  );
  const [activeId, setActiveId] = useState<string | null>(() =>
    IS_GITHUB_PAGES ? STATIC_PAYMENTS[0]?.id ?? null : null,
  );
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(!IS_GITHUB_PAGES);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<ScenarioId | null>(null);
  const [switching, setSwitching] = useState(false);
  const activeIdRef = useRef<string | null>(null);

  function enterStaticPreview(): void {
    setMode('static');
    setConfig(staticConfig());
    setPayments([...STATIC_PAYMENTS]);
    setActiveId(STATIC_PAYMENTS[0]?.id ?? null);
    setConnected(false);
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (IS_GITHUB_PAGES) {
      return;
    }

    let cancelled = false;

    api
      .getConfig()
      .then((nextConfig) => {
        if (cancelled) {
          return;
        }
        setMode('live');
        setConfig(nextConfig);
        setLoading(false);

        void api
          .getPayments()
          .then((result) => {
            if (cancelled) {
              return;
            }
            const sorted = sortPayments(result.payments);
            setPayments(sorted);
            setActiveId((current) => current ?? sorted[0]?.id ?? null);
          })
          .catch(() => {
            // The live config loaded; an empty history is still a live UI.
          });
      })
      .catch(() => {
        if (!cancelled) {
          enterStaticPreview();
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'live') {
      return;
    }

    const source = new EventSource(`${API_BASE}/api/stream`);

    source.onopen = () => {
      setConnected(true);
    };

    source.onerror = () => {
      setConnected(false);
    };

    source.onmessage = (message) => {
      let event: StreamEvent;
      try {
        event = JSON.parse(message.data as string) as StreamEvent;
      } catch {
        return;
      }

      switch (event.type) {
        case 'hello':
          setConnected(true);
          break;
        case 'trace':
          setPayments((current) =>
            current.map((payment) =>
              payment.id === event.paymentId
                ? { ...payment, trace: [...payment.trace, event.event] }
                : payment,
            ),
          );
          break;
        case 'payment':
          setPayments((current) => upsertPayment(current, event.payment));
          if (event.payment.status === 'running') {
            setActiveId(event.payment.id);
          } else if (activeIdRef.current === null) {
            setActiveId(event.payment.id);
          }
          break;
        case 'policy':
          setConfig((current) =>
            current ? { ...current, policy: event.policy } : current,
          );
          break;
        case 'profile':
          setConfig(event.config);
          break;
      }
    };

    return () => {
      source.close();
    };
  }, [mode]);

  async function runScenario(scenario: ScenarioId): Promise<void> {
    setError(null);

    if (mode === 'static') {
      const record = staticPaymentForScenario(scenario);
      if (record) {
        setActiveId(record.id);
      }
      return;
    }

    setRunning(scenario);
    try {
      const record = await api.runDemo(scenario);
      setPayments((current) => upsertPayment(current, record));
      setActiveId(record.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(null);
    }
  }

  async function savePolicy(policy: PolicyFile): Promise<PolicyFile> {
    if (mode === 'static') {
      setConfig((current) => (current ? { ...current, policy } : current));
      return policy;
    }

    const result = await api.savePolicy(policy);
    setConfig((current) =>
      current ? { ...current, policy: result.policy } : current,
    );
    return result.policy;
  }

  async function switchProfile(profile: ProfileId): Promise<void> {
    setSwitching(true);
    setError(null);

    if (mode === 'static') {
      setConfig((current) => {
        const next = staticConfig(profile);
        return { ...next, policy: current?.policy ?? next.policy };
      });
      setSwitching(false);
      return;
    }

    try {
      const nextConfig = await api.setProfile(profile);
      setConfig(nextConfig);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSwitching(false);
    }
  }

  const active =
    payments.find((payment) => payment.id === activeId) ?? payments[0] ?? null;

  if (loading && !config) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="border border-mint/25 bg-panel/80 px-8 py-6 text-center shadow-glow">
          <div className="text-2xl text-mint/60 animate-flicker">▚</div>
          <div className="mt-3 text-[11px] uppercase tracking-[0.3em] text-mint">
            booting trace console
          </div>
          <div className="mt-2 text-[10px] text-dim">{API_BASE}</div>
          {error ? (
            <div className="mt-4 max-w-sm border border-rose/40 bg-rose/10 px-3 py-2 text-[10px] text-rose">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-30 border-b border-edge/80 bg-void/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center border border-mint/40 bg-mint/5 text-mint shadow-glow">
              <ShieldMark />
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-[0.4em] text-mint/60">
                agent-to-agent guardrail
              </div>
              <h1 className="text-lg font-semibold tracking-[0.12em] text-slate-100 sm:text-xl">
                A2A PAYMENT{' '}
                <span className="text-mint">FIREWALL</span>
              </h1>
              <div className="text-[10px] text-dim">
                team <span className="text-slate-300">{TEAM_NAME}</span>
                <span className="mx-1.5 text-dim/40">·</span>
                mock-driven trace console
                <span className="mx-1.5 text-dim/40">·</span>
                no live MCP calls
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="border border-mint/30 bg-mint/5 px-3 py-1.5 shadow-glow">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping bg-mint opacity-60" />
                  <span className="relative inline-flex h-2 w-2 bg-mint" />
                </span>
                <span className="text-[8px] uppercase tracking-[0.28em] text-mint/70">
                  active network
                </span>
              </div>
              <div className="mt-0.5 text-[12px] font-semibold text-mint">
                {config?.chain.chain_name ?? 'connecting'}
                <span className="ml-1.5 text-[10px] font-normal text-mint/50">
                  #{config?.chain.chain_id ?? '—'}
                </span>
              </div>
              <div className="text-[9px] text-dim">
                {config?.chain.token.symbol ?? '—'}
                {config?.chain.payment_protocol
                  ? ` · ${config.chain.payment_protocol}`
                  : ''}
              </div>
            </div>

            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="border border-edge/80 bg-void/40 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-dim transition hover:border-mint/40 hover:text-mint"
            >
              GitHub ↗
            </a>

            {mode === 'static' ? (
              <div className="border border-mint/30 bg-mint/5 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-mint">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 bg-mint" />
                  STATIC DEMO · GITHUB PAGES
                </div>
                <div className="mt-0.5 text-[9px] tracking-normal text-dim">
                  3 pre-recorded traces
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'border px-3 py-2 text-[10px] uppercase tracking-[0.18em]',
                  connected
                    ? 'border-mint/25 bg-void/40 text-mint'
                    : 'border-rose/30 bg-rose/5 text-rose',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-1.5 w-1.5',
                      connected ? 'bg-mint' : 'bg-rose',
                    )}
                  />
                  SSE {connected ? 'live' : 'offline'}
                </div>
                <div className="mt-0.5 text-[9px] tracking-normal text-dim">
                  /api/stream
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        {error && config ? (
          <div className="border border-rose/40 bg-rose/10 px-3 py-2 text-[11px] text-rose">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-5">
            <ArchitecturePanel />
          </div>
          <div className="xl:col-span-3">
            <EvidencePanel />
          </div>
          <div className="xl:col-span-4">
            <RoadmapPanel />
          </div>
        </div>

        {config ? (
          <>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              <div className="xl:col-span-7">
                <ChainConfigPanel
                  config={config}
                  switching={switching}
                  onSwitchProfile={(profile) => {
                    void switchProfile(profile);
                  }}
                />
              </div>
              <div className="xl:col-span-5">
                <PolicyPanel
                  policy={config.policy}
                  chainName={
                    config.chain.chain_name ?? String(config.chain.chain_id)
                  }
                  tokenSymbol={config.chain.token.symbol}
                  tokenDecimals={config.chain.token.decimals}
                  onSave={savePolicy}
                />
              </div>
            </div>

            <DemoControls
              scenarios={config.scenarios}
              running={running}
              error={null}
              mode={mode === 'static' ? 'static' : 'live'}
              onRun={(scenario) => {
                void runScenario(scenario);
              }}
            />

            {payments.length > 0 ? (
              <div className="flex items-center gap-2 overflow-x-auto border border-edge/60 bg-panel/50 px-3 py-2">
                <span className="shrink-0 text-[9px] uppercase tracking-[0.2em] text-dim/60">
                  run history
                </span>
                {payments.slice(0, 12).map((payment) => (
                  <button
                    key={payment.id}
                    type="button"
                    onClick={() => setActiveId(payment.id)}
                    className={cn(
                      'shrink-0 border px-2 py-1 text-[9px] transition',
                      payment.id === active?.id
                        ? 'border-mint/40 bg-mint/10 text-mint'
                        : 'border-edge/60 bg-void/30 text-dim hover:border-edge hover:text-slate-200',
                    )}
                  >
                    {payment.id}
                    <span className="mx-1 text-dim/40">·</span>
                    {payment.scenario}
                    <span
                      className={cn(
                        'ml-1.5',
                        payment.status === 'FAILED'
                          ? 'text-rose'
                          : payment.status === 'SETTLED'
                            ? 'text-mint'
                            : 'text-amber',
                      )}
                    >
                      {payment.status}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              <div className="xl:col-span-8">
                <Timeline
                  record={active}
                  mode={mode === 'static' ? 'static' : 'live'}
                />
              </div>
              <div className="space-y-4 xl:col-span-4">
                <ReceiptPanel record={active} />
                <WhyPanel />
              </div>
            </div>
          </>
        ) : null}
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge/60 pt-3 text-[9px] uppercase tracking-[0.18em] text-dim/50">
          <span>
            a2a payment firewall · team {TEAM_NAME} · stateMachine +
            MockHspMcpClient · mock only
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <span>payment rail derived at runtime · receipt anchor HSK Chain</span>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="text-mint/70 underline decoration-mint/30 underline-offset-2 hover:text-mint"
            >
              GitHub ↗
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
