import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { computeOrderIdHash } from '../src/core/receipt.js';
import { ANVIL_ACCOUNT_0, MERCHANT, TOKEN } from './helpers.js';

const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const anvilAvailable = spawnSync('anvil', ['--version']).status === 0;

async function nodeChainId(): Promise<number> {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  });
  const json = (await response.json()) as { result: string };
  return Number(BigInt(json.result));
}

describe.skipIf(!anvilAvailable)('AgentReceiptRegistry on a local anvil node (C6)', () => {
  let node: ChildProcess | undefined;
  let chain: Chain;
  let abi: Abi;
  let registry: Address;

  const publicClient = () => createPublicClient({ chain, transport: http(RPC) });
  const receiptArgs = (id: string) =>
    [computeOrderIdHash(id), MERCHANT, TOKEN, 1000n] as const;

  beforeAll(async () => {
    const compiled = spawnSync('npm', ['run', 'compile:contracts'], {
      encoding: 'utf8',
    });
    if (compiled.status !== 0) {
      throw new Error(`compile:contracts failed: ${compiled.stderr}`);
    }
    const artifact = JSON.parse(
      readFileSync(
        path.join(process.cwd(), 'artifacts', 'AgentReceiptRegistry.json'),
        'utf8',
      ),
    ) as { abi: Abi; bytecode: Hex };
    abi = artifact.abi;

    node = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });

    let chainId: number | undefined;
    for (let attempt = 0; attempt < 50 && chainId === undefined; attempt += 1) {
      try {
        chainId = await nodeChainId();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (chainId === undefined) {
      throw new Error('anvil did not start');
    }

    chain = defineChain({
      id: chainId,
      name: 'local-anvil',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [RPC] } },
    });

    const wallet = createWalletClient({
      account: ANVIL_ACCOUNT_0,
      chain,
      transport: http(RPC),
    });
    const hash = await wallet.deployContract({
      abi,
      bytecode: artifact.bytecode,
      args: [],
      account: ANVIL_ACCOUNT_0,
      chain,
    });
    const receipt = await publicClient().waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error('registry deployment failed');
    }
    registry = receipt.contractAddress;
  }, 60_000);

  afterAll(() => {
    node?.kill();
  });

  it('reverts NotRecorder for a caller that is not the deployer', async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());

    await expect(
      publicClient().simulateContract({
        address: registry,
        abi,
        functionName: 'recordReceipt',
        args: receiptArgs('pr_it_unauthorised'),
        account: stranger,
      }),
    ).rejects.toThrow(/NotRecorder/);
  });

  it('records once for the recorder, then reverts ReceiptAlreadyRecorded', async () => {
    const wallet = createWalletClient({
      account: ANVIL_ACCOUNT_0,
      chain,
      transport: http(RPC),
    });
    const id = 'pr_it_once';

    const hash = await wallet.writeContract({
      address: registry,
      abi,
      functionName: 'recordReceipt',
      args: receiptArgs(id),
      account: ANVIL_ACCOUNT_0,
      chain,
    });
    const receipt = await publicClient().waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe('success');

    const stored = (await publicClient().readContract({
      address: registry,
      abi,
      functionName: 'receipts',
      args: [computeOrderIdHash(id)],
    })) as readonly unknown[];
    expect(stored[2]).toBe(MERCHANT);
    expect(stored[5]).not.toBe(0n);

    await expect(
      publicClient().simulateContract({
        address: registry,
        abi,
        functionName: 'recordReceipt',
        args: receiptArgs(id),
        account: ANVIL_ACCOUNT_0,
      }),
    ).rejects.toThrow(/ReceiptAlreadyRecorded/);
  });
});
