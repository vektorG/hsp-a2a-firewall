import { randomBytes } from 'node:crypto';
import type { Address, Hex } from 'viem';
import { HSP_ERROR_CODES } from './schemas.js';
import type {
  CreateOrderInput,
  CreateOrderOutput,
  EstimateFeeInput,
  EstimateFeeOutput,
  FinalizePaymentInput,
  FinalizePaymentOutput,
  GetChainConfigInput,
  GetChainConfigOutput,
  GetOrderInput,
  GetOrderOutput,
  HspErrorCode,
  PaymentStatus,
  PreparePaymentInput,
  PreparePaymentOutput,
  QueryPaymentInput,
  QueryPaymentOutput,
  ServerTypedData,
  SubmitPaymentInput,
  SubmitPaymentOutput,
} from './schemas.js';

/** The eight HSP MCP tools. */
export interface IHspMcpClient {
  get_chain_config(input?: GetChainConfigInput): Promise<GetChainConfigOutput>;
  create_order(input: CreateOrderInput): Promise<CreateOrderOutput>;
  get_order(input: GetOrderInput): Promise<GetOrderOutput>;
  prepare_payment(input: PreparePaymentInput): Promise<PreparePaymentOutput>;
  finalize_payment(
    input: FinalizePaymentInput,
  ): Promise<FinalizePaymentOutput>;
  estimate_fee(input: EstimateFeeInput): Promise<EstimateFeeOutput>;
  submit_payment(input: SubmitPaymentInput): Promise<SubmitPaymentOutput>;
  query_payment(input: QueryPaymentInput): Promise<QueryPaymentOutput>;
}

export class HspMcpError extends Error {
  constructor(
    readonly code: HspErrorCode | number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'HspMcpError';
  }
}

export function isHspMcpError(error: unknown): error is HspMcpError {
  return error instanceof HspMcpError;
}

/** True for the re-quote trigger from R2 (error 30043). */
export function isQuoteExpiredError(error: unknown): boolean {
  if (isHspMcpError(error)) {
    return error.code === HSP_ERROR_CODES.QUOTE_EXPIRED;
  }

  // Tolerate transport layers that surface `{ code, message }` plain objects.
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return (
      code === HSP_ERROR_CODES.QUOTE_EXPIRED ||
      code === String(HSP_ERROR_CODES.QUOTE_EXPIRED)
    );
  }

  return false;
}

// ---------------------------------------------------------------------------
// Mock fixtures. These example values are ALLOWED ONLY HERE (R5); core modules
// must receive chain id, token, decimals, Permit2 and EIP-712 domain at runtime.
// ---------------------------------------------------------------------------

/** EXAMPLE token address — mock fixture only. */
export const MOCK_EXAMPLE_TOKEN =
  '0x1111111111111111111111111111111111111111' as const satisfies Address;
/** EXAMPLE Permit2 address — mock fixture only. */
export const MOCK_EXAMPLE_PERMIT2 =
  '0x2222222222222222222222222222222222222222' as const satisfies Address;
/** EXAMPLE merchant payout address — mock fixture only. */
export const MOCK_EXAMPLE_PAY_TO =
  '0x3333333333333333333333333333333333333333' as const satisfies Address;
/** EXAMPLE EIP-712 domain name — mock fixture only. */
export const MOCK_EXAMPLE_DOMAIN_NAME = 'Example HSP Token';
/** EXAMPLE EIP-712 domain version — mock fixture only. */
export const MOCK_EXAMPLE_DOMAIN_VERSION = '1';
/** EXAMPLE chain id — mock fixture only; overridable in the constructor. */
export const MOCK_EXAMPLE_CHAIN_ID = 133;

export type MockScenario =
  | 'happy'
  | 'timeout-then-finalized'
  | 'always-timeout'
  | 'safe-then-finalized'
  | 'requote-once'
  | 'expired-quote-once'
  | 'attribution-mismatch'
  | 'policy-block'
  | 'payment-failed';

export interface MockHspMcpClientOptions {
  scenario: MockScenario;
  merchantName?: string;
  /** Overrides the example fixture; never read from core. */
  chainId?: number;
  now?: () => Date;
}

export interface MockCalls {
  get_chain_config: GetChainConfigInput[];
  create_order: CreateOrderInput[];
  get_order: GetOrderInput[];
  prepare_payment: PreparePaymentInput[];
  finalize_payment: FinalizePaymentInput[];
  estimate_fee: EstimateFeeInput[];
  submit_payment: SubmitPaymentInput[];
  query_payment: QueryPaymentInput[];
}

interface MockOrderRecord {
  orderId: string;
  flowId: string;
  paymentRequestId: string;
  merchantName: string;
  token: Address;
  amountRaw: string;
  tokenTotalRaw: string;
  quoteExpiresAt: Date;
}

const MOCK_TX_SIGNATURE: Hex = `0x${'ab'.repeat(32)}`;

/**
 * In-memory, scenario-driven HSP MCP client for tests and local development.
 * It returns a full `eip712` object from prepare_payment so the production
 * signing path (R1) is exercised end-to-end.
 */
export class MockHspMcpClient implements IHspMcpClient {
  readonly scenario: MockScenario;
  readonly calls: MockCalls = {
    get_chain_config: [],
    create_order: [],
    get_order: [],
    prepare_payment: [],
    finalize_payment: [],
    estimate_fee: [],
    submit_payment: [],
    query_payment: [],
  };

  readonly #merchantName: string;
  readonly #chainId: number;
  readonly #now: () => Date;
  readonly #orders = new Map<string, MockOrderRecord>();
  readonly #payments = new Map<string, { orderId: string }>();
  readonly #pollCounts = new Map<string, number>();
  #orderSequence = 0;
  #expiredQuoteEmitted = false;

  constructor(options: MockHspMcpClientOptions) {
    this.scenario = options.scenario;
    this.#merchantName = options.merchantName ?? 'kolit_vlom';
    this.#chainId = options.chainId ?? MOCK_EXAMPLE_CHAIN_ID;
    this.#now = options.now ?? (() => new Date());
  }

  async get_chain_config(
    input: GetChainConfigInput = {},
  ): Promise<GetChainConfigOutput> {
    this.calls.get_chain_config.push(input);
    return {
      chain_id: this.#chainId,
      chain_name: 'Example HSP Testnet',
      token: {
        address: MOCK_EXAMPLE_TOKEN,
        symbol: 'eHSK',
        name: 'Example HSP Token',
        decimals: 6,
      },
      permit2: MOCK_EXAMPLE_PERMIT2,
    };
  }

  async create_order(input: CreateOrderInput): Promise<CreateOrderOutput> {
    this.calls.create_order.push(input);
    this.#orderSequence += 1;

    const now = this.#now();
    const record: MockOrderRecord = {
      orderId: `order_${this.#orderSequence}`,
      flowId: `flow_${this.#orderSequence}`,
      paymentRequestId: `pr_${this.#orderSequence}`,
      merchantName: input.merchant_name,
      token: input.token as Address,
      amountRaw: input.amount,
      tokenTotalRaw: input.amount,
      quoteExpiresAt: new Date(now.getTime() + 5 * 60_000),
    };
    this.#orders.set(record.orderId, record);

    return {
      order_id: record.orderId,
      flow_id: record.flowId,
      payment_request_id: record.paymentRequestId,
      merchant_name: record.merchantName,
      token: record.token,
      amount_raw: record.amountRaw,
      token_total_raw: record.tokenTotalRaw,
      quote_expires_at: record.quoteExpiresAt.toISOString(),
    };
  }

  async get_order(input: GetOrderInput): Promise<GetOrderOutput> {
    // TODO(live-schema): confirm the real get_order payload against
    // docs/live-schemas.json. Shape below is plausible only.
    this.calls.get_order.push(input);
    const order = this.#requireOrder(input.order_id);

    return {
      order_id: order.orderId,
      flow_id: order.flowId,
      payment_request_id: order.paymentRequestId,
      merchant_name: order.merchantName,
      token: order.token,
      amount_raw: order.amountRaw,
      token_total_raw: order.tokenTotalRaw,
      quote_expires_at: order.quoteExpiresAt.toISOString(),
      status: 'open',
    };
  }

  async prepare_payment(
    input: PreparePaymentInput,
  ): Promise<PreparePaymentOutput> {
    this.calls.prepare_payment.push(input);
    const order = this.#requireOrder(input.order_id);

    if (this.scenario === 'requote-once' && this.calls.prepare_payment.length === 1) {
      throw new HspMcpError(
        HSP_ERROR_CODES.QUOTE_EXPIRED,
        'quote expired, request a new quote',
      );
    }

    // A live re-quote may return a different total. Exercise policy re-checks.
    if (this.scenario === 'requote-once' && this.calls.prepare_payment.length === 2) {
      order.tokenTotalRaw = (BigInt(order.amountRaw) + 7n).toString();
    }

    const now = this.#now();
    const expiresAt = new Date(now.getTime() + 5 * 60_000);
    if (this.scenario === 'expired-quote-once' && !this.#expiredQuoteEmitted) {
      this.#expiredQuoteEmitted = true;
      expiresAt.setTime(now.getTime() - 60_000);
    }
    order.quoteExpiresAt = expiresAt;

    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));

    const eip712: ServerTypedData = {
      domain: {
        // Runtime fixture values, not imported from core.
        name: MOCK_EXAMPLE_DOMAIN_NAME,
        version: MOCK_EXAMPLE_DOMAIN_VERSION,
        chainId: this.#chainId,
        verifyingContract: order.token,
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: input.payer,
        to: MOCK_EXAMPLE_PAY_TO,
        value: BigInt(order.tokenTotalRaw),
        validAfter: 0n,
        validBefore: nowSeconds + 3_600n,
        nonce: `0x${randomBytes(32).toString('hex')}` as Hex,
      },
    };

    return {
      order_id: order.orderId,
      flow_id: order.flowId,
      payment_request_id: order.paymentRequestId,
      eip712,
      token_total_raw: order.tokenTotalRaw,
      quote_expires_at: expiresAt.toISOString(),
      pay_to: MOCK_EXAMPLE_PAY_TO,
      permit2: MOCK_EXAMPLE_PERMIT2,
    };
  }

  async finalize_payment(
    input: FinalizePaymentInput,
  ): Promise<FinalizePaymentOutput> {
    this.calls.finalize_payment.push(input);
    const order = this.#requireOrder(input.order_id);
    const paymentId = `pay_${order.paymentRequestId}`;
    this.#payments.set(paymentId, { orderId: order.orderId });

    return {
      payment_id: paymentId,
      order_id: order.orderId,
      status: 'submitted',
      tx_signature: null,
    };
  }

  async estimate_fee(input: EstimateFeeInput): Promise<EstimateFeeOutput> {
    // TODO(live-schema): mirror the real estimate_fee payload once confirmed
    // against docs/live-schemas.json. Shape below is plausible only.
    this.calls.estimate_fee.push(input);
    const fee = BigInt(input.amount) / 100n;
    return {
      token: input.token,
      amount_raw: input.amount,
      fee_raw: fee.toString(),
      total_raw: (BigInt(input.amount) + fee).toString(),
      fee_breakdown: [{ name: 'service_fee', amount_raw: fee.toString() }],
    };
  }

  async submit_payment(
    input: SubmitPaymentInput,
  ): Promise<SubmitPaymentOutput> {
    this.calls.submit_payment.push(input);
    this.#requirePayment(input.payment_id);

    return {
      payment_id: input.payment_id,
      status: 'submitted',
      // R3: tx_signature may be null until broadcast.
      tx_signature: null,
    };
  }

  async query_payment(
    input: QueryPaymentInput,
  ): Promise<QueryPaymentOutput> {
    this.calls.query_payment.push(input);
    this.#requirePayment(input.payment_id);

    const pollCount = (this.#pollCounts.get(input.payment_id) ?? 0) + 1;
    this.#pollCounts.set(input.payment_id, pollCount);

    const finalized = (): QueryPaymentOutput => {
      const verified =
        this.scenario !== 'attribution-mismatch' &&
        input.expected_merchant_name === this.#merchantName;

      return {
        payment_id: input.payment_id,
        status: 'payment-finalized',
        tx_signature: MOCK_TX_SIGNATURE,
        attribution_verified: verified,
        attribution_merchant_name: verified
          ? input.expected_merchant_name
          : 'example-impostor-merchant',
      };
    };

    if (this.scenario === 'payment-failed') {
      return {
        payment_id: input.payment_id,
        status: 'payment-failed',
        tx_signature: null,
        attribution_verified: false,
        status_reason: 'INSUFFICIENT_FUNDS',
      };
    }

    if (this.scenario === 'timeout-then-finalized') {
      if (pollCount <= 2) {
        return this.#status(input, 'timeout');
      }
      return finalized();
    }

    if (this.scenario === 'always-timeout') {
      return this.#status(input, 'timeout');
    }

    if (this.scenario === 'safe-then-finalized') {
      if (pollCount <= 2) {
        return this.#status(input, 'payment-safe');
      }
      return finalized();
    }

    return finalized();
  }

  #status(
    input: QueryPaymentInput,
    status: PaymentStatus,
  ): QueryPaymentOutput {
    return {
      payment_id: input.payment_id,
      status,
      tx_signature: null,
    };
  }

  #requireOrder(orderId: string): MockOrderRecord {
    const order = this.#orders.get(orderId);
    if (!order) {
      throw new HspMcpError(
        HSP_ERROR_CODES.ORDER_NOT_FOUND,
        `Unknown order: ${orderId}`,
      );
    }
    return order;
  }

  #requirePayment(paymentId: string): { orderId: string } {
    const payment = this.#payments.get(paymentId);
    if (!payment) {
      throw new HspMcpError(
        HSP_ERROR_CODES.ORDER_NOT_FOUND,
        `Unknown payment: ${paymentId}`,
      );
    }
    return payment;
  }
}
