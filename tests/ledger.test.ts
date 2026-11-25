import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpendLedger } from '../src/core/ledger.js';

function ledgerPath(): string {
  return path.join(
    mkdtempSync(path.join(os.tmpdir(), 'hsp-ledger-')),
    'spend-ledger.json',
  );
}

describe('SpendLedger', () => {
  it('survives re-instantiation and rolls over at UTC midnight (R7)', () => {
    const filePath = ledgerPath();
    const clock = { current: new Date('2026-11-25T23:59:00.000Z') };
    const now = () => clock.current;

    const first = new SpendLedger({ filePath, now });
    expect(first.getSpentToday()).toBe(0n);
    first.addSpend(500n);

    // Simulate a process restart on the same UTC day.
    const restarted = new SpendLedger({ filePath, now });
    expect(restarted.getSpentToday()).toBe(500n);
    restarted.addSpend(250n);
    expect(restarted.getSpentToday()).toBe(750n);

    const file = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
      string,
      string
    >;
    expect(file['2026-11-25']).toBe('750');

    // Advancing past UTC midnight starts a fresh day bucket.
    clock.current = new Date('2026-11-26T00:00:01.000Z');
    expect(restarted.getSpentToday()).toBe(0n);
    restarted.addSpend(200n);
    expect(restarted.getSpentToday()).toBe(200n);

    const afterRollover = new SpendLedger({ filePath, now });
    expect(afterRollover.getSpentToday()).toBe(200n);

    const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
      string,
      string
    >;
    expect(persisted['2026-11-25']).toBe('750');
    expect(persisted['2026-11-26']).toBe('200');
  });

  it('rejects negative additions and corrupt ledger files', () => {
    const filePath = ledgerPath();
    const ledger = new SpendLedger({ filePath });
    expect(() => ledger.addSpend(-1n)).toThrow(/non-negative/);

    const corruptPath = ledgerPath();
    const corrupt = new SpendLedger({ filePath: corruptPath });
    corrupt.addSpend(1n);

    // Corruption must not silently reset the daily limit.
    writeFileSync(corruptPath, '{ "broken": true }', 'utf8');
    expect(() => corrupt.getSpentToday()).toThrow(/Corrupt spend ledger/);
  });
});
