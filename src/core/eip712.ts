import type { Address, Hex, LocalAccount } from 'viem';
import type { ServerTypedData } from '../mcp/schemas.js';

/**
 * Signer abstraction used by the state machine. Production implementations
 * MUST only ever forward the exact `eip712` object returned by
 * `prepare_payment` to `signServerTypedData`.
 */
export interface PaymentSigner {
  readonly address: Address;
  sign(typedData: ServerTypedData): Promise<Hex>;
}

type SignTypedDataParams = Parameters<LocalAccount['signTypedData']>[0];

const SIGNATURE_65_BYTES = /^0x[0-9a-fA-F]{130}$/;

/**
 * PRODUCTION signing path (R1).
 *
 * The HSP server returns the full EIP-712 payload, including an
 * `EIP712Domain` entry in `types`. viem derives the domain separator from
 * `domain` itself and rejects a duplicate `EIP712Domain` type, so that one key
 * is stripped. `domain`, `primaryType` and `message` are forwarded verbatim.
 */
export async function signServerTypedData(
  account: LocalAccount,
  eip712: ServerTypedData,
): Promise<Hex> {
  const { EIP712Domain: _eip712Domain, ...types } = eip712.types;

  const parameters = {
    domain: eip712.domain,
    types,
    primaryType: eip712.primaryType,
    message: eip712.message,
  } as unknown as SignTypedDataParams;

  const signature = await account.signTypedData(parameters);

  if (!SIGNATURE_65_BYTES.test(signature)) {
    throw new Error(
      `signServerTypedData produced a malformed signature (expected 65 bytes, got ${signature.length - 2} hex chars)`,
    );
  }

  return signature;
}

/** Wraps a viem local account as the state machine's `PaymentSigner`. */
export function createAccountSigner(account: LocalAccount): PaymentSigner {
  return {
    address: account.address,
    sign: (typedData) => signServerTypedData(account, typedData),
  };
}

// ---------------------------------------------------------------------------
// @internal mock-only EIP-712 builders
//
// These exist solely for MockHspMcpClient fixtures and unit tests. They are
// NOT the production signing path and MUST NOT be used to sign HSP payments.
// All domain fields (including chainId and verifyingContract) are injected by
// the caller, never hardcoded (R5).
// ---------------------------------------------------------------------------

/** @internal mock-only */
export const EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** @internal mock-only */
export const PERMIT2_PERMIT_TRANSFER_FROM_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
} as const;

/** @internal mock-only */
export interface MockTransferAuthorization {
  domain: ServerTypedData['domain'];
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

/**
 * @internal mock-only
 * Builds and signs an EIP-3009 TransferWithAuthorization payload. Used by the
 * mock client's prepare_payment fixture and by unit tests only.
 */
export async function signTransferWithAuthorization(
  account: LocalAccount,
  authorization: MockTransferAuthorization,
): Promise<Hex> {
  const parameters = {
    domain: authorization.domain,
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
  } as unknown as SignTypedDataParams;

  return account.signTypedData(parameters);
}

/** @internal mock-only */
export interface MockPermitTransferFrom {
  domain: ServerTypedData['domain'];
  permitted: { token: Address; amount: bigint };
  spender: Address;
  nonce: bigint;
  deadline: bigint;
}

/**
 * @internal mock-only
 * Builds and signs a Permit2 PermitTransferFrom payload. Used by unit tests
 * only; the production path is always `signServerTypedData`.
 */
export async function signPermitTransferFrom(
  account: LocalAccount,
  transfer: MockPermitTransferFrom,
): Promise<Hex> {
  const parameters = {
    domain: transfer.domain,
    types: PERMIT2_PERMIT_TRANSFER_FROM_TYPES,
    primaryType: 'PermitTransferFrom',
    message: {
      permitted: transfer.permitted,
      spender: transfer.spender,
      nonce: transfer.nonce,
      deadline: transfer.deadline,
    },
  } as unknown as SignTypedDataParams;

  return account.signTypedData(parameters);
}
