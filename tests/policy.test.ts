import { describe, expect, it } from 'vitest';
import { PolicyEngine, type PolicyIntent } from '../src/core/policy.js';

const TOKEN = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

const engine = new PolicyEngine({
  maxTxAmount: 1000n,
  dailyLimit: 1500n,
  allowedMerchants: ['kolit_vlom'],
  allowedTokens: [TOKEN.toLowerCase()],
});

function intent(overrides: Partial<PolicyIntent> = {}): PolicyIntent {
  return {
    merchantName: 'kolit_vlom',
    token: TOKEN.toLowerCase(),
    amount: 500n,
    ...overrides,
  };
}

describe('PolicyEngine', () => {
  it('rejects a transaction above maxTxAmount', () => {
    const decision = engine.evaluate(intent({ amount: 1001n }), 0n);
    expect(decision).toMatchObject({ allowed: false, reason: 'EXCEEDS_MAX_TX' });
  });

  it('rejects when the UTC-day cap would be exceeded', () => {
    const decision = engine.evaluate(intent({ amount: 800n }), 800n);
    expect(decision).toMatchObject({
      allowed: false,
      reason: 'EXCEEDS_DAILY_LIMIT',
    });
  });

  it('allows spend exactly at the daily cap boundary', () => {
    expect(engine.evaluate(intent({ amount: 500n }), 1000n)).toEqual({
      allowed: true,
      details: expect.any(Object),
    });
  });

  it('rejects an untrusted merchant (exact match)', () => {
    const decision = engine.evaluate(intent({ merchantName: 'Kolit_Vlom' }), 0n);
    expect(decision).toMatchObject({
      allowed: false,
      reason: 'UNTRUSTED_MERCHANT',
    });
  });

  it('rejects an unsupported token', () => {
    const decision = engine.evaluate(
      intent({ token: '0x9999999999999999999999999999999999999999' }),
      0n,
    );
    expect(decision).toMatchObject({
      allowed: false,
      reason: 'UNSUPPORTED_TOKEN',
    });
  });

  it('rejects a malformed token address', () => {
    const decision = engine.evaluate(intent({ token: 'not-an-address' }), 0n);
    expect(decision).toMatchObject({
      allowed: false,
      reason: 'UNSUPPORTED_TOKEN',
    });
  });

  it('rejects zero and negative amounts', () => {
    expect(engine.evaluate(intent({ amount: 0n }), 0n)).toMatchObject({
      allowed: false,
      reason: 'INVALID_AMOUNT',
    });
    expect(engine.evaluate(intent({ amount: -1n }), 0n)).toMatchObject({
      allowed: false,
      reason: 'INVALID_AMOUNT',
    });
  });

  it('accepts a valid payment and matches tokens case-insensitively', () => {
    const decision = engine.evaluate(intent({ token: TOKEN, amount: 500n }), 100n);
    expect(decision.allowed).toBe(true);
  });

  it('is deterministic and side-effect free', () => {
    const first = engine.evaluate(intent(), 100n);
    const second = engine.evaluate(intent(), 100n);
    expect(second).toEqual(first);
  });
});
