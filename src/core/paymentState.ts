import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Persisted checkpoint for the in-flight payment (resume guard, PATCH #1a).
 *
 * The file is written on EVERY state transition by `PaymentOrchestrator` when
 * `lastPaymentPath` is configured. It is intentionally a plain JSON document
 * so a cold process (`npm run resume`) can pick up a payment that settled
 * after a local timeout without ever recreating the HSP order.
 */
export interface LastPaymentRecord {
  flow_id?: string;
  payment_request_id?: string;
  order_id?: string;
  payment_id?: string;
  /** PaymentState name, e.g. `SUBMITTED`, `SETTLED` or `FAILED`. */
  state: string;
  merchant_name?: string;
  token?: string;
  token_total_raw?: string;
  /** Present once the on-chain receipt has been recorded (resume idempotency). */
  receipt_tx_hash?: string;
  /** Last observed payment transaction hash, when known. */
  tx_signature?: string | null;
  updated_at: string;
}

/**
 * Terminal states never block a new payment. `POLICY_BLOCKED` is included for
 * forward compatibility: a pre-order policy block leaves no order/signature on
 * the wire, so it must never trip the resume guard.
 */
export const TERMINAL_PAYMENT_STATES = [
  'SETTLED',
  'FAILED',
  'POLICY_BLOCKED',
] as const;

const TERMINAL = new Set<string>(TERMINAL_PAYMENT_STATES);

export function isTerminalPaymentState(state: string): boolean {
  return TERMINAL.has(state);
}

/** Reads the checkpoint, returning `null` when it does not exist yet. */
export function readLastPayment(
  filePath: string,
): LastPaymentRecord | null {
  let text: string;

  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  if (text.trim() === '') {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Corrupt last-payment file ${filePath}: invalid JSON`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `Corrupt last-payment file ${filePath}: expected a JSON object`,
    );
  }

  const record = parsed as Record<string, unknown>;

  if (typeof record.state !== 'string' || record.state.length === 0) {
    throw new Error(
      `Corrupt last-payment file ${filePath}: missing string state`,
    );
  }

  return record as unknown as LastPaymentRecord;
}

/** Atomically writes the checkpoint (temp file + rename). */
export function writeLastPayment(
  filePath: string,
  record: LastPaymentRecord,
): void {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });

  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );
  renameSync(temporaryPath, filePath);
}
