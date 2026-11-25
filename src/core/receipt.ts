import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Minimal ABI for AgentReceiptRegistry. Kept in sync with
 * contracts/AgentReceiptRegistry.sol.
 */
export const agentReceiptRegistryAbi = [
  {
    type: 'function',
    name: 'recordReceipt',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderIdHash', type: 'bytes32' },
      { name: 'merchantName', type: 'string' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'receipts',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [
      { name: 'orderIdHash', type: 'bytes32' },
      { name: 'payer', type: 'address' },
      { name: 'merchantName', type: 'string' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'settledAt', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'recorder',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'ReceiptRecorded',
    inputs: [
      { name: 'orderIdHash', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'merchantName', type: 'string', indexed: false },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'settledAt', type: 'uint64', indexed: false },
    ],
  },
  { type: 'constructor', stateMutability: 'nonpayable', inputs: [] },
] as const;

/**
 * R6: the ledger/registry key is `keccak256(toHex(payment_request_id))`.
 *
 * `payment_request_id` is a variable-length UTF-8 string. On-chain the key
 * must be exactly bytes32, so we hash the full UTF-8 byte sequence (viem's
 * `toHex` hex-encodes the string) instead of truncating or reinterpreting it.
 * That keeps the mapping collision-resistant and reversible only by indexing
 * the id off-chain. Using `toHex(id)` without hashing would silently drop
 * bytes for ids shorter than 32 bytes and reject longer ones.
 */
export function computeOrderIdHash(paymentRequestId: string): Hex {
  return keccak256(toHex(paymentRequestId));
}

export interface ReceiptRecord {
  orderIdHash: Hex;
  merchantName: string;
  token: Address;
  amount: bigint;
}

/** ABI-encodes the `recordReceipt` calldata. Unit-testable without a chain. */
export function encodeRecordReceipt(record: ReceiptRecord): Hex {
  return encodeFunctionData({
    abi: agentReceiptRegistryAbi,
    functionName: 'recordReceipt',
    args: [record.orderIdHash, record.merchantName, record.token, record.amount],
  });
}

export function decodeRecordReceipt(data: Hex): ReceiptRecord {
  const decoded = decodeFunctionData({
    abi: agentReceiptRegistryAbi,
    data,
  });

  if (decoded.functionName !== 'recordReceipt') {
    throw new Error(`Unexpected calldata function: ${decoded.functionName}`);
  }

  const [orderIdHash, merchantName, token, amount] = decoded.args;
  return { orderIdHash, merchantName, token, amount };
}

export interface RecordReceiptOnChainParams {
  /** Chain object built at runtime from get_chain_config / env (R5). */
  chain: Chain;
  rpcUrl: string;
  privateKey: Hex;
  registryAddress: Address;
  paymentRequestId: string;
  merchantName: string;
  token: Address;
  amount: bigint;
}

export interface RecordedReceipt {
  orderIdHash: Hex;
  txHash: Hex;
}

/**
 * Live on-chain receipt write (used after SETTLED, never before).
 * All chain parameters are injected at runtime; no chain id, token address,
 * decimals or registry address is hardcoded here (R5).
 */
export async function recordReceiptOnChain(
  params: RecordReceiptOnChainParams,
): Promise<RecordedReceipt> {
  const account = privateKeyToAccount(params.privateKey);
  const walletClient = createWalletClient({
    account,
    chain: params.chain,
    transport: http(params.rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: params.chain,
    transport: http(params.rpcUrl),
  });

  const orderIdHash = computeOrderIdHash(params.paymentRequestId);
  const txHash = await walletClient.writeContract({
    address: params.registryAddress,
    abi: agentReceiptRegistryAbi,
    functionName: 'recordReceipt',
    args: [orderIdHash, params.merchantName, params.token, params.amount],
    account,
    chain: params.chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== 'success') {
    throw new Error(`recordReceipt transaction reverted: ${txHash}`);
  }

  return { orderIdHash, txHash };
}

/** Side-effect seam used by the state machine (real or fake in tests). */
export interface ReceiptRecorder {
  record(params: {
    paymentRequestId: string;
    merchantName: string;
    token: Address;
    amount: bigint;
  }): Promise<{ txHash?: Hex }>;
}

/** Builds the production recorder around `recordReceiptOnChain`. */
export function createViemReceiptRecorder(config: {
  chain: Chain;
  rpcUrl: string;
  privateKey: Hex;
  registryAddress: Address;
}): ReceiptRecorder {
  return {
    async record(params) {
      const result = await recordReceiptOnChain({
        ...config,
        paymentRequestId: params.paymentRequestId,
        merchantName: params.merchantName,
        token: params.token,
        amount: params.amount,
      });
      return { txHash: result.txHash };
    },
  };
}
