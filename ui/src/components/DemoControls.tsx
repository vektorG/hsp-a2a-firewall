import type { PaymentRecord, ScenarioId, ScenarioSummary } from '../types';
import { cn } from '../lib/format';

interface DemoControlsProps {
  scenarios: ScenarioSummary[];
  records?: PaymentRecord[];
  activeScenario?: ScenarioId;
  running: ScenarioId | null;
  error: string | null;
  mode?: 'live' | 'static';
  onRun: (scenario: ScenarioId) => void;
}

const SCENARIO_SLUG: Record<ScenarioId, string> = {
  happy: '01-happy',
  'malicious-invoice': '02-malicious-invoice',
  'over-limit': '03-over-limit',
  'untrusted-merchant': '04-untrusted-merchant',
  'tampered-quote': '05-tampered-quote',
  'quote-expired-requote': '06-quote-expired',
  timeout: '07-timeout',
};

function scenarioTitle(label: string): string {
  const parts = label.split(' · ');
  return parts[parts.length - 1] ?? label;
}

export function DemoControls({
  scenarios,
  records = [],
  activeScenario,
  running,
  error,
  mode = 'live',
  onRun,
}: DemoControlsProps) {
  return (
    <section aria-label="Scenarios">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-ink">Scenarios</h2>
          <span className="text-xs text-faint">
            {mode === 'static'
              ? `${scenarios.length} pre-recorded traces`
              : `${scenarios.length} available · one real state machine`}
          </span>
        </div>
        {running ? (
          <span className="inline-flex items-center gap-2 text-xs text-warning">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
            Running {SCENARIO_SLUG[running]}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {scenarios.map((scenario) => {
          const record = records.find(
            (payment) => payment.scenario === scenario.id,
          );
          const blocked = scenario.verdict === 'blocked';
          const active = activeScenario === scenario.id;
          const isRunning = running === scenario.id;

          return (
            <button
              key={scenario.id}
              type="button"
              disabled={running !== null}
              onClick={() => onRun(scenario.id)}
              className={cn(
                'rounded-lg border bg-surface p-4 text-left transition disabled:cursor-wait disabled:opacity-70',
                active
                  ? 'border-accent bg-accent/[0.06]'
                  : 'border-edge hover:border-edge-hover hover:bg-elevated',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-faint">
                  {record?.id ?? SCENARIO_SLUG[scenario.id]}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium',
                    isRunning
                      ? 'border-warning/30 bg-warning/10 text-warning'
                      : blocked
                        ? 'border-danger/30 bg-danger/10 text-danger'
                        : 'border-success/30 bg-success/10 text-success',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      isRunning
                        ? 'animate-pulse bg-warning'
                        : blocked
                          ? 'bg-danger'
                          : 'bg-success',
                    )}
                  />
                  {isRunning ? 'RUN' : blocked ? 'BLOCKED' : 'PASS'}
                </span>
              </div>
              <div className="mt-2 text-sm font-semibold text-ink">
                {scenarioTitle(scenario.label)}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {scenario.note}
              </p>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs text-danger">
          {error}
        </div>
      ) : null}
    </section>
  );
}
