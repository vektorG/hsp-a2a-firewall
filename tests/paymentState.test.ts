import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TERMINAL_PAYMENT_STATES,
  isTerminalPaymentState,
  readLastPayment,
  writeLastPayment,
} from '../src/core/paymentState.js';
import { MERCHANT, TOKEN, createHarness } from './helpers.js';

function checkpointPath(): string {
  return path.join(
    mkdtempSync(path.join(os.tmpdir(), 'hsp-payment-state-')),
    'last-payment.json',
  );
}

describe('resume guard after a policy block', () => {
  it('treats POLICY_BLOCKED as terminal', () => {
    expect(TERMINAL_PAYMENT_STATES).toContain('POLICY_BLOCKED');
    expect(isTerminalPaymentState('POLICY_BLOCKED')).toBe(true);
  });

  it('does not persist a pre-order block, so the next payment is not blocked', async () => {
    const lastPaymentPath = checkpointPath();
    const harness = createHarness({ maxTxAmount: 100n, lastPaymentPath });

    const blocked = await harness.orchestrator.execute({
      merchantName: MERCHANT,
      token: TOKEN,
      amountRaw: '200',
    });

    expect(blocked.state).toBe('FAILED');
    expect(blocked.reason).toBe('EXCEEDS_MAX_TX');
    expect(readLastPayment(lastPaymentPath)).toBeNull();

    const next = await harness.orchestrator.execute({
      merchantName: MERCHANT,
      token: TOKEN,
      amountRaw: '100',
    });

    expect(next.state).toBe('SETTLED');
    expect(next.reason).toBeUndefined();
  });

  it('refuses create_order while a non-terminal payment exists, unless forced', async () => {
    const lastPaymentPath = checkpointPath();
    writeLastPayment(lastPaymentPath, {
      state: 'SUBMITTED',
      order_id: 'order_pending',
      payment_request_id: 'pr_pending',
      payment_id: 'pay_pending',
      merchant_name: MERCHANT,
      token: TOKEN,
      token_total_raw: '1000',
      updated_at: new Date().toISOString(),
    });

    const guard = createHarness({ lastPaymentPath });
    const blocked = await guard.orchestrator.execute({
      merchantName: MERCHANT,
      token: TOKEN,
      amountRaw: '1000',
    });

    expect(blocked.state).toBe('FAILED');
    expect(blocked.reason).toBe('PENDING_PAYMENT_EXISTS');
    expect(guard.client.calls.create_order).toHaveLength(0);

    const forced = createHarness({ lastPaymentPath, force: true });
    const settled = await forced.orchestrator.execute({
      merchantName: MERCHANT,
      token: TOKEN,
      amountRaw: '1000',
    });

    expect(settled.state).toBe('SETTLED');
    expect(forced.client.calls.create_order).toHaveLength(1);
  });

  it('ignores an explicitly persisted POLICY_BLOCKED checkpoint', async () => {
    const lastPaymentPath = checkpointPath();
    writeLastPayment(lastPaymentPath, {
      state: 'POLICY_BLOCKED',
      merchant_name: MERCHANT,
      token: TOKEN,
      token_total_raw: '200',
      updated_at: new Date().toISOString(),
    });

    const harness = createHarness({ lastPaymentPath });
    const result = await harness.orchestrator.execute({
      merchantName: MERCHANT,
      token: TOKEN,
      amountRaw: '1000',
    });

    expect(result.state).toBe('SETTLED');
  });
});
