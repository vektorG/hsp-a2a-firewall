import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LocalAccount } from 'viem';
import { signServerTypedData } from '../src/core/eip712.js';
import type { PaymentRequest } from '../src/core/stateMachine.js';
import { HspMcpError } from '../src/mcp/client.js';
import { HSP_ERROR_CODES } from '../src/mcp/schemas.js';
import {
  ANVIL_ACCOUNT_0,
  ANVIL_PRIVATE_KEY_0,
  MERCHANT,
  TOKEN,
  createHarness,
} from './helpers.js';

function payment(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return { merchantName: MERCHANT, token: TOKEN, amountRaw: '1000', ...overrides };
}

function sourceFiles(base: string): string[] {
  const root = path.join(process.cwd(), base);
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((rel) => rel.endsWith('.ts'))
    .map((rel) => path.join(root, rel));
}

describe('C1: server eip712 is signed verbatim', () => {
  it('signServerTypedData strips only EIP712Domain and forwards the rest by reference', async () => {
    const { client } = createHarness();
    const order = await client.create_order({
      merchant_name: MERCHANT,
      token: TOKEN,
      amount: '5000',
    });
    const prepared = await client.prepare_payment({
      order_id: order.order_id,
      flow_id: order.flow_id,
      payment_request_id: order.payment_request_id,
      payer: ANVIL_ACCOUNT_0.address,
    });
    const before = structuredClone(prepared.eip712);

    let seen: Record<string, unknown> | undefined;
    const spy = {
      ...ANVIL_ACCOUNT_0,
      signTypedData: async (params: unknown) => {
        seen = params as Record<string, unknown>;
        return ANVIL_ACCOUNT_0.signTypedData(params as never);
      },
    } as unknown as LocalAccount;

    await signServerTypedData(spy, prepared.eip712);

    const { EIP712Domain: _omitted, ...expectedTypes } = prepared.eip712.types;
    expect(seen).toBeDefined();
    expect(seen!.types).not.toHaveProperty('EIP712Domain');
    expect(seen!.types).toEqual(expectedTypes);
    expect(seen!.domain).toBe(prepared.eip712.domain);
    expect(seen!.primaryType).toBe(prepared.eip712.primaryType);
    expect(seen!.message).toBe(prepared.eip712.message);
    // The server object itself must not be mutated.
    expect(prepared.eip712).toEqual(before);
    expect(prepared.eip712.types.EIP712Domain).toBeDefined();
  });

  it('the orchestrator hands the exact prepare_payment eip712 object to the signer', async () => {
    const harness = createHarness({ scenario: 'happy' });
    const realPrepare = harness.client.prepare_payment.bind(harness.client);
    let served: unknown;
    harness.client.prepare_payment = async (input) => {
      const output = await realPrepare(input);
      served = output.eip712;
      return output;
    };

    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('SETTLED');
    expect(harness.signedTypedData).toHaveLength(1);
    expect(harness.signedTypedData[0]).toBe(served);
  });
});

describe('C2: re-quote is bounded, on the same order, and re-checks policy', () => {
  it('a second 30043 fails QUOTE_EXPIRED: 2 prepares, 1 create_order, nothing signed', async () => {
    const harness = createHarness({ scenario: 'happy' });
    harness.client.prepare_payment = async (input) => {
      harness.client.calls.prepare_payment.push(input);
      throw new HspMcpError(HSP_ERROR_CODES.QUOTE_EXPIRED, 'quote expired');
    };

    const result = await harness.orchestrator.execute(payment());

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('QUOTE_EXPIRED');
    expect(harness.client.calls.create_order).toHaveLength(1);
    expect(harness.client.calls.prepare_payment).toHaveLength(2);
    expect(harness.signedTypedData).toHaveLength(0);
    expect(harness.client.calls.finalize_payment).toHaveLength(0);
    expect(harness.receipts).toHaveLength(0);
    expect(result.trace.filter((e) => e.toState === 'REQUOTING')).toHaveLength(1);
  });

  it('policy is re-run on the re-quoted total and blocks signing (mock re-quote adds 7)', async () => {
    const harness = createHarness({ scenario: 'requote-once', maxTxAmount: 1000n });

    const result = await harness.orchestrator.execute(payment({ amountRaw: '1000' }));

    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('EXCEEDS_MAX_TX');
    expect(harness.client.calls.create_order).toHaveLength(1);
    expect(harness.client.calls.prepare_payment).toHaveLength(2);
    expect(harness.signedTypedData).toHaveLength(0);
    expect(harness.client.calls.finalize_payment).toHaveLength(0);

    const post = result.trace.find(
      (e) => e.toState === 'POLICY_CHECKED' && e.meta?.phase === 'post_quote',
    );
    expect(post?.meta).toMatchObject({
      quotedTotalRaw: '1007',
      decision: { allowed: false, reason: 'EXCEEDS_MAX_TX' },
    });
  });
});

describe('C5: no hardcoded chain configuration in src/core', () => {
  it('has no chain-id, decimals or EIP-712 domain literals', () => {
    const rules: Array<[string, RegExp]> = [
      ['chain id literal', /\bchain_?id\b\s*[:=]\s*\d/i],
      ['decimals literal', /\bdecimals\b\s*[:=]\s*\d/i],
      ['domain literal', /\b(verifyingContract|version|salt)\b\s*:\s*['"`]/],
    ];
    const offenders: string[] = [];

    for (const file of sourceFiles(path.join('src', 'core'))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const [label, pattern] of rules) {
            if (pattern.test(line)) {
              offenders.push(`${path.basename(file)}:${index + 1} ${label}`);
            }
          }
        });
    }

    expect(offenders).toEqual([]);
  });
});

describe('C10: private key hygiene', () => {
  it('never reaches console, the outcome or the trace during a payment', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const originals = methods.map((m) => console[m]);
    const logged: unknown[][] = [];
    for (const m of methods) {
      console[m] = (...args: unknown[]) => {
        logged.push(args);
      };
    }

    let dump: string;
    try {
      const harness = createHarness({ scenario: 'happy' });
      const result = await harness.orchestrator.execute(payment());
      expect(result.state).toBe('SETTLED');
      dump = JSON.stringify(
        [result, harness.orchestrator.trace, logged],
        (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      ).toLowerCase();
    } finally {
      methods.forEach((m, i) => {
        console[m] = originals[i]!;
      });
    }

    expect(dump).not.toContain(ANVIL_PRIVATE_KEY_0.slice(2).toLowerCase());
  });

  it('no console call in src/ or scripts/ mentions a key or secret', () => {
    const offenders: string[] = [];
    for (const base of ['src', 'scripts']) {
      for (const file of sourceFiles(base)) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            if (/console\.\w+\(/.test(line) && /private|secret|mnemonic/i.test(line)) {
              offenders.push(`${base}/${path.basename(file)}:${index + 1}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('.env is gitignored and no 32-byte hex literal exists in src/, scripts/ or .env.example', () => {
    const root = process.cwd();
    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toMatch(/^\.env$/m);

    const hex32 = /0x[0-9a-fA-F]{64}/;
    expect(readFileSync(path.join(root, '.env.example'), 'utf8')).not.toMatch(hex32);

    const offenders: string[] = [];
    for (const base of ['src', 'scripts']) {
      for (const file of sourceFiles(base)) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            if (hex32.test(line)) {
              offenders.push(`${base}/${path.basename(file)}:${index + 1}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
