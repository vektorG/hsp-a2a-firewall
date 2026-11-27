import 'dotenv/config';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SpendLedger } from '../src/core/ledger.js';
import {
  isTerminalPaymentState,
  readLastPayment,
  writeLastPayment,
  type LastPaymentRecord,
} from '../src/core/paymentState.js';
import {
  createViemReceiptRecorder,
  type ReceiptRecorder,
} from '../src/core/receipt.js';
import {
  type IHspMcpClient,
  HspMcpError,
} from '../src/mcp/client.js';
import { createLiveHspMcpClient } from '../src/mcp/liveClient.js';
import type { QueryPaymentOutput } from '../src/mcp/schemas.js';
import {
  chainFromConfig,
  closeClient,
  dataFilePath,
  isMockMode,
  mockHash,
  payerPrivateKey,
  requireAddress,
  requireEnv,
} from './lib/common.js';

function mockResumeClient(record: LastPaymentRecord): IHspMcpClient {
  const paymentId = record.payment_id ?? 'pay_unknown';
  const merchant = record.merchant_name ?? 'unknown_merchant';
  const finalized: QueryPaymentOutput = {
    payment_id: paymentId,
    status: 'payment-finalized',
    tx_signature: mockHash(`resume:${paymentId}`),
    attribution_verified: true,
    attribution_merchant_name: merchant,
  };

  const unsupported = async (): Promise<never> => {
    throw new HspMcpError('TOOL_ERROR', 'mock resume client: unsupported call');
  };

  return {
    get_chain_config: unsupported,
    create_order: unsupported,
    get_order: unsupported,
    prepare_payment: unsupported,
    finalize_payment: unsupported,
    estimate_fee: unsupported,
    submit_payment: unsupported,
    async query_payment() {
      return finalized;
    },
  };
}

function mockReceiptRecorder(): ReceiptRecorder {
  return {
    async record(params) {
      return {
        txHash: mockHash(
          `resume-receipt:${params.paymentRequestId}:${params.merchantName}`,
        ),
      };
    },
  };
}

async function main(): Promise<void> {
  const checkpointPath = dataFilePath(
    'HSP_LAST_PAYMENT_PATH',
    'last-payment.json',
  );
  const record = readLastPayment(checkpointPath);

  if (record === null) {
    console.log(`No checkpoint found at ${checkpointPath}; nothing to resume.`);
    return;
  }

  if (isTerminalPaymentState(record.state)) {
    console.log(
      `Checkpoint ${checkpointPath} is already terminal (${record.state}); nothing to resume.`,
    );
    return;
  }

  if (!record.payment_id || !record.merchant_name) {
    throw new Error(
      `Checkpoint ${checkpointPath} is missing payment_id or merchant_name`,
    );
  }

  const mock = isMockMode();
  const client: IHspMcpClient = mock
    ? mockResumeClient(record)
    : createLiveHspMcpClient();

  try {
    const query = await client.query_payment({
      payment_id: record.payment_id,
      expected_merchant_name: record.merchant_name,
    });

    console.log(`payment ${record.payment_id}: ${query.status}`);

    if (query.status === 'payment-finalized') {
      if (query.attribution_verified !== true) {
        const failed: LastPaymentRecord = {
          ...record,
          state: 'FAILED',
          tx_signature: query.tx_signature ?? record.tx_signature ?? null,
          updated_at: new Date().toISOString(),
        };
        writeLastPayment(checkpointPath, failed);
        console.log('attribution not verified: closing payment as FAILED.');
        return;
      }

      let receiptTxHash = record.receipt_tx_hash;

      if (receiptTxHash === undefined) {
        const ledgerPath = mock
          ? path.join(
              mkdtempSync(path.join(os.tmpdir(), 'hsp-resume-')),
              'spend-ledger.json',
            )
          : process.env.HSP_LEDGER_PATH?.trim() ||
            path.join(process.cwd(), 'data', 'spend-ledger.json');
        const ledger = new SpendLedger({ filePath: ledgerPath });

        if (record.token_total_raw) {
          ledger.addSpend(BigInt(record.token_total_raw));
        }

        let recorder: ReceiptRecorder = mockReceiptRecorder();

        if (!mock) {
          const config = await client.get_chain_config({});
          recorder = createViemReceiptRecorder({
            chain: chainFromConfig(config),
            rpcUrl: requireEnv('RPC_URL'),
            privateKey: payerPrivateKey(),
            registryAddress: requireAddress('RECEIPT_REGISTRY_ADDRESS'),
          });
        }

        const receipt = await recorder.record({
          paymentRequestId: record.payment_request_id ?? '',
          merchantName: record.merchant_name,
          token: record.token as `0x${string}`,
          amount: BigInt(record.token_total_raw ?? '0'),
        });
        receiptTxHash = receipt.txHash;
      } else {
        console.log('receipt already recorded; skipping spend and receipt.');
      }

      const settled: LastPaymentRecord = {
        ...record,
        state: 'SETTLED',
        tx_signature: query.tx_signature ?? record.tx_signature ?? null,
        receipt_tx_hash: receiptTxHash,
        updated_at: new Date().toISOString(),
      };
      writeLastPayment(checkpointPath, settled);

      console.log('state=SETTLED');
      console.log(`tx hash: ${settled.tx_signature ?? 'none'}`);
      console.log(`receipt tx hash: ${settled.receipt_tx_hash ?? 'none'}`);
      console.log(`checkpoint: ${checkpointPath}`);

      if (mock) {
        console.log(
          'mode=mock: no transaction was broadcast and no real receipt was recorded.',
        );
      }
      return;
    }

    if (query.status === 'payment-failed') {
      const failed: LastPaymentRecord = {
        ...record,
        state: 'FAILED',
        tx_signature: query.tx_signature ?? record.tx_signature ?? null,
        updated_at: new Date().toISOString(),
      };
      writeLastPayment(checkpointPath, failed);
      console.log(
        `state=FAILED reason=${query.status_reason ?? 'PAYMENT_FAILED'}`,
      );
      return;
    }

    console.log(
      `payment still pending (${query.status}); no local changes written.`,
    );
  } finally {
    await closeClient(client);
  }
}

main().catch((error: unknown) => {
  console.error(
    'Resume failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
