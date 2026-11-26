import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  MOCK_EXAMPLE_TOKEN,
  MockHspMcpClient,
  type MockScenario,
} from '../src/mcp/client.js';
import type { ServerTypedData } from '../src/mcp/schemas.js';
import {
  createAccountSigner,
  signServerTypedData,
  type PaymentSigner,
} from '../src/core/eip712.js';
import { SpendLedger } from '../src/core/ledger.js';
import { PolicyEngine } from '../src/core/policy.js';
import type { ReceiptRecorder } from '../src/core/receipt.js';
import {
  PaymentOrchestrator,
  type PaymentOrchestratorConfig,
  type TraceEvent,
} from '../src/core/stateMachine.js';

/** Public Anvil test key #0 — tests only. Never used outside tests. */
export const ANVIL_PRIVATE_KEY_0 =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export const ANVIL_ACCOUNT_0 = privateKeyToAccount(ANVIL_PRIVATE_KEY_0);
export const MERCHANT = 'kolit_vlom';
export const TOKEN = MOCK_EXAMPLE_TOKEN;
export const MOCK_RECEIPT_TX: Hex = `0x${'cd'.repeat(32)}`;

export type ReceiptRecordCall = Parameters<ReceiptRecorder['record']>[0];

export interface HarnessOptions {
  scenario?: MockScenario;
  maxTxAmount?: bigint;
  dailyLimit?: bigint;
  allowedMerchants?: readonly string[];
  allowedTokens?: readonly string[];
  signer?: PaymentSigner;
  receiptRecorder?: ReceiptRecorder;
  now?: () => Date;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  maxTimeoutRetries?: number;
  lastPaymentPath?: string;
  force?: boolean;
  onTrace?: (event: TraceEvent) => void;
}

export function createHarness(options: HarnessOptions = {}) {
  const scenario = options.scenario ?? 'happy';
  const now = options.now;
  const client = new MockHspMcpClient({ scenario, merchantName: MERCHANT, now });

  const policy = new PolicyEngine({
    maxTxAmount: options.maxTxAmount ?? 1_000_000n,
    dailyLimit: options.dailyLimit ?? 5_000_000n,
    allowedMerchants: options.allowedMerchants ?? [MERCHANT],
    allowedTokens: options.allowedTokens ?? [TOKEN],
  });

  const directory = mkdtempSync(path.join(os.tmpdir(), 'hsp-a2a-firewall-'));
  const ledger = new SpendLedger({
    filePath: path.join(directory, 'spend-ledger.json'),
    now,
  });

  const receipts: ReceiptRecordCall[] = [];
  const receiptRecorder: ReceiptRecorder = options.receiptRecorder ?? {
    async record(params) {
      receipts.push(params);
      return { txHash: MOCK_RECEIPT_TX };
    },
  };

  const signedTypedData: ServerTypedData[] = [];
  const defaultSigner = createAccountSigner(ANVIL_ACCOUNT_0);

  const signer: PaymentSigner =
    options.signer ?? {
      address: defaultSigner.address,
      async sign(typedData) {
        signedTypedData.push(typedData);
        return signServerTypedData(ANVIL_ACCOUNT_0, typedData);
      },
    };

  const config: PaymentOrchestratorConfig = {
    client,
    policy,
    ledger,
    signer,
    merchantName: MERCHANT,
    receiptRecorder,
    now,
    sleep: async () => {},
    pollIntervalMs: options.pollIntervalMs ?? 0,
    maxPollAttempts: options.maxPollAttempts ?? 20,
    maxTimeoutRetries: options.maxTimeoutRetries ?? 3,
    lastPaymentPath: options.lastPaymentPath,
    force: options.force,
    onTrace: options.onTrace,
  };

  const orchestrator = new PaymentOrchestrator(config);

  return {
    client,
    policy,
    ledger,
    orchestrator,
    receipts,
    signedTypedData,
    signer,
  };
}

export type Harness = ReturnType<typeof createHarness>;
