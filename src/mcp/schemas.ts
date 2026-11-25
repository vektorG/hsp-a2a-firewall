import { z } from 'zod';

/**
 * Single source of truth for HSP MCP wire shapes.
 *
 * Everything in `src/` imports inferred TypeScript types from this module.
 * Raw token amounts are decimal integer strings in base units so that values
 * larger than Number.MAX_SAFE_INTEGER never lose precision in transit.
 */

export const evmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'invalid EVM address');

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'invalid bytes32 value');

export const hexDataSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/, 'invalid 0x-prefixed hex data');

export const signatureSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/, 'expected a 65-byte 0x-prefixed signature');

export const amountRawSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)$/, 'amount must be an unsigned base-unit integer string');

export const isoDateTimeSchema = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'expected an ISO-8601 date-time string',
);

export const chainIdSchema = z
  .union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]*$/)])
  .transform((value) => (typeof value === 'string' ? Number(value) : value));

export const paymentStatusSchema = z.enum([
  'submitted',
  'verified',
  'processing',
  'included',
  'timeout',
  'payment-timeout',
  'payment-safe',
  'payment-finalized',
  'payment-failed',
]);

export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/** Statuses that MUST continue polling (R3). */
export const POLLING_STATUSES = [
  'submitted',
  'verified',
  'processing',
  'included',
  'timeout',
  'payment-timeout',
] as const satisfies readonly PaymentStatus[];

export const HSP_ERROR_CODES = {
  QUOTE_EXPIRED: 30043,
  INVALID_REQUEST: 40000,
  UNAUTHORIZED: 40100,
  ORDER_NOT_FOUND: 40400,
  CONFLICT: 40900,
  PAYMENT_REJECTED: 42200,
  INTERNAL_ERROR: 50000,
} as const;

export type HspErrorCode = (typeof HSP_ERROR_CODES)[keyof typeof HSP_ERROR_CODES];

export const hspErrorCodeSchema = z.union([
  z.literal(HSP_ERROR_CODES.QUOTE_EXPIRED),
  z.literal(HSP_ERROR_CODES.INVALID_REQUEST),
  z.literal(HSP_ERROR_CODES.UNAUTHORIZED),
  z.literal(HSP_ERROR_CODES.ORDER_NOT_FOUND),
  z.literal(HSP_ERROR_CODES.CONFLICT),
  z.literal(HSP_ERROR_CODES.PAYMENT_REJECTED),
  z.literal(HSP_ERROR_CODES.INTERNAL_ERROR),
]);

export const hspErrorResponseSchema = z.object({
  code: hspErrorCodeSchema,
  message: z.string(),
  data: z.unknown().optional(),
});

export type HspErrorResponse = z.infer<typeof hspErrorResponseSchema>;

// ---------------------------------------------------------------------------
// EIP-712
// ---------------------------------------------------------------------------

export const typedDataFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
});

export const typedDataTypesSchema = z.record(
  z.string(),
  z.array(typedDataFieldSchema),
);

export const typedDataDomainSchema = z.object({
  name: z.string(),
  version: z.string(),
  chainId: chainIdSchema,
  verifyingContract: evmAddressSchema,
  salt: bytes32Schema.optional(),
});

/**
 * The exact object returned by `prepare_payment`. Production signing uses it
 * verbatim (R1); only the `EIP712Domain` type entry is stripped because viem
 * derives the domain separator from `domain`.
 */
export const serverTypedDataSchema = z.object({
  domain: typedDataDomainSchema,
  types: typedDataTypesSchema,
  primaryType: z.string().min(1),
  message: z.record(z.string(), z.unknown()),
});

export type ServerTypedData = z.infer<typeof serverTypedDataSchema>;

// ---------------------------------------------------------------------------
// 1. get_chain_config
// ---------------------------------------------------------------------------

export const tokenConfigSchema = z.object({
  address: evmAddressSchema,
  symbol: z.string(),
  decimals: z.number().int().min(0),
  name: z.string().optional(),
});

export type TokenConfig = z.infer<typeof tokenConfigSchema>;

export const getChainConfigInputSchema = z.object({});

export const getChainConfigOutputSchema = z.object({
  chain_id: chainIdSchema,
  chain_name: z.string().optional(),
  token: tokenConfigSchema,
  /** Permit2 contract address, when the chain uses Permit2. Runtime-only (R5). */
  permit2: evmAddressSchema.optional(),
  explorer_url: z.string().url().optional(),
});

export type GetChainConfigInput = z.infer<typeof getChainConfigInputSchema>;
export type GetChainConfigOutput = z.infer<typeof getChainConfigOutputSchema>;

// ---------------------------------------------------------------------------
// 2. create_order
// ---------------------------------------------------------------------------

export const createOrderInputSchema = z.object({
  merchant_name: z.string().min(1),
  token: evmAddressSchema,
  amount: amountRawSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createOrderOutputSchema = z.object({
  order_id: z.string().min(1),
  flow_id: z.string().min(1),
  payment_request_id: z.string().min(1),
  merchant_name: z.string().optional(),
  token: evmAddressSchema,
  amount_raw: amountRawSchema,
  token_total_raw: amountRawSchema,
  quote_expires_at: isoDateTimeSchema,
});

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
export type CreateOrderOutput = z.infer<typeof createOrderOutputSchema>;

// ---------------------------------------------------------------------------
// 3. get_order
// ---------------------------------------------------------------------------

export const getOrderInputSchema = z.object({
  order_id: z.string().min(1),
});

export const getOrderOutputSchema = createOrderOutputSchema.extend({
  status: z.string(),
  created_at: isoDateTimeSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type GetOrderInput = z.infer<typeof getOrderInputSchema>;
export type GetOrderOutput = z.infer<typeof getOrderOutputSchema>;

// ---------------------------------------------------------------------------
// 4. prepare_payment
// ---------------------------------------------------------------------------

export const preparePaymentInputSchema = z.object({
  order_id: z.string().min(1),
  flow_id: z.string().min(1),
  payment_request_id: z.string().min(1),
  payer: evmAddressSchema,
});

export const preparePaymentOutputSchema = z.object({
  order_id: z.string().min(1),
  flow_id: z.string().min(1),
  payment_request_id: z.string().min(1),
  eip712: serverTypedDataSchema,
  token_total_raw: amountRawSchema,
  quote_expires_at: isoDateTimeSchema,
  pay_to: evmAddressSchema,
  permit2: evmAddressSchema.optional(),
});

export type PreparePaymentInput = z.infer<typeof preparePaymentInputSchema>;
export type PreparePaymentOutput = z.infer<typeof preparePaymentOutputSchema>;

// ---------------------------------------------------------------------------
// 5. finalize_payment
// ---------------------------------------------------------------------------

export const finalizePaymentInputSchema = z.object({
  order_id: z.string().min(1),
  payment_request_id: z.string().min(1),
  payer: evmAddressSchema,
  signature: signatureSchema,
});

export const finalizePaymentOutputSchema = z.object({
  payment_id: z.string().min(1),
  order_id: z.string().min(1),
  status: paymentStatusSchema,
  tx_signature: z.string().nullable().optional(),
});

export type FinalizePaymentInput = z.infer<typeof finalizePaymentInputSchema>;
export type FinalizePaymentOutput = z.infer<typeof finalizePaymentOutputSchema>;

// ---------------------------------------------------------------------------
// 6. estimate_fee
// ---------------------------------------------------------------------------

export const estimateFeeInputSchema = z.object({
  token: evmAddressSchema,
  amount: amountRawSchema,
});

export const estimateFeeOutputSchema = z.object({
  token: evmAddressSchema,
  amount_raw: amountRawSchema,
  fee_raw: amountRawSchema,
  fee_token: evmAddressSchema.optional(),
  total_raw: amountRawSchema,
  fee_breakdown: z
    .array(
      z.object({
        name: z.string(),
        amount_raw: amountRawSchema,
      }),
    )
    .optional(),
});

export type EstimateFeeInput = z.infer<typeof estimateFeeInputSchema>;
export type EstimateFeeOutput = z.infer<typeof estimateFeeOutputSchema>;

// ---------------------------------------------------------------------------
// 7. submit_payment
// ---------------------------------------------------------------------------

export const submitPaymentInputSchema = z.object({
  order_id: z.string().min(1),
  payment_id: z.string().min(1),
  signature: signatureSchema,
});

export const submitPaymentOutputSchema = z.object({
  payment_id: z.string().min(1),
  status: paymentStatusSchema,
  /** Null until the transaction is broadcast (R3). */
  tx_signature: z.string().nullable().optional(),
});

export type SubmitPaymentInput = z.infer<typeof submitPaymentInputSchema>;
export type SubmitPaymentOutput = z.infer<typeof submitPaymentOutputSchema>;

// ---------------------------------------------------------------------------
// 8. query_payment
// ---------------------------------------------------------------------------

export const queryPaymentInputSchema = z.object({
  payment_id: z.string().min(1),
  /** Sent on EVERY query (R3). */
  expected_merchant_name: z.string().min(1),
});

export const queryPaymentOutputSchema = z.object({
  payment_id: z.string().min(1),
  status: paymentStatusSchema,
  tx_signature: z.string().nullable().optional(),
  attribution_verified: z.boolean().optional(),
  attribution_merchant_name: z.string().optional(),
  status_reason: z.string().optional(),
});

export type QueryPaymentInput = z.infer<typeof queryPaymentInputSchema>;
export type QueryPaymentOutput = z.infer<typeof queryPaymentOutputSchema>;

export const hspToolSchemas = {
  get_chain_config: {
    input: getChainConfigInputSchema,
    output: getChainConfigOutputSchema,
  },
  create_order: {
    input: createOrderInputSchema,
    output: createOrderOutputSchema,
  },
  get_order: {
    input: getOrderInputSchema,
    output: getOrderOutputSchema,
  },
  prepare_payment: {
    input: preparePaymentInputSchema,
    output: preparePaymentOutputSchema,
  },
  finalize_payment: {
    input: finalizePaymentInputSchema,
    output: finalizePaymentOutputSchema,
  },
  estimate_fee: {
    input: estimateFeeInputSchema,
    output: estimateFeeOutputSchema,
  },
  submit_payment: {
    input: submitPaymentInputSchema,
    output: submitPaymentOutputSchema,
  },
  query_payment: {
    input: queryPaymentInputSchema,
    output: queryPaymentOutputSchema,
  },
} as const;

export type HspToolName = keyof typeof hspToolSchemas;
