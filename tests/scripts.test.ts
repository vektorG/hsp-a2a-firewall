import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TSX = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

function runScript(
  script: string,
  args: string[],
  env: Record<string, string> = {},
) {
  return spawnSync(TSX, [path.join('scripts', script), ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      MERCHANT_NAME: 'kolit_vlom',
      DEMO_AMOUNT_RAW: '1000',
      ...env,
    },
  });
}

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'hsp-script-test-'));
}

describe('--mock scripts', () => {
  it('preflight prints a config/balance table without RPC calls', () => {
    const result = runScript('preflight.ts', ['--mock']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Mode\s+:\s+mock/);
    expect(result.stdout).toMatch(/Chain\s+:\s+.*133/);
    expect(result.stdout).toMatch(/Token balance\s+:/);
    expect(result.stdout).toMatch(/Allowance\s+:/);
  });

  it('approve reports no approval for an EIP-3009 rail and exits 0', () => {
    const result = runScript('approve.ts', ['--mock']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/no approve needed/i);
  });

  it('demo-payment settles, tags mode=mock and writes a trace JSON', () => {
    const directory = tempDir();
    const checkpointPath = path.join(directory, 'last-payment.json');
    const tracePath = path.join(directory, 'demo-trace.json');

    const result = runScript('demo-payment.ts', ['--mock'], {
      HSP_LAST_PAYMENT_PATH: checkpointPath,
      HSP_DEMO_TRACE_PATH: tracePath,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/payment state: SETTLED/);
    expect(result.stdout).toMatch(/mode=mock: no transaction was broadcast/);

    const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as {
      mode: string;
      mock: boolean;
      outcome: { state: string; txSignature: string };
      trace: Array<{ toState: string }>;
    };
    expect(trace.mode).toBe('mock');
    expect(trace.mock).toBe(true);
    expect(trace.outcome.state).toBe('SETTLED');
    expect(trace.outcome.txSignature).toBe(`0x${'ab'.repeat(32)}`);
    expect(trace.trace.some((event) => event.toState === 'SETTLED')).toBe(true);

    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as {
      state: string;
    };
    expect(checkpoint.state).toBe('SETTLED');
  });

  it('resume finalizes a pending checkpoint and writes a mock receipt', () => {
    const directory = tempDir();
    const checkpointPath = path.join(directory, 'pending.json');

    writeFileSync(
      checkpointPath,
      `${JSON.stringify(
        {
          order_id: 'order_1',
          flow_id: 'flow_1',
          payment_request_id: 'pr_1',
          payment_id: 'pay_pr_1',
          state: 'SUBMITTED',
          merchant_name: 'kolit_vlom',
          token: '0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6',
          token_total_raw: '1000',
          updated_at: '2026-11-27T00:00:00.000Z',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const result = runScript('resume.ts', ['--mock'], {
      HSP_LAST_PAYMENT_PATH: checkpointPath,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/state=SETTLED/);
    expect(result.stdout).toMatch(/mode=mock: no transaction was broadcast/);

    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as {
      state: string;
      receipt_tx_hash?: string;
    };
    expect(checkpoint.state).toBe('SETTLED');
    expect(checkpoint.receipt_tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('resume is a no-op for a terminal checkpoint', () => {
    const directory = tempDir();
    const checkpointPath = path.join(directory, 'terminal.json');

    writeFileSync(
      checkpointPath,
      `${JSON.stringify({ state: 'SETTLED', updated_at: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );

    const result = runScript('resume.ts', ['--mock'], {
      HSP_LAST_PAYMENT_PATH: checkpointPath,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/already terminal/i);
  });
});
