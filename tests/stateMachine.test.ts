import { describe, expect, it } from 'vitest';
import type { PaymentRequest } from '../src/core/stateMachine.js';
import {
  MERCHANT,
  TOKEN,
  createHarness,
  type Harness,
} from './helpers.js';

function payment(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    merchantName: MERCHANT,
    token: TOKEN,
    amountRaw: '1000',
    ...overrides,
  };
}

describe('PaymentOrchestrator', () => {
  it('happy path: INIT -> SETTLED with a complete trace (R8)', async () => {
    const harness = createHarness({ scenario: 'happy' });
    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('SETTLED');
    expect(result.reason).toBeUndefined();
    expect(result.orderId).toBe('order_1');
    expect(result.flowId).toBe('flow_1');
    expect(result.paymentRequestId).toBe('pr_1');
    expect(result.paymentId).toBe('pay_pr_1');
    expect(result.amountRaw).toBe('1000');
    expect(result.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);

    expect(result.trace.map((event) => event.toState)).toEqual([
      'POLICY_CHECKED',
      'ORDER_CREATED',
      'PREPARED',
      'POLICY_CHECKED',
      'SIGNED',
      'FINALIZED',
      'SUBMITTED',
      'POLLING',
      'SETTLED',
    ]);

    for (const event of result.trace) {
      expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
      expect(event.fromState).toBeTypeOf('string');
    }

    const pre = result.trace[0]!;
    expect(pre.fromState).toBe('INIT');
    expect(pre.meta).toMatchObject({
      phase: 'pre_order',
      decision: { allowed: true },
    });

    const post = result.trace[3]!;
    expect(post.meta).toMatchObject({
      phase: 'post_quote',
      decision: { allowed: true },
      quotedTotalRaw: '1000',
    });

    // R1: the orchestrator hands the full server object to the signer.
    expect(harness.signedTypedData).toHaveLength(1);
    expect(harness.signedTypedData[0]!.primaryType).toBe(
      'TransferWithAuthorization',
    );
    expect(harness.signedTypedData[0]!.types.EIP712Domain).toBeDefined();

    // R3: expected_merchant_name on every query.
    expect(harness.client.calls.query_payment.length).toBeGreaterThan(0);
    for (const query of harness.client.calls.query_payment) {
      expect(query.expected_merchant_name).toBe(MERCHANT);
    }

    // R6/R7: receipt + ledger only after settlement.
    expect(harness.receipts).toHaveLength(1);
    expect(harness.receipts[0]).toMatchObject({
      paymentRequestId: 'pr_1',
      merchantName: MERCHANT,
      token: TOKEN,
      amount: 1000n,
    });
    expect(result.receiptTxHash).toBeDefined();
    expect(harness.ledger.getSpentToday()).toBe(1000n);
  });

  it('timeout x2 then finalized: create_order is called exactly once (R3/R4)', async () => {
    const harness = createHarness({ scenario: 'timeout-then-finalized' });
    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('SETTLED');
    expect(harness.client.calls.create_order).toHaveLength(1);
    expect(harness.client.calls.query_payment).toHaveLength(3);
    expect(
      result.trace.filter(
        (event) => event.meta?.status === 'timeout',
      ),
    ).toHaveLength(2);
  });

  it('gives up after three timeout retries without recreating the order (R4)', async () => {
    const harness = createHarness({ scenario: 'always-timeout' });
    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('POLL_TIMEOUT');
    expect(harness.client.calls.create_order).toHaveLength(1);
    expect(harness.client.calls.query_payment).toHaveLength(4);
    expect(result.orderId).toBe('order_1');
    expect(result.paymentRequestId).toBe('pr_1');
    expect(result.paymentId).toBe('pay_pr_1');
  });

  it('re-quotes once on 30043 on the same order and re-runs policy (R2)', async () => {
    const harness = createHarness({ scenario: 'requote-once' });
    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('SETTLED');
    expect(harness.client.calls.create_order).toHaveLength(1);
    expect(harness.client.calls.prepare_payment).toHaveLength(2);

    // Same flow/payment request on the second prepare.
    const [first, second] = harness.client.calls.prepare_payment;
    expect(second!.order_id).toBe(first!.order_id);
    expect(second!.flow_id).toBe(first!.flow_id);
    expect(second!.payment_request_id).toBe(first!.payment_request_id);

    const policyEvents = result.trace.filter(
      (event) =>
        event.toState === 'POLICY_CHECKED' && event.meta?.phase !== undefined,
    );
    expect(policyEvents).toHaveLength(2);
    expect(policyEvents[1]!.meta).toMatchObject({
      phase: 'post_quote',
      quotedTotalRaw: '1007',
    });

    expect(result.trace.some((event) => event.toState === 'REQUOTING')).toBe(true);

    // The signature is over the NEW quote total.
    expect(harness.signedTypedData).toHaveLength(1);
    expect(harness.signedTypedData[0]!.message.value).toBe(1007n);
    expect(harness.ledger.getSpentToday()).toBe(1007n);
  });

  it('re-quotes when quote_expires_at is already in the past (R2)', async () => {
    const harness = createHarness({ scenario: 'expired-quote-once' });
    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('SETTLED');
    expect(harness.client.calls.create_order).toHaveLength(1);
    expect(harness.client.calls.prepare_payment).toHaveLength(2);
    expect(
      result.trace.some(
        (event) =>
          event.toState === 'REQUOTING' &&
          event.meta?.trigger === 'QUOTE_EXPIRES_AT',
      ),
    ).toBe(true);
  });

  it('payment-safe is not settled; only finalized + attribution settles (R3)', async () => {
    let harness!: Harness;
    const snapshots: Array<{
      receipts: number;
      spent: string;
      state: string;
      settled: boolean;
    }> = [];

    harness = createHarness({
      scenario: 'safe-then-finalized',
      onTrace(event) {
        if (event.toState === 'SAFE_AWAITING_FINALITY') {
          snapshots.push({
            receipts: harness.receipts.length,
            spent: harness.ledger.getSpentToday().toString(),
            state: event.toState,
            settled: harness.orchestrator.trace.some(
              (traceEvent) => traceEvent.toState === 'SETTLED',
            ),
          });
        }
      },
    });

    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('SETTLED');
    expect(harness.client.calls.query_payment).toHaveLength(3);
    expect(snapshots).toHaveLength(2);
    for (const snapshot of snapshots) {
      expect(snapshot).toEqual({
        receipts: 0,
        spent: '0',
        state: 'SAFE_AWAITING_FINALITY',
        settled: false,
      });
    }

    const settledIndex = result.trace.findIndex(
      (event) => event.toState === 'SETTLED',
    );
    const lastSafeIndex = result.trace
      .map((event) => event.toState)
      .lastIndexOf('SAFE_AWAITING_FINALITY');
    expect(settledIndex).toBeGreaterThan(lastSafeIndex);
    expect(harness.receipts).toHaveLength(1);
  });

  it('fails with ATTRIBUTION_MISMATCH and records no receipt (R3/R6)', async () => {
    const harness = createHarness({ scenario: 'attribution-mismatch' });
    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('ATTRIBUTION_MISMATCH');
    expect(result.trace.some((event) => event.toState === 'SETTLED')).toBe(false);
    expect(harness.receipts).toHaveLength(0);
    expect(harness.ledger.getSpentToday()).toBe(0n);

    const failure = result.trace.at(-1)!;
    expect(failure.toState).toBe('FAILED');
    expect(failure.meta).toMatchObject({
      attribution_verified: false,
      expected_merchant_name: MERCHANT,
    });
  });

  it('policy block: create_order and signing are never called (R8)', async () => {
    const harness = createHarness({
      scenario: 'policy-block',
      maxTxAmount: 100n,
    });
    const result = await harness.orchestrator.execute(payment({ amountRaw: '200' }));

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('EXCEEDS_MAX_TX');
    expect(harness.client.calls.create_order).toHaveLength(0);
    expect(harness.client.calls.prepare_payment).toHaveLength(0);
    expect(harness.signedTypedData).toHaveLength(0);
    expect(harness.receipts).toHaveLength(0);

    expect(result.trace[0]!.meta).toMatchObject({
      phase: 'pre_order',
      decision: { allowed: false, reason: 'EXCEEDS_MAX_TX' },
    });
  });

  it('policy block: malformed amount never creates an order', async () => {
    const harness = createHarness({ scenario: 'happy' });
    const result = await harness.orchestrator.execute(
      payment({ amountRaw: '1.5' }),
    );

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('INVALID_AMOUNT');
    expect(harness.client.calls.create_order).toHaveLength(0);
    expect(harness.signedTypedData).toHaveLength(0);
  });

  it('payment-failed propagates status_reason (R3)', async () => {
    const harness = createHarness({ scenario: 'payment-failed' });
    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('INSUFFICIENT_FUNDS');

    const failure = result.trace.at(-1)!;
    expect(failure.toState).toBe('FAILED');
    expect(failure.meta).toMatchObject({
      status: 'payment-failed',
      status_reason: 'INSUFFICIENT_FUNDS',
    });
    expect(harness.receipts).toHaveLength(0);
    expect(harness.ledger.getSpentToday()).toBe(0n);
  });
});
