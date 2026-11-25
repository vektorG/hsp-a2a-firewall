/**
 * Deterministic, side-effect-free payment policy engine.
 *
 * `evaluate` is the only gate between an intent and any HSP order/signature
 * call. If it returns `allowed: false`, the orchestrator never calls
 * `create_order` and never signs anything.
 */

export type PolicyReason =
  | 'EXCEEDS_MAX_TX'
  | 'EXCEEDS_DAILY_LIMIT'
  | 'UNTRUSTED_MERCHANT'
  | 'UNSUPPORTED_TOKEN'
  | 'INVALID_AMOUNT';

export interface PolicyIntent {
  merchantName: string;
  token: string;
  /** Base units. */
  amount: bigint;
}

export interface PolicyConfig {
  /** Maximum single transaction, base units. */
  maxTxAmount: bigint;
  /** Maximum cumulative spend per UTC day, base units. */
  dailyLimit: bigint;
  /** Exact, case-sensitive merchant names. */
  allowedMerchants: readonly string[];
  /** EVM token addresses, matched case-insensitively. */
  allowedTokens: readonly string[];
}

export interface PolicyDetails {
  amount?: string;
  spentToday?: string;
  maxTxAmount?: string;
  dailyLimit?: string;
  projectedSpend?: string;
  merchantName?: string;
  token?: string;
  code?: PolicyReason;
}

export type PolicyDecision =
  | { allowed: true; details: PolicyDetails }
  | { allowed: false; reason: PolicyReason; details: PolicyDetails };

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export class PolicyEngine {
  readonly #config: PolicyConfig;
  readonly #merchants: ReadonlySet<string>;
  readonly #tokens: ReadonlySet<string>;

  constructor(config: PolicyConfig) {
    this.#config = config;
    this.#merchants = new Set(config.allowedMerchants);
    this.#tokens = new Set(
      config.allowedTokens
        .filter((token) => EVM_ADDRESS.test(token))
        .map((token) => token.toLowerCase()),
    );
  }

  get config(): PolicyConfig {
    return this.#config;
  }

  /** Pure: no I/O, no mutation, no clock. */
  evaluate(intent: PolicyIntent, spentToday: bigint): PolicyDecision {
    const { maxTxAmount, dailyLimit } = this.#config;

    if (intent.amount <= 0n) {
      return {
        allowed: false,
        reason: 'INVALID_AMOUNT',
        details: { amount: intent.amount.toString(), code: 'INVALID_AMOUNT' },
      };
    }

    if (
      !EVM_ADDRESS.test(intent.token) ||
      !this.#tokens.has(intent.token.toLowerCase())
    ) {
      return {
        allowed: false,
        reason: 'UNSUPPORTED_TOKEN',
        details: { token: intent.token, code: 'UNSUPPORTED_TOKEN' },
      };
    }

    if (!this.#merchants.has(intent.merchantName)) {
      return {
        allowed: false,
        reason: 'UNTRUSTED_MERCHANT',
        details: {
          merchantName: intent.merchantName,
          code: 'UNTRUSTED_MERCHANT',
        },
      };
    }

    if (intent.amount > maxTxAmount) {
      return {
        allowed: false,
        reason: 'EXCEEDS_MAX_TX',
        details: {
          amount: intent.amount.toString(),
          maxTxAmount: maxTxAmount.toString(),
          code: 'EXCEEDS_MAX_TX',
        },
      };
    }

    const projectedSpend = spentToday + intent.amount;

    if (projectedSpend > dailyLimit) {
      return {
        allowed: false,
        reason: 'EXCEEDS_DAILY_LIMIT',
        details: {
          amount: intent.amount.toString(),
          spentToday: spentToday.toString(),
          projectedSpend: projectedSpend.toString(),
          dailyLimit: dailyLimit.toString(),
          code: 'EXCEEDS_DAILY_LIMIT',
        },
      };
    }

    return {
      allowed: true,
      details: {
        amount: intent.amount.toString(),
        spentToday: spentToday.toString(),
        projectedSpend: projectedSpend.toString(),
        maxTxAmount: maxTxAmount.toString(),
        dailyLimit: dailyLimit.toString(),
      },
    };
  }
}
