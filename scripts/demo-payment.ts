import 'dotenv/config';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAccountSigner } from '../src/core/eip712.js';
import { SpendLedger } from '../src/core/ledger.js';
import { PolicyEngine } from '../src/core/policy.js';
import {
  createViemReceiptRecorder,
  type ReceiptRecorder,
} from '../src/core/receipt.js';
import {
  PaymentOrchestrator,
  type PaymentOutcome,
  type PaymentRequest,
  type TraceEvent,
} from '../src/core/stateMachine.js';
import {
  MockHspMcpClient,
  type IHspMcpClient,
} from '../src/mcp/client.js';
import { createLiveHspMcpClient } from '../src/mcp/liveClient.js';
import type { GetChainConfigOutput } from '../src/mcp/schemas.js';
import {
  chainFromConfig,
  closeClient,
  dataFilePath,
  demoAmountRaw,
  explorerTxUrl,
  hasFlag,
  isMockMode,
  merchantName,
  mockHash,
  payerAccount,
  payerPrivateKey,
  readPolicy,
  requireAddress,
  requireEnv,
  resolveToken,
  sellerAddress,
  writeJsonFile,
} from './lib/common.js';

function mockReceiptRecorder(): ReceiptRecorder {
  return {
    async record(params) {
      return {
        txHash: mockHash(
          `receipt:${params.paymentRequestId}:${params.merchantName}`,
        ),
      };
    },
  };
}

function liveReceiptRecorder(config: GetChainConfigOutput): ReceiptRecorder {
  return createViemReceiptRecorder({
    chain: chainFromConfig(config),
    rpcUrl: requireEnv('RPC_URL'),
    privateKey: payerPrivateKey(),
    registryAddress: requireAddress('RECEIPT_REGISTRY_ADDRESS'),
  });
}

async function main(): Promise<void> {
  const mock = isMockMode();
  const client: IHspMcpClient = mock
    ? new MockHspMcpClient({
        scenario: 'happy',
        merchantName: merchantName(),
      })
    : createLiveHspMcpClient();

  const checkpointPath = dataFilePath(
    'HSP_LAST_PAYMENT_PATH',
    'last-payment.json',
  );
  const tracePath = dataFilePath('HSP_DEMO_TRACE_PATH', 'demo-trace.json');

  try {
    const config = await client.get_chain_config({});
    const token = resolveToken(config);
    const payer = payerAccount(mock);
    const policy = readPolicy();

    if (
      !policy.allowedTokens.some(
        (allowed) => allowed.toLowerCase() === token.address.toLowerCase(),
      )
    ) {
      throw new Error(
        `Token ${token.address} is not in data/policy.json allowedTokens`,
      );
    }

    const ledgerPath = mock
      ? path.join(mkdtempSync(path.join(os.tmpdir(), 'hsp-demo-')), 'spend-ledger.json')
      : process.env.HSP_LEDGER_PATH?.trim() ||
        path.join(process.cwd(), 'data', 'spend-ledger.json');
    const ledger = new SpendLedger({ filePath: ledgerPath });

    const request: PaymentRequest = {
      merchantName: merchantName(),
      token: token.address,
      amountRaw: demoAmountRaw(),
      payTo: sellerAddress(mock),
      metadata: {
        mode: mock ? 'mock' : 'live',
        source: 'demo-payment',
      },
    };

    const trace: TraceEvent[] = [];
    const orchestrator = new PaymentOrchestrator({
      client,
      policy: new PolicyEngine({
        maxTxAmount: BigInt(policy.maxTxAmount),
        dailyLimit: BigInt(policy.dailyLimit),
        allowedMerchants: policy.allowedMerchants,
        allowedTokens: policy.allowedTokens,
      }),
      ledger,
      signer: createAccountSigner(payer),
      merchantName: request.merchantName,
      receiptRecorder: mock ? mockReceiptRecorder() : liveReceiptRecorder(config),
      lastPaymentPath: checkpointPath,
      force: hasFlag('--force'),
      onTrace(event) {
        trace.push(event);
      },
    });

    const outcome: PaymentOutcome = await orchestrator.execute(request);
    const txExplorer = explorerTxUrl(config, outcome.txSignature);
    const receiptExplorer = explorerTxUrl(config, outcome.receiptTxHash);
    const states = outcome.trace.map((event) => event.toState);

    const document = {
      mode: mock ? 'mock' : 'live',
      mock,
      generatedAt: new Date().toISOString(),
      chain: config,
      payer: payer.address,
      request,
      outcome,
      trace,
      explorer: {
        transaction: txExplorer,
        receipt: receiptExplorer,
      },
      checkpointPath,
      tracePath,
    };

    writeJsonFile(tracePath, document);

    console.log(`mode=${document.mode}`);
    console.log(`payment state: ${outcome.state}`);
    if (outcome.reason) {
      console.log(`reason: ${outcome.reason}`);
    }
    console.log(`trace: ${states.join(' -> ')}`);
    console.log(`tx hash: ${outcome.txSignature ?? 'none'}`);
    console.log(`tx explorer: ${txExplorer ?? 'n/a'}`);
    console.log(`receipt tx hash: ${outcome.receiptTxHash ?? 'none'}`);
    console.log(`receipt explorer: ${receiptExplorer ?? 'n/a'}`);
    console.log(`checkpoint: ${checkpointPath}`);
    console.log(`trace json: ${tracePath}`);

    if (mock) {
      console.log(
        'mode=mock: no transaction was broadcast and no real receipt was recorded.',
      );
    }

    if (outcome.state !== 'SETTLED') {
      process.exitCode = 1;
    }
  } finally {
    await closeClient(client);
  }
}

main().catch((error: unknown) => {
  console.error(
    'Demo payment failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
