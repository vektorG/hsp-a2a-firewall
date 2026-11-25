import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  decodeFunctionData,
  keccak256,
  toFunctionSelector,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import {
  agentReceiptRegistryAbi,
  computeOrderIdHash,
  decodeRecordReceipt,
  encodeRecordReceipt,
} from '../src/core/receipt.js';
import { MERCHANT, TOKEN } from './helpers.js';

const anvilAvailable =
  spawnSync('anvil', ['--version'], { encoding: 'utf8' }).status === 0;

describe('receipts', () => {
  it('hashes the payment_request_id and ABI-encodes recordReceipt (R6)', () => {
    const paymentRequestId = 'pr_42';
    const orderIdHash = computeOrderIdHash(paymentRequestId);

    expect(orderIdHash).toBe(keccak256(toHex(paymentRequestId)));
    expect(orderIdHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const record = {
      orderIdHash,
      merchantName: MERCHANT,
      token: TOKEN as Address,
      amount: 123_456n,
    };
    const data = encodeRecordReceipt(record);

    expect(data.slice(0, 10)).toBe(
      toFunctionSelector('recordReceipt(bytes32,string,address,uint256)'),
    );

    const decoded = decodeFunctionData({
      abi: agentReceiptRegistryAbi,
      data,
    });
    expect(decoded.functionName).toBe('recordReceipt');

    const [decodedHash, decodedMerchant, decodedToken, decodedAmount] =
      decoded.args;

    expect(decodedHash).toBe(orderIdHash);
    expect(decodedMerchant).toBe(MERCHANT);
    expect(decodedToken).toBe(TOKEN);
    expect(decodedAmount).toBe(123_456n);

    // Round-trip helper.
    expect(decodeRecordReceipt(data as Hex)).toEqual(record);
  });

  it('keeps the contract ABI in sync with the calldata shape', () => {
    const recordFn = agentReceiptRegistryAbi.find(
      (entry) => entry.type === 'function' && entry.name === 'recordReceipt',
    );
    expect(recordFn).toBeDefined();
    expect(
      recordFn && 'inputs' in recordFn
        ? recordFn.inputs.map((input) => input.type)
        : [],
    ).toEqual(['bytes32', 'string', 'address', 'uint256']);
  });

  it.skipIf(!anvilAvailable)(
    'non-recorder call reverts — TODO: requires a local anvil/hardhat node',
    () => {
      // Intentionally not faked. To enable: spawn `anvil`, compile with
      // `npm run compile:contracts`, deploy as key #0, then call
      // recordReceipt from key #1 and assert the NotRecorder revert.
      throw new Error(
        'TODO: implement the local-anvil non-recorder revert integration test',
      );
    },
  );
});
