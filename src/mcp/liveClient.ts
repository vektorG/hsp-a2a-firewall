import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Address } from 'viem';
import { HspMcpError, isHspMcpError, type IHspMcpClient } from './client.js';
import {
  HSP_ERROR_CODES,
  hspToolSchemas,
  type CreateOrderInput,
  type CreateOrderOutput,
  type EstimateFeeInput,
  type EstimateFeeOutput,
  type FinalizePaymentInput,
  type FinalizePaymentOutput,
  type GetChainConfigInput,
  type GetChainConfigOutput,
  type GetOrderInput,
  type GetOrderOutput,
  type HspToolName,
  type PreparePaymentInput,
  type PreparePaymentOutput,
  type QueryPaymentInput,
  type QueryPaymentOutput,
  type SubmitPaymentInput,
  type SubmitPaymentOutput,
  type TokenConfig,
} from './schemas.js';

export const DEFAULT_HSP_MCP_URL = 'https://mcp-qa.hashkeymerchant.com/';
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;
export const DEFAULT_READ_RETRIES = 2;
export const DEFAULT_RETRY_BACKOFF_MS = 250;

/**
 * Tools that are safe to retry. Everything that creates an order, prepares a
 * signature payload or submits a payment is NEVER auto-retried (a retry could
 * duplicate an order or a transfer).
 */
export const READ_ONLY_TOOLS: readonly HspToolName[] = [
  'get_chain_config',
  'get_order',
  'query_payment',
  'estimate_fee',
];

/** The raw shape returned by a transport's `callTool` (MCP CallToolResult). */
export interface McpToolResult {
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Minimal transport seam. The default implementation wraps the official
 * `@modelcontextprotocol/sdk` Client + StreamableHTTPClientTransport; tests
 * inject an in-memory mock so no live gateway call is ever made.
 */
export interface HspMcpTransport {
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<McpToolResult>;
  close?(): Promise<void>;
}

export interface LiveHspMcpClientOptions {
  /** Defaults to `HSP_MCP_URL` or the QA gateway. */
  url?: string;
  /** Test seam: bypass the SDK with a mock transport. */
  transport?: HspMcpTransport;
  /** Per-call timeout. Defaults to 30s. */
  timeoutMs?: number;
  /** Retries for idempotent reads only. Defaults to 2. */
  maxReadRetries?: number;
  /** Exponential backoff base. Defaults to 250ms. */
  retryBackoffMs?: number;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

type ErrorCode = HspMcpError['code'];

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Wraps the SDK client as the transport seam used by `LiveHspMcpClient`. */
function createSdkTransport(transport: Transport): HspMcpTransport {
  let clientPromise: Promise<Client> | null = null;

  const getClient = (): Promise<Client> => {
    clientPromise ??= (async () => {
      const client = new Client(
        { name: 'hsp-a2a-firewall', version: '0.1.0' },
        { capabilities: {} },
      );
      await client.connect(transport);
      return client;
    })();

    return clientPromise;
  };

  return {
    async callTool(name, args, options) {
      const client = await getClient();
      return client.callTool(
        { name, arguments: args },
        undefined,
        options,
      ) as Promise<McpToolResult>;
    },
    async close() {
      if (clientPromise !== null) {
        await (await clientPromise).close();
      }
    },
  };
}

/** Extracts the textual JSON payload from an MCP tool result. */
function extractPayload(result: McpToolResult): unknown {
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (
        item !== null &&
        typeof item === 'object' &&
        item.type === 'text' &&
        typeof item.text === 'string'
      ) {
        return item.text;
      }
    }
  }

  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  return undefined;
}

function parseJsonPayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Pulls a server error code out of SDK/thrown error shapes. */
function extractServerCode(error: unknown): ErrorCode | undefined {
  if (isHspMcpError(error)) {
    return error.code;
  }

  if (!isRecord(error)) {
    return undefined;
  }

  if (isRecord(error.data)) {
    const nested = error.data.code;
    if (typeof nested === 'number') {
      return nested;
    }
    if (typeof nested === 'string' && /^[0-9]+$/.test(nested)) {
      return Number(nested);
    }
  }

  if (typeof error.code === 'number') {
    return error.code;
  }
  if (typeof error.code === 'string' && /^[0-9]+$/.test(error.code)) {
    return Number(error.code);
  }

  return undefined;
}

function extractMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

/**
 * Live HSP MCP client backed by the official MCP SDK.
 *
 * - Every result is a text JSON payload validated against `schemas.ts`.
 * - Validation failures raise `PARSE_ERROR` with the raw payload attached.
 * - Error `30043` maps to `QUOTE_EXPIRED` so the orchestrator's existing
 *   re-quote path is reused.
 * - 30s per-call timeout. Only idempotent reads retry (max 2, backoff).
 * - `get_chain_config` is cached for the lifetime of the client.
 */
export class LiveHspMcpClient implements IHspMcpClient {
  readonly url: string;

  readonly #transport: HspMcpTransport;
  readonly #timeoutMs: number;
  readonly #maxReadRetries: number;
  readonly #retryBackoffMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  #chainConfig?: GetChainConfigOutput;

  constructor(options: LiveHspMcpClientOptions = {}) {
    this.url = options.url ?? process.env.HSP_MCP_URL ?? DEFAULT_HSP_MCP_URL;
    this.#transport =
      options.transport ??
      createSdkTransport(new StreamableHTTPClientTransport(new URL(this.url)));
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.#maxReadRetries = options.maxReadRetries ?? DEFAULT_READ_RETRIES;
    this.#retryBackoffMs =
      options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  // ---- Cached chain configuration (R5: runtime-only values). ------------

  get chain_id(): number | undefined {
    return this.#chainConfig?.chain_id;
  }

  get tokens(): TokenConfig[] {
    if (!this.#chainConfig) {
      return [];
    }

    const advertised = this.#chainConfig.tokens;
    if (advertised !== undefined && advertised.length > 0) {
      return advertised;
    }

    return [this.#chainConfig.token];
  }

  get payment_protocol(): string | undefined {
    return this.#chainConfig?.payment_protocol;
  }

  get gas_fee_advanced(): boolean | undefined {
    return this.#chainConfig?.gas_fee_advanced;
  }

  // ---- IHspMcpClient ---------------------------------------------------

  async get_chain_config(
    input: GetChainConfigInput = {},
  ): Promise<GetChainConfigOutput> {
    if (this.#chainConfig !== undefined) {
      return this.#chainConfig;
    }

    const config = (await this.#invoke(
      'get_chain_config',
      input,
    )) as GetChainConfigOutput;
    this.#chainConfig = config;
    return config;
  }

  async create_order(input: CreateOrderInput): Promise<CreateOrderOutput> {
    return (await this.#invoke('create_order', input)) as CreateOrderOutput;
  }

  async get_order(input: GetOrderInput): Promise<GetOrderOutput> {
    return (await this.#invoke('get_order', input)) as GetOrderOutput;
  }

  async prepare_payment(
    input: PreparePaymentInput,
  ): Promise<PreparePaymentOutput> {
    return (await this.#invoke(
      'prepare_payment',
      input,
    )) as PreparePaymentOutput;
  }

  async finalize_payment(
    input: FinalizePaymentInput,
  ): Promise<FinalizePaymentOutput> {
    return (await this.#invoke(
      'finalize_payment',
      input,
    )) as FinalizePaymentOutput;
  }

  async estimate_fee(input: EstimateFeeInput): Promise<EstimateFeeOutput> {
    return (await this.#invoke('estimate_fee', input)) as EstimateFeeOutput;
  }

  async submit_payment(
    input: SubmitPaymentInput,
  ): Promise<SubmitPaymentOutput> {
    return (await this.#invoke(
      'submit_payment',
      input,
    )) as SubmitPaymentOutput;
  }

  async query_payment(input: QueryPaymentInput): Promise<QueryPaymentOutput> {
    return (await this.#invoke(
      'query_payment',
      input,
    )) as QueryPaymentOutput;
  }

  /** Generic entry point; named methods delegate here. */
  async callTool(
    name: HspToolName,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return this.#invoke(name, args);
  }

  async close(): Promise<void> {
    await this.#transport.close?.();
  }

  // ---- Internals -------------------------------------------------------

  async #invoke(
    name: HspToolName,
    input: unknown,
  ): Promise<unknown> {
    const args = (input ?? {}) as Record<string, unknown>;
    const isRead = READ_ONLY_TOOLS.includes(name);
    const maxAttempts = isRead ? this.#maxReadRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.#callOnce(name, args);
      } catch (error) {
        lastError = this.#normalizeError(error);

        if (attempt >= maxAttempts) {
          throw lastError;
        }

        if (!this.#isRetryable(lastError)) {
          throw lastError;
        }

        await this.#sleep(this.#retryBackoffMs * 2 ** (attempt - 1));
      }
    }

    throw lastError;
  }

  async #callOnce(
    name: HspToolName,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const result = await this.#withTimeout((signal) =>
      this.#transport.callTool(name, args, { signal }),
    );

    const payload = extractPayload(result);

    if (result.isError === true) {
      throw this.#serverError(payload);
    }

    if (typeof payload === 'string') {
      const parsed = parseJsonPayload(payload);

      if (parsed === undefined) {
        throw new HspMcpError(
          'PARSE_ERROR',
          `HSP MCP ${name} returned non-JSON content: ${payload}`,
          { raw: payload },
        );
      }

      return this.#validate(name, parsed, payload);
    }

    if (payload === undefined) {
      throw new HspMcpError(
        'PARSE_ERROR',
        `HSP MCP ${name} returned no text or structured content`,
      );
    }

    return this.#validate(name, payload, JSON.stringify(payload));
  }

  #serverError(payload: unknown): HspMcpError {
    const parsed =
      typeof payload === 'string' ? parseJsonPayload(payload) : payload;

    if (isRecord(parsed)) {
      const code = parsed.code;
      if (typeof code === 'number') {
        return new HspMcpError(
          code,
          typeof parsed.message === 'string'
            ? parsed.message
            : `HSP MCP tool error ${code}`,
          parsed.data,
        );
      }
      if (typeof code === 'string' && /^[0-9]+$/.test(code)) {
        return new HspMcpError(
          Number(code),
          typeof parsed.message === 'string'
            ? parsed.message
            : `HSP MCP tool error ${code}`,
          parsed.data,
        );
      }
      if (typeof parsed.message === 'string') {
        return new HspMcpError('TOOL_ERROR', parsed.message, parsed.data);
      }
    }

    return new HspMcpError(
      'TOOL_ERROR',
      `HSP MCP tool error: ${
        typeof payload === 'string' ? payload : JSON.stringify(payload)
      }`,
      { raw: payload },
    );
  }

  #validate(
    name: HspToolName,
    parsed: unknown,
    raw: string,
  ): unknown {
    // Reconcile the guide's `tokens[]` array with the single-token convenience
    // field the rest of the codebase uses. Nothing is dropped: `tokens` stays
    // on the object (the schema is passthrough).
    const candidate =
      name === 'get_chain_config' &&
      isRecord(parsed) &&
      parsed.token === undefined &&
      Array.isArray(parsed.tokens) &&
      parsed.tokens.length > 0
        ? { ...parsed, token: parsed.tokens[0] }
        : parsed;

    const schema = hspToolSchemas[name].output;
    const validated = schema.safeParse(candidate);

    if (!validated.success) {
      const issues = validated.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');

      throw new HspMcpError(
        'PARSE_ERROR',
        `HSP MCP ${name} output failed schema validation (${issues}) raw=${raw}`,
        { raw, issues: validated.error.issues },
      );
    }

    return validated.data;
  }

  #normalizeError(error: unknown): unknown {
    if (isHspMcpError(error)) {
      return error;
    }

    const code = extractServerCode(error);

    if (code !== undefined) {
      const mapped =
        code === HSP_ERROR_CODES.QUOTE_EXPIRED
          ? HSP_ERROR_CODES.QUOTE_EXPIRED
          : code;
      return new HspMcpError(
        mapped,
        extractMessage(error, `HSP MCP error ${String(code)}`),
        isRecord(error) ? error.data : undefined,
      );
    }

    return new HspMcpError(
      'TRANSPORT_ERROR',
      extractMessage(error, 'HSP MCP transport error'),
    );
  }

  #isRetryable(error: unknown): boolean {
    if (!isHspMcpError(error)) {
      return true;
    }

    // Only transport-level failures are safe to retry. A PARSE_ERROR means the
    // server answered with an unexpected payload; retrying cannot fix that and
    // could hide a schema drift.
    return error.code === 'TRANSPORT_ERROR' || error.code === 'TIMEOUT';
  }

  async #withTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new HspMcpError(
            'TIMEOUT',
            `HSP MCP call timed out after ${this.#timeoutMs}ms`,
          ),
        );
      }, this.#timeoutMs);
    });

    try {
      return await Promise.race([operation(controller.signal), timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

/** Convenience factory used by the scripts. */
export function createLiveHspMcpClient(
  options: LiveHspMcpClientOptions = {},
): LiveHspMcpClient {
  return new LiveHspMcpClient(options);
}

/** Re-exported for scripts/tests that only import this module. */
export type { Address };
