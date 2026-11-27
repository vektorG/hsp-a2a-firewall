import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import {
  HspMcpError,
  isHspMcpError,
  isQuoteExpiredError,
} from '../src/mcp/client.js';
import {
  DEFAULT_CALL_TIMEOUT_MS,
  LiveHspMcpClient,
  type HspMcpTransport,
  type McpToolResult,
} from '../src/mcp/liveClient.js';
import {
  HSP_ERROR_CODES,
  type PreparePaymentOutput,
} from '../src/mcp/schemas.js';
import { MERCHANT, TOKEN, createHarness } from './helpers.js';

const TOKEN_ADDRESS = TOKEN as Address;
const PERMIT2_ADDRESS =
  '0x2222222222222222222222222222222222222222' as Address;
const EXPLORER = 'https://explorer.testnet.hsk.xyz';

function textResult(payload: unknown, isError = false): McpToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof payload === 'string' ? payload : JSON.stringify(payload),
      },
    ],
    isError,
  };
}

function laterIso(): string {
  return new Date(Date.now() + 5 * 60_000).toISOString();
}

function chainConfig() {
  return {
    chain_id: '133',
    chain_name: 'HSK Testnet',
    permits2: 'ignored',
    permit2: PERMIT2_ADDRESS,
    explorer_url: EXPLORER,
    payment_protocol: 'EIP-3009',
    gas_fee_advanced: true,
    // Guide shape: only the array is present, no `token` convenience field.
    tokens: [
      {
        address: TOKEN_ADDRESS,
        symbol: 'eHSK',
        name: 'HSK Test Token',
        decimals: 6,
        extra_token_field: 'kept',
      },
    ],
    extra_config_field: 'kept',
  };
}

function orderOutput() {
  return {
    order_id: 'order_1',
    flow_id: 'flow_1',
    payment_request_id: 'pr_1',
    merchant_name: MERCHANT,
    token: TOKEN_ADDRESS,
    amount_raw: '1000',
    token_total_raw: '1000',
    quote_expires_at: laterIso(),
    extra_order_field: { nested: true },
  };
}

function getOrderOutput() {
  return { ...orderOutput(), status: 'open', extra_status_field: 'kept' };
}

function prepareOutput() {
  return {
    order_id: 'order_1',
    flow_id: 'flow_1',
    payment_request_id: 'pr_1',
    eip712: {
      domain: {
        name: 'Example HSP Token',
        version: '1',
        chainId: 133,
        verifyingContract: TOKEN_ADDRESS,
        extra_domain: 'kept',
      },
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        TransferWithAuthorization: [
          { name: 'from', type: 'address', extra_field: 'kept' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: '0x3333333333333333333333333333333333333333',
        to: '0x4444444444444444444444444444444444444444',
        value: '1000',
        extra_message_field: 'kept',
      },
      extra_typed_data_field: 'kept',
    },
    token_total_raw: '1000',
    quote_expires_at: laterIso(),
    pay_to: '0x4444444444444444444444444444444444444444',
    permit2: PERMIT2_ADDRESS,
    payment_payload: { memo: 'keep me', nested: { a: 1 } },
    payment_mandate_contents: { mandate: 'keep me too' },
    extra_prepare_field: { deep: 'kept' },
  };
}

function clientWith(
  transport: HspMcpTransport,
  options: {
    timeoutMs?: number;
    maxReadRetries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): LiveHspMcpClient {
  return new LiveHspMcpClient({ transport, ...options });
}

describe('LiveHspMcpClient over a mock transport', () => {
  it('happy path: validates, transforms chain id and reconciles tokens[]', async () => {
    let calls = 0;
    const client = clientWith({
      async callTool() {
        calls += 1;
        return textResult(chainConfig());
      },
    });

    const config = await client.get_chain_config({});

    expect(calls).toBe(1);
    expect(config.chain_id).toBe(133);
    expect(config.token.address).toBe(TOKEN_ADDRESS);
    expect(config.tokens).toHaveLength(1);
    expect(config.tokens?.[0]?.extra_token_field).toBe('kept');
    expect((config as Record<string, unknown>).extra_config_field).toBe('kept');
    expect(client.chain_id).toBe(133);
    expect(client.tokens).toHaveLength(1);
    expect(client.tokens[0]!.address).toBe(TOKEN_ADDRESS);
    expect(client.payment_protocol).toBe('EIP-3009');
  });

  it('malformed JSON -> PARSE_ERROR with the raw payload attached', async () => {
    const client = clientWith({
      async callTool() {
        return textResult('this is not json');
      },
    });

    const error = await client.create_order({
      merchant_name: MERCHANT,
      token: TOKEN,
      amount: '1000',
    }).catch((caught: unknown) => caught);

    expect(isHspMcpError(error)).toBe(true);
    expect((error as HspMcpError).code).toBe('PARSE_ERROR');
    expect((error as HspMcpError).data).toMatchObject({
      raw: 'this is not json',
    });
  });

  it('maps server code 30043 to QUOTE_EXPIRED', async () => {
    const client = clientWith({
      async callTool() {
        return textResult(
          { code: HSP_ERROR_CODES.QUOTE_EXPIRED, message: 'quote expired' },
          true,
        );
      },
    });

    const error = await client.create_order({
      merchant_name: MERCHANT,
      token: TOKEN,
      amount: '1000',
    }).catch((caught: unknown) => caught);

    expect(isQuoteExpiredError(error)).toBe(true);
    expect((error as HspMcpError).code).toBe(30043);
  });

  it('retries reads at most twice with exponential backoff', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const client = clientWith(
      {
        async callTool(name) {
          expect(name).toBe('get_order');
          calls += 1;
          if (calls < 3) {
            throw new Error('socket hang up');
          }
          return textResult(getOrderOutput());
        },
      },
      {
        async sleep(ms) {
          sleeps.push(ms);
        },
      },
    );

    const order = await client.get_order({ order_id: 'order_1' });

    expect(order.order_id).toBe('order_1');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it('never retries writes', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const client = clientWith(
      {
        async callTool() {
          calls += 1;
          throw new Error('connection reset');
        },
      },
      {
        async sleep(ms) {
          sleeps.push(ms);
        },
      },
    );

    const error = await client.create_order({
      merchant_name: MERCHANT,
      token: TOKEN,
      amount: '1000',
    }).catch((caught: unknown) => caught);

    expect((error as HspMcpError).code).toBe('TRANSPORT_ERROR');
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('does not retry PARSE_ERROR on reads', async () => {
    let calls = 0;
    const client = clientWith({
      async callTool() {
        calls += 1;
        return textResult('{broken json');
      },
    });

    const error = await client.get_order({ order_id: 'order_1' }).catch(
      (caught: unknown) => caught,
    );

    expect((error as HspMcpError).code).toBe('PARSE_ERROR');
    expect(calls).toBe(1);
  });

  it('enforces the 30s default timeout and an injectable short timeout', async () => {
    expect(DEFAULT_CALL_TIMEOUT_MS).toBe(30_000);

    const client = clientWith(
      {
        callTool() {
          return new Promise<McpToolResult>(() => {
            // Never resolves: the timeout must win.
          });
        },
      },
      { timeoutMs: 20 },
    );

    const error = await client.create_order({
      merchant_name: MERCHANT,
      token: TOKEN,
      amount: '1000',
    }).catch((caught: unknown) => caught);

    expect((error as HspMcpError).code).toBe('TIMEOUT');
  });

  it('caches get_chain_config for the lifetime of the client', async () => {
    let calls = 0;
    const client = clientWith({
      async callTool() {
        calls += 1;
        return textResult(chainConfig());
      },
    });

    const first = await client.get_chain_config({});
    const second = await client.get_chain_config({});

    expect(calls).toBe(1);
    expect(second).toBe(first);
  });
});

describe('schema echo integrity', () => {
  it('create_order and prepare_payment preserve unknown fields', async () => {
    const client = clientWith({
      async callTool(name) {
        if (name === 'create_order') {
          return textResult(orderOutput());
        }
        return textResult(prepareOutput());
      },
    });

    const order = await client.create_order({
      merchant_name: MERCHANT,
      token: TOKEN,
      amount: '1000',
    });
    expect((order as Record<string, unknown>).extra_order_field).toEqual({
      nested: true,
    });

    const prepared = await client.prepare_payment({
      order_id: 'order_1',
      flow_id: 'flow_1',
      payment_request_id: 'pr_1',
      payer: '0x3333333333333333333333333333333333333333',
    });

    expect(prepared.payment_payload).toEqual({
      memo: 'keep me',
      nested: { a: 1 },
    });
    expect(prepared.payment_mandate_contents).toEqual({
      mandate: 'keep me too',
    });
    expect(
      (prepared as Record<string, unknown>).extra_prepare_field,
    ).toEqual({ deep: 'kept' });
    expect(
      (prepared.eip712.domain as Record<string, unknown>).extra_domain,
    ).toBe('kept');
    expect(
      (prepared.eip712.message as Record<string, unknown>)
        .extra_message_field,
    ).toBe('kept');
    expect(
      (prepared.eip712 as Record<string, unknown>).extra_typed_data_field,
    ).toBe('kept');
  });

  it('echoes unknown prepare_payment fields into finalize_payment input', async () => {
    const harness = createHarness();
    const realPrepare = harness.client.prepare_payment.bind(harness.client);

    harness.client.prepare_payment = async (input) => {
      const prepared = await realPrepare(input);
      return {
        ...prepared,
        payment_payload: { memo: 'kept', nested: { a: 1 } },
        payment_mandate_contents: { mandate: 'kept' },
        unknown_extra_field: { deep: 'kept' },
      } as PreparePaymentOutput;
    };

    let captured: Record<string, unknown> | undefined;
    const realFinalize = harness.client.finalize_payment.bind(harness.client);
    harness.client.finalize_payment = async (input) => {
      captured = input as unknown as Record<string, unknown>;
      return realFinalize(input);
    };

    const result = await harness.orchestrator.execute({
      merchantName: MERCHANT,
      token: TOKEN,
      amountRaw: '1000',
    });

    expect(result.state).toBe('SETTLED');
    expect(captured).toMatchObject({
      payment_payload: { memo: 'kept', nested: { a: 1 } },
      payment_mandate_contents: { mandate: 'kept' },
      unknown_extra_field: { deep: 'kept' },
    });
  });
});
