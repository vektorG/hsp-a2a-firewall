import type { Address, Hex } from 'viem';
import { isQuoteExpiredError, type IHspMcpClient } from '../mcp/client.js';
import type {
  FinalizePaymentInput,
  FinalizePaymentOutput,
  PreparePaymentOutput,
  ServerTypedData,
  SubmitPaymentOutput,
} from '../mcp/schemas.js';
import type { PaymentSigner } from './eip712.js';
import type { SpendLedger } from './ledger.js';
import {
  isTerminalPaymentState,
  readLastPayment,
  writeLastPayment,
  type LastPaymentRecord,
} from './paymentState.js';
import {
  PolicyEngine,
  type PolicyDecision,
  type PolicyReason,
} from './policy.js';
import type { ReceiptRecorder } from './receipt.js';

export const PAYMENT_STATES = [
  'INIT',
  'POLICY_CHECKED',
  'ORDER_CREATED',
  'REQUOTING',
  'PREPARED',
  'SIGNED',
  'FINALIZED',
  'SUBMITTED',
  'POLLING',
  'SAFE_AWAITING_FINALITY',
  'SETTLED',
  'FAILED',
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

/** R8: every state transition is recorded and drives the future UI. */
export interface TraceEvent {
  timestamp: string;
  fromState: PaymentState;
  toState: PaymentState;
  orderId?: string;
  meta?: Record<string, unknown>;
}

export interface PaymentRequest {
  merchantName: string;
  token: string;
  /** Raw base units, decimal string. */
  amountRaw: string;
  /** Optional merchant payout address forwarded to create_order. */
  payTo?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentOutcome {
  state: 'SETTLED' | 'FAILED';
  reason?: string;
  orderId?: string;
  flowId?: string;
  paymentRequestId?: string;
  paymentId?: string;
  txSignature?: string | null;
  amountRaw?: string;
  signature?: Hex;
  receiptTxHash?: Hex;
  receiptError?: string;
  trace: TraceEvent[];
}

export type QuoteMismatchField =
  | 'payer'
  | 'amount'
  | 'recipient'
  | 'token'
  | 'chain_id'
  | 'shape';

/** The approved values the signed quote must match exactly. */
export interface ApprovedQuoteIntent {
  payer: string;
  token: string;
  tokenTotalRaw?: bigint | string;
  token_total_raw?: bigint | string;
  amount?: bigint | string;
  payTo?: string;
  pay_to?: string;
  settlementRecipient?: string;
  settlement_recipient?: string;
  spender?: string;
}

/** Chain configuration fetched live from get_chain_config (R5). */
export interface LiveChainConfig {
  chain_id?: number | string;
  chainId?: number | string;
}

export type QuoteValidationResult =
  | { valid: true; allowed: true }
  | {
      valid: false;
      allowed: false;
      reason: 'POLICY_MISMATCH';
      field: QuoteMismatchField;
      details: {
        field: QuoteMismatchField;
        expected: string;
        actual: string;
      };
    };

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UNSIGNED_AMOUNT = /^[0-9]+$/;

function mismatch(
  field: QuoteMismatchField,
  expected: unknown,
  actual: unknown,
): QuoteValidationResult {
  return {
    valid: false,
    allowed: false,
    reason: 'POLICY_MISMATCH',
    field,
    details: {
      field,
      expected: expected === undefined ? 'undefined' : String(expected),
      actual: actual === undefined ? 'undefined' : String(actual),
    },
  };
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && EVM_ADDRESS.test(value)
    ? value.toLowerCase()
    : null;
}

function normalizeAmount(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'string' && UNSIGNED_AMOUNT.test(value)) {
    return BigInt(value);
  }
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return BigInt(value);
  }
  return null;
}

function sameChainId(left: unknown, right: unknown): boolean {
  try {
    return BigInt(String(left)) === BigInt(String(right));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read-only pre-sign cross-check (PATCH #0.2).
 *
 * Verifies the server-supplied EIP-712 payload against the approved intent and
 * live chain config. It never mutates `eip712`; any mismatch returns
 * `POLICY_MISMATCH` so the orchestrator can fail before signing.
 */
export function validateQuoteAgainstIntent(
  eip712: ServerTypedData,
  approvedIntent: ApprovedQuoteIntent,
  liveConfig: LiveChainConfig,
): QuoteValidationResult {
  const message = isRecord(eip712.message) ? eip712.message : null;
  const domain = isRecord(eip712.domain) ? eip712.domain : null;

  if (!message || !domain) {
    return mismatch('shape', 'typed data message and domain', 'missing');
  }

  // 1. message.from must be the payer account.
  const expectedPayer = normalizeAddress(approvedIntent.payer);
  const actualFrom = normalizeAddress(message.from);

  if (!expectedPayer || actualFrom !== expectedPayer) {
    return mismatch('payer', approvedIntent.payer, message.from);
  }

  // 2. domain.chainId must match live get_chain_config.
  const liveChainId = liveConfig.chain_id ?? liveConfig.chainId;
  if (!sameChainId(domain.chainId, liveChainId)) {
    return mismatch('chain_id', liveChainId, domain.chainId);
  }

  const approvedToken = normalizeAddress(approvedIntent.token);
  const approvedAmount = normalizeAmount(
    approvedIntent.tokenTotalRaw ??
      approvedIntent.token_total_raw ??
      approvedIntent.amount,
  );
  const approvedPayTo = normalizeAddress(
    approvedIntent.payTo ?? approvedIntent.pay_to,
  );
  const approvedRecipient = normalizeAddress(
    approvedIntent.settlementRecipient ??
      approvedIntent.settlement_recipient ??
      approvedIntent.spender ??
      approvedIntent.payTo ??
      approvedIntent.pay_to,
  );

  const permitted = isRecord(message.permitted) ? message.permitted : null;

  if (permitted) {
    // Permit2: permitted.amount / permitted.token / spender.
    const actualAmount = normalizeAmount(permitted.amount);
    if (
      approvedAmount === null ||
      actualAmount === null ||
      actualAmount !== approvedAmount
    ) {
      return mismatch(
        'amount',
        approvedAmount === null ? 'invalid approved amount' : approvedAmount,
        permitted.amount,
      );
    }

    const actualToken = normalizeAddress(permitted.token);
    if (!approvedToken || actualToken !== approvedToken) {
      return mismatch('token', approvedIntent.token, permitted.token);
    }

    const actualSpender = normalizeAddress(message.spender);
    if (!approvedRecipient || actualSpender !== approvedRecipient) {
      return mismatch(
        'recipient',
        approvedRecipient ?? 'invalid settlement recipient',
        message.spender,
      );
    }

    return { valid: true, allowed: true };
  }

  // EIP-3009: value / to / domain.verifyingContract.
  const actualValue = normalizeAmount(message.value);
  if (
    approvedAmount === null ||
    actualValue === null ||
    actualValue !== approvedAmount
  ) {
    return mismatch(
      'amount',
      approvedAmount === null ? 'invalid approved amount' : approvedAmount,
      message.value,
    );
  }

  const actualTo = normalizeAddress(message.to);
  if (!approvedPayTo || actualTo !== approvedPayTo) {
    return mismatch(
      'recipient',
      approvedPayTo ?? 'invalid pay_to',
      message.to,
    );
  }

  const actualVerifyingContract = normalizeAddress(domain.verifyingContract);
  if (!approvedToken || actualVerifyingContract !== approvedToken) {
    return mismatch(
      'token',
      approvedIntent.token,
      domain.verifyingContract,
    );
  }

  return { valid: true, allowed: true };
}

export interface PaymentOrchestratorConfig {
  client: IHspMcpClient;
  policy: PolicyEngine;
  ledger: SpendLedger;
  signer: PaymentSigner;
  merchantName: string;
  receiptRecorder?: ReceiptRecorder;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** R3 default: 15 seconds. Injectable for tests. */
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  /** R4: max timeout retries before FAILED(POLL_TIMEOUT). */
  maxTimeoutRetries?: number;
  /**
   * Optional checkpoint file (e.g. `data/last-payment.json`). When set, every
   * transition is persisted and `execute()` refuses a new `create_order` while
   * a non-terminal payment is on disk. Left undefined by default so existing
   * in-memory unit tests never touch disk.
   */
  lastPaymentPath?: string;
  /** `--force`: ignore an existing non-terminal checkpoint. */
  force?: boolean;
  onTrace?: (event: TraceEvent) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 60;
const DEFAULT_MAX_TIMEOUT_RETRIES = 3;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/;

/**
 * Everything prepare_payment returned except the fields the orchestrator
 * consumes locally. The live rail may attach opaque echo fields (for example
 * `payment_payload` / `payment_mandate_contents`); they must reach
 * finalize_payment unchanged or the server rejects the finalize.
 */
function prepareEchoFields(
  prepared: PreparePaymentOutput,
): Record<string, unknown> {
  const {
    order_id: _orderId,
    flow_id: _flowId,
    payment_request_id: _paymentRequestId,
    eip712: _eip712,
    token_total_raw: _tokenTotalRaw,
    quote_expires_at: _quoteExpiresAt,
    pay_to: _payTo,
    permit2: _permit2,
    ...echo
  } = prepared as PreparePaymentOutput & Record<string, unknown>;

  return echo;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Orchestrates one payment intent:
 * policy -> create_order -> prepare -> policy -> sign -> finalize -> submit ->
 * query -> SETTLED/FAILED, with one automatic re-quote on the SAME order and
 * no order recreation on timeouts (R2/R4).
 */
export class PaymentOrchestrator {
  #state: PaymentState = 'INIT';
  #trace: TraceEvent[] = [];
  #orderId?: string;
  #flowId?: string;
  #paymentRequestId?: string;
  #paymentId?: string;
  #txSignature?: string | null;
  #request?: PaymentRequest;
  #tokenTotalRaw?: string;

  readonly #config: PaymentOrchestratorConfig;
  readonly #now: () => Date;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #pollIntervalMs: number;
  readonly #maxPollAttempts: number;
  readonly #maxTimeoutRetries: number;

  constructor(config: PaymentOrchestratorConfig) {
    this.#config = config;
    this.#now = config.now ?? (() => new Date());
    this.#sleep = config.sleep ?? defaultSleep;
    this.#pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#maxPollAttempts =
      config.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
    this.#maxTimeoutRetries =
      config.maxTimeoutRetries ?? DEFAULT_MAX_TIMEOUT_RETRIES;
  }

  get trace(): readonly TraceEvent[] {
    return this.#trace;
  }

  async execute(request: PaymentRequest): Promise<PaymentOutcome> {
    this.#state = 'INIT';
    this.#trace = [];
    this.#orderId = undefined;
    this.#flowId = undefined;
    this.#paymentRequestId = undefined;
    this.#paymentId = undefined;
    this.#txSignature = undefined;
    this.#request = request;
    this.#tokenTotalRaw = undefined;

    // ---- Resume guard: never create a second order while a non-terminal
    // payment is checkpointed, unless the operator passed --force. --------
    const pending = this.#pendingPayment();

    if (pending !== null && this.#config.force !== true) {
      return this.#refusePending(pending);
    }

    try {
      return await this.#run(request);
    } catch (error) {
      return this.#fail('INTERNAL_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #run(request: PaymentRequest): Promise<PaymentOutcome> {
    // The ledger is loaded fresh on every execution; a restart therefore
    // preserves today's spend (R7).
    const spentToday = this.#config.ledger.getSpentToday();

    // ---- Policy gate BEFORE create_order. Blocking here means no order and
    // no signature are ever produced. ----------------------------------
    const preDecision = this.#evaluate(
      request.amountRaw,
      request.token,
      request.merchantName,
      spentToday,
    );
    this.#transition('POLICY_CHECKED', {
      phase: 'pre_order',
      spentToday: spentToday.toString(),
      decision: preDecision,
    });

    if (!preDecision.allowed) {
      return this.#fail(preDecision.reason, { policy: preDecision });
    }

    const order = await this.#config.client.create_order({
      merchant_name: request.merchantName,
      token: request.token,
      amount: request.amountRaw,
      pay_to: request.payTo,
      metadata: request.metadata,
    });

    this.#orderId = order.order_id;
    this.#flowId = order.flow_id;
    this.#paymentRequestId = order.payment_request_id;
    this.#tokenTotalRaw = order.token_total_raw;
    this.#transition('ORDER_CREATED', {
      flow_id: order.flow_id,
      payment_request_id: order.payment_request_id,
      token_total_raw: order.token_total_raw,
      quote_expires_at: order.quote_expires_at,
    });

    // Live chain config for the pre-sign cross-check (R5: runtime-only).
    const liveConfig = await this.#config.client.get_chain_config({});

    // ---- prepare -> policy -> sign -> finalize -> submit, with max one
    // automatic re-quote on the SAME order (R2). A 30043 from prepare,
    // finalize or submit all take this same path; create_order is NEVER
    // called again. -----------------------------------------------------
    let prepared: PreparePaymentOutput | undefined;
    let requotes = 0;
    let signature: Hex | undefined;
    let finalized: FinalizePaymentOutput | undefined;
    let submitted: SubmitPaymentOutput | undefined;

    while (finalized === undefined) {
      if (prepared === undefined) {
        try {
          prepared = await this.#config.client.prepare_payment({
            order_id: order.order_id,
            flow_id: order.flow_id,
            payment_request_id: order.payment_request_id,
            payer: this.#config.signer.address,
          });
        } catch (error) {
          if (isQuoteExpiredError(error) && requotes < 1) {
            requotes += 1;
            this.#transition('REQUOTING', {
              trigger: 'ERROR_30043',
              phase: 'prepare',
              attempt: requotes,
              message: error instanceof Error ? error.message : String(error),
            });
            continue;
          }

          if (isQuoteExpiredError(error)) {
            return this.#fail('QUOTE_EXPIRED', {
              trigger: 'ERROR_30043',
              phase: 'prepare',
              attempts: requotes + 1,
            });
          }

          throw error;
        }

        const expiresAt = Date.parse(prepared.quote_expires_at);

        // A malformed or already-expired quote must never be signed.
        if (!Number.isFinite(expiresAt) || expiresAt <= this.#now().getTime()) {
          if (requotes < 1) {
            requotes += 1;
            this.#transition('REQUOTING', {
              trigger: 'QUOTE_EXPIRES_AT',
              attempt: requotes,
              quote_expires_at: prepared.quote_expires_at,
            });
            prepared = undefined;
            continue;
          }

          return this.#fail('QUOTE_EXPIRED', {
            trigger: 'QUOTE_EXPIRES_AT',
            quote_expires_at: prepared.quote_expires_at,
            attempts: requotes + 1,
          });
        }

        this.#tokenTotalRaw = prepared.token_total_raw;
        this.#transition('PREPARED', {
          token_total_raw: prepared.token_total_raw,
          quote_expires_at: prepared.quote_expires_at,
          re_quoted: requotes > 0,
        });
      }

      // ---- Policy is re-run on the (possibly re-quoted) total (R2). ---
      const postDecision = this.#evaluate(
        prepared.token_total_raw,
        request.token,
        request.merchantName,
        spentToday,
      );
      this.#transition('POLICY_CHECKED', {
        phase: 'post_quote',
        quotedTotalRaw: prepared.token_total_raw,
        decision: postDecision,
      });

      if (!postDecision.allowed) {
        return this.#fail(postDecision.reason, { policy: postDecision });
      }

      // ---- Pre-sign cross-check (PATCH #0.2). Read-only. Any mismatch
      // fails POLICY_MISMATCH before the signer is ever invoked. --------
      const validation = validateQuoteAgainstIntent(
        prepared.eip712,
        {
          payer: this.#config.signer.address,
          token: request.token,
          tokenTotalRaw: prepared.token_total_raw,
          payTo: prepared.pay_to,
          settlementRecipient: prepared.pay_to,
        },
        liveConfig,
      );

      if (!validation.valid) {
        return this.#fail('POLICY_MISMATCH', {
          phase: 'pre_sign',
          check: validation.field,
          expected: validation.details.expected,
          actual: validation.details.actual,
          validation,
        });
      }

      // ---- Production signing path only (R1). -------------------------
      signature = await this.#config.signer.sign(prepared.eip712);
      this.#transition('SIGNED', {
        signer: this.#config.signer.address,
        primaryType: prepared.eip712.primaryType,
      });

      try {
        finalized = await this.#config.client.finalize_payment({
          ...prepareEchoFields(prepared),
          order_id: order.order_id,
          payment_request_id: order.payment_request_id,
          payer: this.#config.signer.address,
          signature,
        } as FinalizePaymentInput);
      } catch (error) {
        if (isQuoteExpiredError(error)) {
          if (requotes < 1) {
            requotes += 1;
            prepared = undefined;
            signature = undefined;
            this.#paymentId = undefined;
            this.#txSignature = undefined;
            this.#transition('REQUOTING', {
              trigger: 'ERROR_30043',
              phase: 'finalize',
              attempt: requotes,
              message: error instanceof Error ? error.message : String(error),
            });
            continue;
          }

          return this.#fail('QUOTE_EXPIRED', {
            trigger: 'ERROR_30043',
            phase: 'finalize',
            attempts: requotes + 1,
          });
        }

        throw error;
      }

      this.#paymentId = finalized.payment_id;
      this.#txSignature = finalized.tx_signature ?? null;
      this.#transition('FINALIZED', {
        payment_id: finalized.payment_id,
        status: finalized.status,
        tx_signature: finalized.tx_signature ?? null,
      });

      try {
        submitted = await this.#config.client.submit_payment({
          order_id: order.order_id,
          payment_id: finalized.payment_id,
          signature,
        });
      } catch (error) {
        if (isQuoteExpiredError(error)) {
          if (requotes < 1) {
            requotes += 1;
            prepared = undefined;
            finalized = undefined;
            submitted = undefined;
            signature = undefined;
            this.#paymentId = undefined;
            this.#txSignature = undefined;
            this.#transition('REQUOTING', {
              trigger: 'ERROR_30043',
              phase: 'submit',
              attempt: requotes,
              message: error instanceof Error ? error.message : String(error),
            });
            continue;
          }

          return this.#fail('QUOTE_EXPIRED', {
            trigger: 'ERROR_30043',
            phase: 'submit',
            attempts: requotes + 1,
          });
        }

        throw error;
      }

      this.#txSignature = submitted.tx_signature ?? this.#txSignature;
      this.#transition('SUBMITTED', {
        payment_id: submitted.payment_id,
        status: submitted.status,
        tx_signature: submitted.tx_signature ?? null,
      });
    }

    if (
      prepared === undefined ||
      signature === undefined ||
      finalized === undefined ||
      submitted === undefined
    ) {
      return this.#fail('INTERNAL_ERROR', {
        error: 'payment pipeline exited without a complete result',
      });
    }

    const quote = prepared;

    // ---- Poll until terminal. Timeout NEVER recreates the order (R4). --
    this.#transition('POLLING', {
      pollIntervalMs: this.#pollIntervalMs,
      maxPollAttempts: this.#maxPollAttempts,
      maxTimeoutRetries: this.#maxTimeoutRetries,
    });

    let timeoutRetries = 0;

    for (let attempt = 1; attempt <= this.#maxPollAttempts; attempt += 1) {
      const query = await this.#config.client.query_payment({
        payment_id: finalized.payment_id,
        // R3: sent on EVERY query.
        expected_merchant_name: this.#config.merchantName,
      });
      this.#txSignature = query.tx_signature ?? this.#txSignature;

      if (query.status === 'payment-finalized') {
        if (query.attribution_verified !== true) {
          return this.#fail('ATTRIBUTION_MISMATCH', {
            attempt,
            status: query.status,
            attribution_verified: query.attribution_verified ?? null,
            attribution_merchant_name: query.attribution_merchant_name ?? null,
            expected_merchant_name: this.#config.merchantName,
            tx_signature: this.#txSignature ?? null,
          });
        }

        this.#transition('SETTLED', {
          attempt,
          status: query.status,
          attribution_verified: true,
          attribution_merchant_name: query.attribution_merchant_name ?? null,
          token_total_raw: quote.token_total_raw,
          tx_signature: this.#txSignature ?? null,
        });

        // R6: only after SETTLED.
        let receiptTxHash: Hex | undefined;
        let receiptError: string | undefined;

        if (this.#config.receiptRecorder) {
          try {
            const receipt = await this.#config.receiptRecorder.record({
              paymentRequestId: order.payment_request_id,
              merchantName: request.merchantName,
              token: request.token as Address,
              amount: BigInt(quote.token_total_raw),
            });
            receiptTxHash = receipt.txHash;
          } catch (error) {
            receiptError =
              error instanceof Error ? error.message : String(error);
          }
        }

        try {
          this.#config.ledger.addSpend(BigInt(quote.token_total_raw));
        } catch (error) {
          receiptError ??=
            error instanceof Error ? error.message : String(error);
        }

        return {
          state: 'SETTLED',
          orderId: this.#orderId,
          flowId: this.#flowId,
          paymentRequestId: this.#paymentRequestId,
          paymentId: this.#paymentId,
          txSignature: this.#txSignature ?? null,
          amountRaw: quote.token_total_raw,
          signature,
          receiptTxHash,
          receiptError,
          trace: [...this.#trace],
        };
      }

      if (query.status === 'payment-failed') {
        const reason = query.status_reason ?? 'PAYMENT_FAILED';
        return this.#fail(reason, {
          attempt,
          status: query.status,
          status_reason: query.status_reason ?? null,
          tx_signature: this.#txSignature ?? null,
        });
      }

      if (query.status === 'payment-safe') {
        // R3: payment-safe is NOT settled. Only the next transition can be
        // SETTLED, and only on payment-finalized + attribution_verified.
        this.#transition('SAFE_AWAITING_FINALITY', {
          attempt,
          status: query.status,
          settled: false,
        });
      } else if (
        query.status === 'timeout' ||
        query.status === 'payment-timeout'
      ) {
        timeoutRetries += 1;
        this.#transition(this.#state, {
          attempt,
          status: query.status,
          timeoutRetries,
          maxTimeoutRetries: this.#maxTimeoutRetries,
        });

        if (timeoutRetries > this.#maxTimeoutRetries) {
          return this.#fail('POLL_TIMEOUT', {
            attempt,
            timeoutRetries,
            status: query.status,
          });
        }
      } else {
        // submitted / verified / processing / included: keep polling.
        this.#transition(this.#state, {
          attempt,
          status: query.status,
        });
      }

      await this.#sleep(this.#pollIntervalMs);
    }

    return this.#fail('POLL_TIMEOUT', {
      attempts: this.#maxPollAttempts,
      reason: 'max poll attempts exhausted',
    });
  }

  #pendingPayment(): LastPaymentRecord | null {
    const filePath = this.#config.lastPaymentPath;

    if (filePath === undefined) {
      return null;
    }

    const record = readLastPayment(filePath);

    if (record === null || isTerminalPaymentState(record.state)) {
      return null;
    }

    return record;
  }

  #refusePending(pending: LastPaymentRecord): PaymentOutcome {
    const event: TraceEvent = {
      timestamp: this.#now().toISOString(),
      fromState: 'INIT',
      toState: 'FAILED',
      meta: {
        reason: 'PENDING_PAYMENT_EXISTS',
        pending_state: pending.state,
        pending_payment_id: pending.payment_id ?? null,
        pending_order_id: pending.order_id ?? null,
        hint: 'run `npm run resume` or pass --force',
      },
    };

    this.#state = 'FAILED';
    this.#trace.push(event);
    this.#config.onTrace?.(event);

    return {
      state: 'FAILED',
      reason: 'PENDING_PAYMENT_EXISTS',
      orderId: pending.order_id,
      flowId: pending.flow_id,
      paymentRequestId: pending.payment_request_id,
      paymentId: pending.payment_id,
      trace: [...this.#trace],
    };
  }

  #evaluate(
    amountRaw: string,
    token: string,
    merchantName: string,
    spentToday: bigint,
  ): PolicyDecision {
    if (!UNSIGNED_INTEGER.test(amountRaw)) {
      return {
        allowed: false,
        reason: 'INVALID_AMOUNT',
        details: { amount: amountRaw, code: 'INVALID_AMOUNT' },
      };
    }

    return this.#config.policy.evaluate(
      { merchantName, token, amount: BigInt(amountRaw) },
      spentToday,
    );
  }

  #transition(toState: PaymentState, meta?: Record<string, unknown>): void {
    const event: TraceEvent = {
      timestamp: this.#now().toISOString(),
      fromState: this.#state,
      toState,
    };

    if (this.#orderId !== undefined) {
      event.orderId = this.#orderId;
    }
    if (meta !== undefined) {
      event.meta = meta;
    }

    this.#state = toState;
    this.#trace.push(event);
    this.#persist();
    this.#config.onTrace?.(event);
  }

  /**
   * Writes the checkpoint on every transition after an order exists. No-op
   * unless `lastPaymentPath` is configured, which keeps existing unit tests
   * fully in-memory.
   *
   * Pre-order states are intentionally not persisted: a policy block before
   * `create_order` leaves nothing to resume on-chain and must never trip the
   * resume guard on the next payment.
   */
  #persist(): void {
    const filePath = this.#config.lastPaymentPath;

    if (
      filePath === undefined ||
      this.#request === undefined ||
      this.#orderId === undefined
    ) {
      return;
    }

    const record: LastPaymentRecord = {
      flow_id: this.#flowId,
      payment_request_id: this.#paymentRequestId,
      order_id: this.#orderId,
      payment_id: this.#paymentId,
      state: this.#state,
      merchant_name: this.#request.merchantName,
      token: this.#request.token,
      token_total_raw: this.#tokenTotalRaw ?? this.#request.amountRaw,
      tx_signature: this.#txSignature ?? null,
      updated_at: this.#now().toISOString(),
    };

    writeLastPayment(filePath, record);
  }

  #fail(reason: string, meta?: Record<string, unknown>): PaymentOutcome {
    this.#transition('FAILED', { reason, ...meta });
    return {
      state: 'FAILED',
      reason,
      orderId: this.#orderId,
      flowId: this.#flowId,
      paymentRequestId: this.#paymentRequestId,
      paymentId: this.#paymentId,
      txSignature: this.#txSignature ?? null,
      trace: [...this.#trace],
    };
  }
}

export type { PolicyReason };
