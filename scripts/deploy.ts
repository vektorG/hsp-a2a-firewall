import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

interface Artifact {
  contractName: string;
  abi: Abi;
  bytecode: Hex;
}

const root = process.cwd();
const rpcUrl = process.env.RPC_URL;
const chainIdRaw = process.env.CHAIN_ID;
const privateKey = process.env.PAYER_PRIVATE_KEY;

if (!rpcUrl) {
  throw new Error('RPC_URL is required in .env');
}
if (!chainIdRaw || !/^[0-9]+$/.test(chainIdRaw)) {
  throw new Error('CHAIN_ID must be a positive integer in .env');
}
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error('PAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex value in .env');
}

const chainId = Number(chainIdRaw);
const artifactPath = path.join(root, 'artifacts', 'AgentReceiptRegistry.json');
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Artifact;

const chain = defineChain({
  id: chainId,
  name: `hsp-${chainId}`,
  nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

const account = privateKeyToAccount(privateKey as Hex);
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl),
});
const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

console.log(
  `Deploying ${artifact.contractName} to chain ${chainId} from ${account.address} ...`,
);

const txHash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [],
  account,
  chain,
});

const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

if (receipt.status !== 'success' || !receipt.contractAddress) {
  throw new Error(`Deployment failed or reverted: ${txHash}`);
}

const deployment = {
  chainId,
  contractName: artifact.contractName,
  address: receipt.contractAddress,
  recorder: account.address,
  txHash,
  deployedAt: new Date().toISOString(),
};

const deploymentDirectory = path.join(root, 'deployments');
mkdirSync(deploymentDirectory, { recursive: true });
const deploymentPath = path.join(deploymentDirectory, `${chainId}.json`);
writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`, 'utf8');

console.log(`Deployed ${receipt.contractAddress}`);
console.log(`Wrote ${path.relative(root, deploymentPath)}`);
