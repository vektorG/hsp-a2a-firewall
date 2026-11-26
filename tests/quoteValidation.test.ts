import { describe, expect, it } from 'vitest';
import {
  MOCK_EXAMPLE_PAY_TO,
  MOCK_EXAMPLE_PERMIT2,
  MOCK_EXAMPLE_TAMPERED_PAY_TO,
} from '../src/mcp/client.js';
import type {
  PreparePaymentOutput,
  ServerTypedData,
} from '../src/mcp/schemas.js';
import {
  validateQuoteAgainstIntent,
  type PaymentRequest,
} from '../src/core/stateMachine.js';
import {
  ANVIL_ACCOUNT_0,
  MERCHANT,
  TOKEN,
  createHarness,
} from './helpers.js';

function payment(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    merchantName: MERCHANT,
    token: TOKEN,
    amountRaw: '1000',
    ...overrides,
  };
}

async function executeWithMutation(
  mutate: (prepared: PreparePaymentOutput) => void,
) {
  const harness = createHarness({ scenario: 'happy' });
  const realPrepare = harness.client.prepare_payment.bind(harness.client);

  harness.client.prepare_payment = async (input) => {
    const prepared = await realPrepare(input);
    mutate(prepared);
    return prepared;
  };

  const result = await harness.orchestrator.execute(payment());
  return { harness, result };
}

describe('PATCH #0.2: pre-sign quote cross-check', () => {
  it('valid quote passes and the payment settles', async () => {
    const harness = createHarness({ scenario: 'happy' });
    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('SETTLED');
    expect(harness.signedTypedData).toHaveLength(1);
  });

  it('validateQuoteAgainstIntent accepts a matching EIP-3009 payload read-only', async () => {
    const harness = createHarness({ scenario: 'happy' });
    const config = await harness.client.get_chain_config();
    const order = await harness.client.create_order({
      merchant_name: MERCHANT,
      token: TOKEN,
      amount: '1000',
    });
    const prepared = await harness.client.prepare_payment({
      order_id: order.order_id,
      flow_id: order.flow_id,
      payment_request_id: order.payment_request_id,
      payer: ANVIL_ACCOUNT_0.address,
    });
    const before = structuredClone(prepared.eip712);

    const validation = validateQuoteAgainstIntent(
      prepared.eip712,
      {
        payer: ANVIL_ACCOUNT_0.address,
        token: TOKEN,
        tokenTotalRaw: prepared.token_total_raw,
        payTo: prepared.pay_to,
        settlementRecipient: prepared.pay_to,
      },
      config,
    );

    expect(validation).toMatchObject({ valid: true, allowed: true });
    expect(prepared.eip712).toEqual(before);
  });

  it('accepts a matching Permit2 payload', async () => {
    const harness = createHarness({ scenario: 'happy' });
    const config = await harness.client.get_chain_config();

    const eip712: ServerTypedData = {
      domain: {
        // Permit2 domains verify against the Permit2 contract, not the token.
        name: 'Permit2',
        chainId: config.chain_id,
        verifyingContract: MOCK_EXAMPLE_PERMIT2,
      },
      types: {
        PermitTransferFrom: [
          { name: 'permitted', type: 'TokenPermissions' },
          { name: 'spender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
        TokenPermissions: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      primaryType: 'PermitTransferFrom',
      message: {
        from: ANVIL_ACCOUNT_0.address,
        permitted: { token: TOKEN, amount: 1000n },
        spender: MOCK_EXAMPLE_PAY_TO,
        nonce: 1n,
        deadline: 4_102_444_800n,
      },
    };

    const validation = validateQuoteAgainstIntent(
      eip712,
      {
        payer: ANVIL_ACCOUNT_0.address,
        token: TOKEN,
        tokenTotalRaw: '1000',
        payTo: MOCK_EXAMPLE_PAY_TO,
        settlementRecipient: MOCK_EXAMPLE_PAY_TO,
      },
      config,
    );

    expect(validation.valid).toBe(true);
  });

  it('tampered-quote scenario: inflated amount -> POLICY_MISMATCH, never signs', async () => {
    const harness = createHarness({ scenario: 'tampered-quote' });
    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('POLICY_MISMATCH');
    expect(harness.signedTypedData).toHaveLength(0);
    expect(harness.client.calls.finalize_payment).toHaveLength(0);
    expect(harness.receipts).toHaveLength(0);

    const failure = result.trace.at(-1)!;
    expect(failure.toState).toBe('FAILED');
    expect(failure.meta).toMatchObject({
      reason: 'POLICY_MISMATCH',
      phase: 'pre_sign',
      check: 'amount',
    });
  });

  it('tampered recipient -> POLICY_MISMATCH, never signs', async () => {
    const { harness, result } = await executeWithMutation((prepared) => {
      prepared.eip712.message.to = MOCK_EXAMPLE_TAMPERED_PAY_TO;
    });

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('POLICY_MISMATCH');
    expect(harness.signedTypedData).toHaveLength(0);
    expect(result.trace.at(-1)?.meta).toMatchObject({
      phase: 'pre_sign',
      check: 'recipient',
    });
  });

  it('tampered token -> POLICY_MISMATCH, never signs', async () => {
    const { harness, result } = await executeWithMutation((prepared) => {
      prepared.eip712.domain.verifyingContract = MOCK_EXAMPLE_PERMIT2;
    });

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('POLICY_MISMATCH');
    expect(harness.signedTypedData).toHaveLength(0);
    expect(result.trace.at(-1)?.meta).toMatchObject({
      phase: 'pre_sign',
      check: 'token',
    });
  });

  it('tampered chainId -> POLICY_MISMATCH, never signs', async () => {
    const { harness, result } = await executeWithMutation((prepared) => {
      prepared.eip712.domain.chainId = 31_337;
    });

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('POLICY_MISMATCH');
    expect(harness.signedTypedData).toHaveLength(0);
    expect(result.trace.at(-1)?.meta).toMatchObject({
      phase: 'pre_sign',
      check: 'chain_id',
    });
  });
});
