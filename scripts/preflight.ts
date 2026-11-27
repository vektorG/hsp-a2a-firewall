import 'dotenv/config';
import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
  maxUint256,
} from 'viem';
import { MockHspMcpClient } from '../src/mcp/client.js';
import { createLiveHspMcpClient } from '../src/mcp/liveClient.js';
import type { GetChainConfigOutput } from '../src/mcp/schemas.js';
import {
  chainFromConfig,
  closeClient,
  demoAmountRaw,
  explorerAddressUrl,
  isMockMode,
  merchantName,
  payerAccount,
  printTable,
  requireEnv,
  resolveToken,
  type ClientLike,
} from './lib/common.js';

interface Balances {
  gas: bigint;
  token: bigint;
  allowance?: bigint;
}

async function mockBalances(
  config: GetChainConfigOutput,
): Promise<Balances> {
  const minimum = BigInt(demoAmountRaw());

  return {
    gas: 10n ** 18n,
    token: minimum * 10n,
    allowance: config.permit2 ? maxUint256 : undefined,
  };
}

async function liveBalances(
  config: GetChainConfigOutput,
  payer: ReturnType<typeof payerAccount>,
): Promise<Balances> {
  const chain = chainFromConfig(config);
  const rpcUrl = requireEnv('RPC_URL');
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const token = resolveToken(config);

  const gas = await publicClient.getBalance({ address: payer.address });
  const tokenBalance = await publicClient.readContract({
    address: token.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [payer.address],
  });

  let allowance: bigint | undefined;

  if (config.permit2) {
    allowance = await publicClient.readContract({
      address: token.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [payer.address, config.permit2 as `0x${string}`],
    });
  }

  return { gas, token: tokenBalance, allowance };
}

async function main(): Promise<void> {
  const mock = isMockMode();
  const client: ClientLike = mock
    ? new MockHspMcpClient({
        scenario: 'happy',
        merchantName: merchantName(),
      })
    : createLiveHspMcpClient();

  try {
    const config = await client.get_chain_config({});
    const token = resolveToken(config);
    const payer = payerAccount(mock);
    const balances = mock
      ? await mockBalances(config)
      : await liveBalances(config, payer);

    const rows: Array<[string, string]> = [
      ['Mode', mock ? 'mock (no RPC calls, no broadcast)' : 'live'],
      ['Chain', `${config.chain_name ?? 'unknown'} (${config.chain_id})`],
      ['Token', `${token.symbol} ${token.address}`],
      ['Token decimals', String(token.decimals)],
      ['Payer', payer.address],
      ['Gas balance', `${formatUnits(balances.gas, 18)} native`],
      [
        'Token balance',
        `${formatUnits(balances.token, token.decimals)} ${token.symbol} (${balances.token} raw)`,
      ],
      ['Permit2', config.permit2 ?? 'n/a (EIP-3009 rail)'],
      [
        'Allowance',
        balances.allowance === undefined
          ? 'n/a (no Permit2)'
          : `${balances.allowance === maxUint256 ? 'unlimited' : balances.allowance.toString()} raw`,
      ],
    ];

    const payerExplorer = explorerAddressUrl(config, payer.address);
    if (payerExplorer) {
      rows.push(['Payer explorer', payerExplorer]);
    }

    printTable(rows);

    if (balances.token < BigInt(demoAmountRaw())) {
      console.log(
        `WARNING: token balance is below DEMO_AMOUNT_RAW (${demoAmountRaw()}).`,
      );
    }
  } finally {
    await closeClient(client);
  }
}

main().catch((error: unknown) => {
  console.error(
    'Preflight failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
