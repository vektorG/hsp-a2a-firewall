import type { ScenarioId, ScenarioSummary } from '../types';
import { cn } from '../lib/format';
import { Panel, Tag } from './Panel';

interface DemoControlsProps {
  scenarios: ScenarioSummary[];
  running: ScenarioId | null;
  error: string | null;
  mode?: 'live' | 'static';
  onRun: (scenario: ScenarioId) => void;
}

function indexLabel(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export function DemoControls({
  scenarios,
  running,
  error,
  mode = 'live',
  onRun,
}: DemoControlsProps) {
  const isStatic = mode === 'static';
  return (
    <Panel
      index="04 / demo"
      title={isStatic ? 'Recorded demo traces' : 'Firewall scenarios'}
      actions={
        <>
          <Tag tone="mint">mock MCP</Tag>
          <Tag>{isStatic ? 'static fixtures' : 'SSE stream'}</Tag>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-dim">
        <span>
          <span className="text-mint">pass</span> = reaches settlement
        </span>
        <span>
          <span className="text-rose">block</span> = stopped before signature
        </span>
        <span className="text-dim/50">·</span>
        <span>
          {scenarios.length} {isStatic ? 'pre-recorded traces' : 'scenarios'} ·
          one real state machine
        </span>
        {running ? (
          <span className="ml-auto inline-flex items-center gap-2 text-amber">
            <span className="h-1.5 w-1.5 animate-pulse bg-amber" />
            streaming {running}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {scenarios.map((scenario, index) => {
          const blocked = scenario.verdict === 'blocked';
          const isRunning = running === scenario.id;
          return (
            <button
              key={scenario.id}
              type="button"
              disabled={running !== null}
              onClick={() => onRun(scenario.id)}
              className={cn(
                'group relative overflow-hidden border bg-void/40 p-3 text-left transition',
                'disabled:cursor-wait disabled:opacity-60',
                blocked
                  ? 'border-rose/25 hover:border-rose/60 hover:bg-rose/5'
                  : 'border-mint/20 hover:border-mint/50 hover:bg-mint/5',
                isRunning && 'border-amber/60 bg-amber/5',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] text-dim/60">
                  {indexLabel(index)}
                </span>
                <span
                  className={cn(
                    'border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.15em]',
                    blocked
                      ? 'border-rose/30 bg-rose/10 text-rose'
                      : 'border-mint/25 bg-mint/10 text-mint',
                  )}
                >
                  {isRunning ? 'running' : blocked ? 'block' : 'pass'}
                </span>
              </div>
              <div className="mt-2 text-[12px] font-semibold leading-snug text-slate-100">
                {scenario.label}
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-dim">
                {scenario.note}
              </p>
              <div
                className={cn(
                  'mt-3 text-[9px] uppercase tracking-[0.2em]',
                  blocked
                    ? 'text-rose/50 group-hover:text-rose'
                    : 'text-mint/50 group-hover:text-mint',
                )}
              >
                {isRunning
                  ? 'tracing…'
                  : isStatic
                    ? 'inspect trace →'
                    : 'run scenario →'}
              </div>
            </button>
          );
        })}

        <div className="flex min-h-[120px] flex-col justify-between border border-dashed border-edge/50 bg-void/20 p-3">
          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-dim/50">
              guardrail invariant
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-dim">
              Every run starts from the persisted policy and a fresh spend
              ledger. Re-quote scenarios must show{' '}
              <span className="text-amber">prepare ×2</span> with{' '}
              <span className="text-mint">create_order ×1</span>.
            </p>
          </div>
          <div className="mt-3 text-[9px] uppercase tracking-[0.2em] text-dim/40">
            no live MCP calls
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-3 border border-rose/40 bg-rose/10 px-3 py-2 text-[11px] text-rose">
          {error}
        </div>
      ) : null}
    </Panel>
  );
}
