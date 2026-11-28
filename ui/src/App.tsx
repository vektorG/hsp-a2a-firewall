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
type Tab = 'debugger' | 'policy' | 'architecture';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'debugger', label: 'Debugger' },
  { id: 'policy', label: 'Policy & Network' },
  { id: 'architecture', label: 'Architecture' },
];

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
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <path d="M12 3 5 6v5.2c0 4.4 2.9 8.2 7 9.8 4.1-1.6 7-5.4 7-9.8V6l-7-3Z" />
      <path d="M9.2 12.1l1.9 1.9 3.8-3.9" />
    </svg>
  );
}

function TabButtons({
  tab,
  onChange,
  className,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-lg border border-edge bg-surface p-1',
        className,
      )}
    >
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition',
            tab === item.id
              ? 'bg-elevated text-ink'
              : 'text-muted hover:text-ink',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
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
  const [tab, setTab] = useState<Tab>('debugger');
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
  const otherProfile =
    config?.profiles.find((profile) => profile.id !== config.activeProfile) ??
    null;

  if (loading && !config) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-lg border border-edge bg-surface p-8 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-accent/35 bg-accent/[0.12] text-accent">
            <ShieldMark />
          </div>
          <div className="mt-4 text-sm font-medium text-ink">
            Connecting to the trace server…
          </div>
          <div className="mt-1 font-mono text-[11px] text-faint">
            {API_BASE}
          </div>
          {error ? (
            <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-edge bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent/35 bg-accent/[0.12] text-accent">
              <ShieldMark />
            </span>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] font-semibold text-ink">
                A2A Payment Firewall
              </span>
              <span className="hidden rounded-full border border-edge bg-elevated px-2 py-0.5 text-[11px] text-muted sm:inline-flex">
                {TEAM_NAME}
              </span>
            </div>
          </div>

          <TabButtons tab={tab} onChange={setTab} className="hidden md:flex" />

          <div className="flex items-center gap-2">
            {config ? (
              <button
                type="button"
                disabled={switching || !otherProfile}
                onClick={() => {
                  if (otherProfile) {
                    void switchProfile(otherProfile.id);
                  }
                }}
                title={
                  otherProfile
                    ? `Switch to ${otherProfile.chainName}`
                    : 'Network profile'
                }
                className="hidden items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1.5 text-xs text-muted transition hover:border-edge-hover hover:text-ink disabled:cursor-wait disabled:opacity-60 sm:inline-flex"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span className="text-ink">
                  {config.chain.chain_name ?? config.chain.chain_id}
                </span>
                <span className="text-faint">·</span>
                <span className="font-mono text-faint">
                  {config.chain.chain_id}
                </span>
                <svg
                  viewBox="0 0 16 16"
                  className="h-3 w-3 text-faint"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden
                >
                  <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}

            {mode === 'static' ? (
              <span className="hidden rounded-full border border-edge bg-elevated px-3 py-1.5 text-xs text-muted sm:inline-flex">
                Static Demo
              </span>
            ) : (
              <span className="hidden items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs text-success sm:inline-flex">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    connected ? 'bg-success' : 'bg-danger',
                  )}
                />
                Live SSE
              </span>
            )}

            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-edge bg-surface px-3 py-1.5 text-xs text-muted transition hover:border-edge-hover hover:text-ink"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
        <TabButtons
          tab={tab}
          onChange={setTab}
          className="mb-4 w-full justify-between md:hidden"
        />

        {error && config ? (
          <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs text-danger">
            {error}
          </div>
        ) : null}

        {!config ? null : tab === 'debugger' ? (
          <div className="space-y-5">
            <DemoControls
              scenarios={config.scenarios}
              records={payments}
              activeScenario={active?.scenario}
              running={running}
              error={null}
              mode={mode === 'static' ? 'static' : 'live'}
              onRun={(scenario) => {
                void runScenario(scenario);
              }}
            />

            {payments.length > config.scenarios.length ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2">
                <span className="text-xs text-faint">Recent runs</span>
                {payments.slice(0, 12).map((payment) => (
                  <button
                    key={payment.id}
                    type="button"
                    onClick={() => setActiveId(payment.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition',
                      payment.id === active?.id
                        ? 'border-accent/40 bg-accent/[0.12] text-ink'
                        : 'border-edge bg-canvas/40 text-muted hover:border-edge-hover hover:text-ink',
                    )}
                  >
                    {payment.id}
                    <span className="text-faint">·</span>
                    <span
                      className={
                        payment.status === 'FAILED'
                          ? 'text-danger'
                          : payment.status === 'SETTLED'
                            ? 'text-success'
                            : 'text-warning'
                      }
                    >
                      {payment.status}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-8">
                <Timeline
                  record={active}
                  mode={mode === 'static' ? 'static' : 'live'}
                />
              </div>
              <div className="space-y-5 lg:col-span-4">
                <ReceiptPanel record={active} />
                <EvidencePanel />
              </div>
            </div>
          </div>
        ) : tab === 'policy' ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <PolicyPanel
              policy={config.policy}
              chainName={config.chain.chain_name ?? String(config.chain.chain_id)}
              tokenSymbol={config.chain.token.symbol}
              tokenDecimals={config.chain.token.decimals}
              onSave={savePolicy}
            />
            <ChainConfigPanel
              config={config}
              switching={switching}
              onSwitchProfile={(profile) => {
                void switchProfile(profile);
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <ArchitecturePanel />
            </div>
            <div className="space-y-5 lg:col-span-7">
              <WhyPanel />
              <RoadmapPanel />
            </div>
          </div>
        )}
      </main>

      <footer className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-2 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-4 text-xs text-faint">
          <span>
            A2A Payment Firewall · Team {TEAM_NAME} · HashKey Horizon Seoul
            Track 2
          </span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="text-muted transition hover:text-ink"
          >
            GitHub ↗
          </a>
        </div>
      </footer>
    </div>
  );
}
