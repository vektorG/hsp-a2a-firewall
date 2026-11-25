import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * JSON-file daily spend ledger (R7).
 *
 * The file is keyed by UTC calendar day (`YYYY-MM-DD`), so a process restart
 * on the same day keeps the accumulated spend and the daily limit is NOT
 * reset. A day rollover naturally starts from zero because the new key is
 * absent.
 */
export interface SpendLedgerOptions {
  /** Defaults to `data/spend-ledger.json` relative to the process cwd. */
  filePath?: string;
  /** Injectable clock for tests and deterministic rollover checks. */
  now?: () => Date;
}

type LedgerData = Record<string, string>;

const DEFAULT_LEDGER_PATH = path.join('data', 'spend-ledger.json');
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/;

export class SpendLedger {
  readonly filePath: string;
  readonly #now: () => Date;

  constructor(options: SpendLedgerOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_LEDGER_PATH;
    this.#now = options.now ?? (() => new Date());
  }

  /** UTC day key, e.g. `2026-11-25`. */
  todayKey(): string {
    return this.#now().toISOString().slice(0, 10);
  }

  getSpentToday(): bigint {
    const data = this.#read();
    const raw = data[this.todayKey()];

    if (raw === undefined) {
      return 0n;
    }

    if (!UNSIGNED_INTEGER.test(raw)) {
      throw new Error(
        `Corrupt spend ledger ${this.filePath}: value for ${this.todayKey()} is not an unsigned integer`,
      );
    }

    return BigInt(raw);
  }

  /** Adds `amount` base units to today's bucket and returns the new total. */
  addSpend(amount: bigint): bigint {
    if (amount < 0n) {
      throw new Error('SpendLedger.addSpend requires a non-negative amount');
    }

    const data = this.#read();
    const key = this.todayKey();
    const previousRaw = data[key] ?? '0';

    if (!UNSIGNED_INTEGER.test(previousRaw)) {
      throw new Error(
        `Corrupt spend ledger ${this.filePath}: value for ${key} is not an unsigned integer`,
      );
    }

    const total = BigInt(previousRaw) + amount;
    data[key] = total.toString();
    this.#write(data);
    return total;
  }

  #read(): LedgerData {
    let text: string;

    try {
      text = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }

    if (text.trim() === '') {
      return {};
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Corrupt spend ledger ${this.filePath}: invalid JSON`);
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        `Corrupt spend ledger ${this.filePath}: expected a JSON object keyed by UTC day`,
      );
    }

    const data: LedgerData = {};

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) {
        throw new Error(
          `Corrupt spend ledger ${this.filePath}: invalid value for ${key}`,
        );
      }
      data[key] = value;
    }

    return data;
  }

  #write(data: LedgerData): void {
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true });

    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameSync(temporaryPath, this.filePath);
  }
}
