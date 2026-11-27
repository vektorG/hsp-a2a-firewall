import 'dotenv/config';
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  maxUint256,
} from 'viem';
import { MockHspMcpClient } from '../src/mcp/client.js';
import { createLiveHspMcpClient } from '../src/mcp/liveClient.js';
import {
  chainFromConfig,
  closeClient,
  explorerTxUrl,
  isMockMode,
  merchantName,
  mockHash,
  payerAccount,
  requireEnv,
  resolveToken,
  type ClientLike,
} from './lib/common.js';

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
    const protocol = (config.payment_protocol ?? '').toLowerCase();
    const usesEip3009 = protocol.includes('3009');

    if (usesEip3009) {
      console.log(
        `payment_protocol=${config.payment_protocol}: no approve needed (EIP-3009).`,
      );
      return;
    }

    if (!config.permit2) {
      console.log(
        'No Permit2 address advertised by get_chain_config: no approve needed.',
      );
      return;
    }

    if (mock) {
      const hash = mockHash(`approve:${token.address}:${config.permit2}`);
      console.log('mode=mock (no transaction broadcast)');
      console.log(
        `would approve ${token.symbol} ${token.address} to Permit2 ${config.permit2} (max amount)`,
      );
      console.log(`mock tx hash: ${hash}`);
      const explorer = explorerTxUrl(config, hash);
      if (explorer) {
        console.log(`explorer: ${explorer}`);
      }
      return;
    }

    const chain = chainFromConfig(config);
    const rpcUrl = requireEnv('RPC_URL');
    const payer = payerAccount(false);
    const walletClient = createWalletClient({
      account: payer,
      chain,
      transport: http(rpcUrl),
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const hash = await walletClient.writeContract({
      address: token.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'approve',
      args: [config.permit2 as `0x${string}`, maxUint256],
      account: payer,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
      throw new Error(`approve transaction reverted: ${hash}`);
    }

    console.log(`approved ${token.symbol} to Permit2 ${config.permit2}`);
    console.log(`tx hash: ${hash}`);
    const explorer = explorerTxUrl(config, hash);
    if (explorer) {
      console.log(`explorer: ${explorer}`);
    }
  } finally {
    await closeClient(client);
  }
}

main().catch((error: unknown) => {
  console.error(
    'Approve failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
