import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  defineChain,
  isAddress,
  keccak256,
  toHex,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MOCK_EXAMPLE_PAY_TO } from '../../src/mcp/client.js';
import type {
  GetChainConfigOutput,
  TokenConfig,
} from '../../src/mcp/schemas.js';

export const ROOT = process.cwd();

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Deterministic public demo signer. Derived at runtime so no key literal exists. */
export const DEMO_ACCOUNT = privateKeyToAccount(
  keccak256(toHex('hsp-a2a-firewall-demo-signer')),
);

export interface PolicyFile {
  maxTxAmount: string;
  dailyLimit: string;
  allowedMerchants: string[];
  allowedTokens: string[];
}

export interface ClientLike {
  get_chain_config(
    input?: Record<string, unknown>,
  ): Promise<GetChainConfigOutput>;
  close?(): Promise<void>;
}

export function isMockMode(argv: readonly string[] = process.argv): boolean {
  return argv.includes('--mock');
}

export function hasFlag(
  flag: string,
  argv: readonly string[] = process.argv,
): boolean {
  return argv.includes(flag);
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required (set it in .env)`);
  }
  return value;
}

export function requireAddress(name: string): Address {
  const value = requireEnv(name);
  if (!EVM_ADDRESS.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed EVM address`);
  }
  return value as Address;
}

export function payerPrivateKey(): Hex {
  const value = requireEnv('PAYER_PRIVATE_KEY');
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('PAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex value');
  }
  return value as Hex;
}

export function payerAccount(mock: boolean): LocalAccount {
  return mock ? DEMO_ACCOUNT : privateKeyToAccount(payerPrivateKey());
}

export function merchantName(): string {
  return process.env.MERCHANT_NAME?.trim() || 'kolit_vlom';
}

export function demoAmountRaw(): string {
  return process.env.DEMO_AMOUNT_RAW?.trim() || '1000';
}

export function sellerAddress(mock: boolean): Address {
  const configured = process.env.SELLER_ADDRESS?.trim();
  if (configured) {
    if (!EVM_ADDRESS.test(configured)) {
      throw new Error('SELLER_ADDRESS must be a 0x-prefixed EVM address');
    }
    return configured as Address;
  }

  if (mock) {
    return MOCK_EXAMPLE_PAY_TO;
  }

  throw new Error('SELLER_ADDRESS is required outside --mock mode');
}

/** Supports both the guide's `tokens[]` array and the single `token` field. */
export function resolveToken(config: GetChainConfigOutput): TokenConfig {
  const token = config.tokens?.[0] ?? config.token;

  if (!token) {
    throw new Error('get_chain_config did not advertise any token');
  }

  return token;
}

export function chainFromConfig(config: GetChainConfigOutput): Chain {
  const rpcUrl = requireEnv('RPC_URL');
  const chainId = Number(config.chain_id);

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid chain_id: ${String(config.chain_id)}`);
  }

  return defineChain({
    id: chainId,
    name: config.chain_name ?? `hsp-${chainId}`,
    nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function explorerTxUrl(
  config: GetChainConfigOutput,
  hash: string | null | undefined,
): string | undefined {
  if (!config.explorer_url || !hash) {
    return undefined;
  }
  return `${config.explorer_url.replace(/\/+$/, '')}/tx/${hash}`;
}

export function explorerAddressUrl(
  config: GetChainConfigOutput,
  address: string | null | undefined,
): string | undefined {
  if (!config.explorer_url || !address) {
    return undefined;
  }
  return `${config.explorer_url.replace(/\/+$/, '')}/address/${address}`;
}

export function resolveTokenAddress(config: GetChainConfigOutput): Address {
  const token = resolveToken(config);
  if (!isAddress(token.address)) {
    throw new Error(`Invalid token address: ${token.address}`);
  }
  return token.address;
}

export function readPolicy(): PolicyFile {
  const policyPath = path.join(ROOT, 'data', 'policy.json');

  try {
    const parsed = JSON.parse(readFileSync(policyPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const { maxTxAmount, dailyLimit, allowedMerchants, allowedTokens } = parsed;

    if (
      typeof maxTxAmount !== 'string' ||
      typeof dailyLimit !== 'string' ||
      !Array.isArray(allowedMerchants) ||
      allowedMerchants.some((value) => typeof value !== 'string') ||
      !Array.isArray(allowedTokens) ||
      allowedTokens.some(
        (value) => typeof value !== 'string' || !EVM_ADDRESS.test(value),
      )
    ) {
      throw new Error('invalid policy shape');
    }

    return {
      maxTxAmount,
      dailyLimit,
      allowedMerchants,
      allowedTokens: allowedTokens as string[],
    };
  } catch {
    return {
      maxTxAmount: '1000000',
      dailyLimit: '5000000',
      allowedMerchants: ['kolit_vlom'],
      allowedTokens: [],
    };
  }
}

export function dataFilePath(
  envName: string,
  filename: string,
): string {
  const configured = process.env[envName]?.trim();
  return configured || path.join(ROOT, 'data', filename);
}

export function writeJsonFile(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(value, bigintReplacer, 2)}\n`,
    'utf8',
  );
}

export function bigintReplacer(
  _key: string,
  value: unknown,
): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export async function closeClient(client: ClientLike): Promise<void> {
  await client.close?.();
}

export function mockHash(label: string): Hex {
  return keccak256(toHex(`hsp-mock:${label}`)) as Hex;
}

export function printTable(rows: Array<[string, string]>): void {
  const width = rows.reduce(
    (max, [label]) => Math.max(max, label.length),
    0,
  );

  for (const [label, value] of rows) {
    console.log(`${label.padEnd(width)} : ${value}`);
  }
}
