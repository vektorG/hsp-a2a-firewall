import { describe, expect, it } from 'vitest';
import { recoverTypedDataAddress, type Address, type Hex } from 'viem';
import {
  EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
  PERMIT2_PERMIT_TRANSFER_FROM_TYPES,
  signPermitTransferFrom,
  signServerTypedData,
  signTransferWithAuthorization,
} from '../src/core/eip712.js';
import {
  MOCK_EXAMPLE_PAY_TO,
  MOCK_EXAMPLE_PERMIT2,
  MockHspMcpClient,
} from '../src/mcp/client.js';
import { ANVIL_ACCOUNT_0, MERCHANT } from './helpers.js';

const SIGNATURE_65_BYTES = /^0x[0-9a-fA-F]{130}$/;

async function fixture() {
  const client = new MockHspMcpClient({ scenario: 'happy', merchantName: MERCHANT });
  const config = await client.get_chain_config();
  const domain = {
    name: 'Example Domain',
    version: '1',
    chainId: config.chain_id,
    verifyingContract: config.token.address as Address,
  };
  return { client, config, domain };
}

describe('EIP-712 signing', () => {
  it('signTransferWithAuthorization recovers to the signing account', async () => {
    const { domain } = await fixture();
    const authorization = {
      domain,
      from: ANVIL_ACCOUNT_0.address,
      to: MOCK_EXAMPLE_PAY_TO,
      value: 5_000n,
      validAfter: 0n,
      validBefore: 4_102_444_800n,
      nonce: `0x${'11'.repeat(32)}` as Hex,
    };

    const signature = await signTransferWithAuthorization(
      ANVIL_ACCOUNT_0,
      authorization,
    );

    expect(signature).toMatch(SIGNATURE_65_BYTES);

    const recovered = await recoverTypedDataAddress({
      domain,
      types: EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce,
      },
      signature,
    });

    expect(recovered).toBe(ANVIL_ACCOUNT_0.address);
  });

  it('signPermitTransferFrom recovers to the signing account', async () => {
    const { domain } = await fixture();
    const spender = MOCK_EXAMPLE_PERMIT2;
    const transfer = {
      domain: { ...domain, verifyingContract: spender },
      permitted: { token: domain.verifyingContract, amount: 7_000n },
      spender,
      nonce: 1n,
      deadline: 4_102_444_800n,
    };

    const signature = await signPermitTransferFrom(ANVIL_ACCOUNT_0, transfer);

    expect(signature).toMatch(SIGNATURE_65_BYTES);

    const recovered = await recoverTypedDataAddress({
      domain: transfer.domain,
      types: PERMIT2_PERMIT_TRANSFER_FROM_TYPES,
      primaryType: 'PermitTransferFrom',
      message: {
        permitted: transfer.permitted,
        spender: transfer.spender,
        nonce: transfer.nonce,
        deadline: transfer.deadline,
      },
      signature,
    });

    expect(recovered).toBe(ANVIL_ACCOUNT_0.address);
  });

  it('signServerTypedData signs the mock prepare_payment eip712 verbatim (R1)', async () => {
    const { client, config, domain } = await fixture();
    const order = await client.create_order({
      merchant_name: MERCHANT,
      token: config.token.address,
      amount: '5000',
    });
    const prepared = await client.prepare_payment({
      order_id: order.order_id,
      flow_id: order.flow_id,
      payment_request_id: order.payment_request_id,
      payer: ANVIL_ACCOUNT_0.address,
    });

    // The server payload includes EIP712Domain and must be stripped by the
    // production signer only.
    expect(prepared.eip712.types.EIP712Domain).toBeDefined();
    expect(prepared.eip712.domain.chainId).toBe(domain.chainId);
    expect(prepared.eip712.domain.verifyingContract).toBe(
      domain.verifyingContract,
    );

    const signature = await signServerTypedData(ANVIL_ACCOUNT_0, prepared.eip712);
    expect(signature).toMatch(SIGNATURE_65_BYTES);

    const { EIP712Domain: _ignored, ...types } = prepared.eip712.types;

    const recovered = await recoverTypedDataAddress({
      domain: {
        name: prepared.eip712.domain.name,
        version: prepared.eip712.domain.version,
        chainId: prepared.eip712.domain.chainId,
        verifyingContract: prepared.eip712.domain.verifyingContract as Address,
      },
      types,
      primaryType: prepared.eip712.primaryType,
      message: prepared.eip712.message,
      signature,
    });

    expect(recovered).toBe(ANVIL_ACCOUNT_0.address);
  });
});
