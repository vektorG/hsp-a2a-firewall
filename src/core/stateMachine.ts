import type { Address, Hex } from 'viem';
import { isQuoteExpiredError, type IHspMcpClient } from '../mcp/client.js';
import type { PreparePaymentOutput } from '../mcp/schemas.js';
import type { PaymentSigner } from './eip712.js';
import type { SpendLedger } from './ledger.js';
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
  onTrace?: (event: TraceEvent) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 60;
const DEFAULT_MAX_TIMEOUT_RETRIES = 3;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/;

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
      metadata: request.metadata,
    });

    this.#orderId = order.order_id;
    this.#flowId = order.flow_id;
    this.#paymentRequestId = order.payment_request_id;
    this.#transition('ORDER_CREATED', {
      flow_id: order.flow_id,
      payment_request_id: order.payment_request_id,
      token_total_raw: order.token_total_raw,
      quote_expires_at: order.quote_expires_at,
    });

    // ---- prepare_payment, with max one automatic re-quote on the SAME
    // order (R2). create_order is NEVER called again. -------------------
    let prepared: PreparePaymentOutput | undefined;
    let requotes = 0;

    while (prepared === undefined) {
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
            attempt: requotes,
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        if (isQuoteExpiredError(error)) {
          return this.#fail('QUOTE_EXPIRED', {
            trigger: 'ERROR_30043',
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

      this.#transition('PREPARED', {
        token_total_raw: prepared.token_total_raw,
        quote_expires_at: prepared.quote_expires_at,
        re_quoted: requotes > 0,
      });
    }

    // ---- Policy is re-run on the (possibly re-quoted) total (R2). -----
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

    // ---- Production signing path only (R1). ---------------------------
    const signature = await this.#config.signer.sign(prepared.eip712);
    this.#transition('SIGNED', {
      signer: this.#config.signer.address,
      primaryType: prepared.eip712.primaryType,
    });

    const finalized = await this.#config.client.finalize_payment({
      order_id: order.order_id,
      payment_request_id: order.payment_request_id,
      payer: this.#config.signer.address,
      signature,
    });
    this.#paymentId = finalized.payment_id;
    this.#txSignature = finalized.tx_signature ?? null;
    this.#transition('FINALIZED', {
      payment_id: finalized.payment_id,
      status: finalized.status,
      tx_signature: finalized.tx_signature ?? null,
    });

    const submitted = await this.#config.client.submit_payment({
      order_id: order.order_id,
      payment_id: finalized.payment_id,
      signature,
    });
    this.#txSignature = submitted.tx_signature ?? this.#txSignature;
    this.#transition('SUBMITTED', {
      payment_id: submitted.payment_id,
      status: submitted.status,
      tx_signature: submitted.tx_signature ?? null,
    });

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
          token_total_raw: prepared.token_total_raw,
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
              amount: BigInt(prepared.token_total_raw),
            });
            receiptTxHash = receipt.txHash;
          } catch (error) {
            receiptError =
              error instanceof Error ? error.message : String(error);
          }
        }

        try {
          this.#config.ledger.addSpend(BigInt(prepared.token_total_raw));
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
          amountRaw: prepared.token_total_raw,
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
    this.#config.onTrace?.(event);
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
