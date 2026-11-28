import type {
  ChainConfig,
  PaymentRecord,
  PolicyFile,
  ProfileId,
  ReceiptConfig,
  ScenarioSummary,
  ServerConfig,
  TraceEvent,
} from './types';

export const GITHUB_URL = 'https://github.com/vektorG/hsp-a2a-firewall';
export const TEAM_NAME = 'kolit_vlom';
export const RECEIPT_REGISTRY_ADDRESS =
  '0x5a2e50040dd7242231ee593cf61f5d34e15ef121';
export const RECEIPT_DEPLOY_TX =
  '0xddec5941b902b99f7139338ac79562d261d6762230f327d4d88bfcb56c5e623f';
export const RECEIPT_DEPLOYED_AT = '2026-11-26T06:46:57.868Z';

const PROFILE_SUMMARIES = [
  {
    id: 'hsk-testnet' as const,
    label: 'HSK Testnet',
    chainId: 133,
    chainName: 'HSK Testnet',
    tokenSymbol: 'USDC',
  },
  {
    id: 'sepolia' as const,
    label: 'Ethereum Sepolia — official QA rail',
    chainId: 11155111,
    chainName: 'Ethereum Sepolia',
    tokenSymbol: 'USDC',
  },
];

const CHAINS: Record<ProfileId, ChainConfig> = {
  'hsk-testnet': {
    chain_id: 133,
    chain_name: 'HSK Testnet',
    token: {
      address: '0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    permit2: '0x2222222222222222222222222222222222222222',
    explorer_url: 'https://explorer.testnet.hsk.xyz',
    payment_protocol: 'EIP-3009',
    gas_fee_advanced: true,
    profile_id: 'hsk-testnet',
    profile_label: 'HSK Testnet',
    explorer_tx_url: 'https://explorer.testnet.hsk.xyz/tx/',
    explorer_address_url: 'https://explorer.testnet.hsk.xyz/address/',
  },
  sepolia: {
    chain_id: 11155111,
    chain_name: 'Ethereum Sepolia',
    token: {
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    permit2: '0x2222222222222222222222222222222222222222',
    explorer_url: 'https://sepolia.etherscan.io',
    payment_protocol: 'EIP-3009',
    gas_fee_advanced: false,
    profile_id: 'sepolia',
    profile_label: 'Ethereum Sepolia — official QA rail',
    explorer_tx_url: 'https://sepolia.etherscan.io/tx/',
    explorer_address_url: 'https://sepolia.etherscan.io/address/',
  },
};

export const STATIC_RECEIPT: ReceiptConfig = {
  chainName: 'HSK Chain',
  chainId: 133,
  registryAddress: RECEIPT_REGISTRY_ADDRESS,
  explorerUrl: 'https://explorer.testnet.hsk.xyz',
  explorerTxUrl: 'https://explorer.testnet.hsk.xyz/tx/',
  deploymentTxHash: RECEIPT_DEPLOY_TX,
  deployedAt: RECEIPT_DEPLOYED_AT,
};

const STATIC_POLICY: PolicyFile = {
  maxTxAmount: '1000000',
  dailyLimit: '5000000',
  allowedMerchants: [TEAM_NAME],
  allowedTokens: [CHAINS['hsk-testnet'].token.address, CHAINS.sepolia.token.address],
};

const STATIC_SCENARIOS: ScenarioSummary[] = [
  {
    id: 'happy',
    label: '01-happy · Authorized payment',
    note: 'Policy pass, quote cross-check, signature, settlement and HSK receipt.',
    verdict: 'allowed',
  },
  {
    id: 'tampered-quote',
    label: '05-tampered-quote · Tampered quote',
    note: 'Server inflates the amount pre-sign. POLICY_MISMATCH stops it before the signer.',
    verdict: 'blocked',
  },
  {
    id: 'over-limit',
    label: '03-over-limit · Daily limit breach',
    note: 'Spend ledger is already near the daily cap. Policy blocks the intent before create_order.',
    verdict: 'blocked',
  },
];

export function staticConfig(profile: ProfileId = 'hsk-testnet'): ServerConfig {
  return {
    activeProfile: profile,
    profiles: PROFILE_SUMMARIES,
    chain: CHAINS[profile],
    receipt: STATIC_RECEIPT,
    policy: { ...STATIC_POLICY, allowedMerchants: [...STATIC_POLICY.allowedMerchants], allowedTokens: [...STATIC_POLICY.allowedTokens] },
    scenarios: STATIC_SCENARIOS,
    demo: {
      mockDriven: true,
      liveMcpCalls: false,
      profileLabel: CHAINS[profile].profile_label,
    },
  };
}

const SIGNER = '0x4A568147245297A03d1536A7B0B91F3D3d9b28FF';
const HAPPY_TX = `0x${'ab'.repeat(32)}`;
const HAPPY_RECEIPT_TX =
  '0x8b1993a2d0e579f70cfaace772ec3b897e2860e60ba7e734fc64673f3e62364c';
const HAPPY_SIGNATURE =
  '0xb417526531d8646991a521805db76519cf0c4894d3ebc41501d58ca6d6f9f8b642c6866e2c761e626e7b549fa04e9a52d2056958036c93782487a633c3cc06af1c';

const HAPPY_TRACE: TraceEvent[] = [
  {
    timestamp: '2026-11-27T13:21:19.184Z',
    fromState: 'INIT',
    toState: 'POLICY_CHECKED',
    meta: {
      phase: 'pre_order',
      spentToday: '0',
      decision: {
        allowed: true,
        details: {
          amount: '250000',
          spentToday: '0',
          projectedSpend: '250000',
          maxTxAmount: '1000000',
          dailyLimit: '5000000',
        },
      },
    },
  },
  {
    timestamp: '2026-11-27T13:21:19.184Z',
    fromState: 'POLICY_CHECKED',
    toState: 'ORDER_CREATED',
    orderId: 'order_1',
    meta: {
      flow_id: 'flow_1',
      payment_request_id: 'pr_1',
      token_total_raw: '250000',
      quote_expires_at: '2026-11-27T13:26:19.184Z',
    },
  },
  {
    timestamp: '2026-11-27T13:21:19.185Z',
    fromState: 'ORDER_CREATED',
    toState: 'PREPARED',
    orderId: 'order_1',
    meta: {
      token_total_raw: '250000',
      quote_expires_at: '2026-11-27T13:26:19.185Z',
      re_quoted: false,
    },
  },
  {
    timestamp: '2026-11-27T13:21:19.186Z',
    fromState: 'PREPARED',
    toState: 'POLICY_CHECKED',
    orderId: 'order_1',
    meta: {
      phase: 'post_quote',
      quotedTotalRaw: '250000',
      decision: {
        allowed: true,
        details: {
          amount: '250000',
          spentToday: '0',
          projectedSpend: '250000',
          maxTxAmount: '1000000',
          dailyLimit: '5000000',
        },
      },
    },
  },
  {
    timestamp: '2026-11-27T13:21:19.191Z',
    fromState: 'POLICY_CHECKED',
    toState: 'SIGNED',
    orderId: 'order_1',
    meta: {
      signer: SIGNER,
      primaryType: 'TransferWithAuthorization',
    },
  },
  {
    timestamp: '2026-11-27T13:21:19.192Z',
    fromState: 'SIGNED',
    toState: 'FINALIZED',
    orderId: 'order_1',
    meta: {
      payment_id: 'pay_pr_1',
      status: 'submitted',
      tx_signature: null,
    },
  },
  {
    timestamp: '2026-11-27T13:21:19.192Z',
    fromState: 'FINALIZED',
    toState: 'SUBMITTED',
    orderId: 'order_1',
    meta: {
      payment_id: 'pay_pr_1',
      status: 'submitted',
      tx_signature: null,
    },
  },
  {
    timestamp: '2026-11-27T13:21:19.192Z',
    fromState: 'SUBMITTED',
    toState: 'POLLING',
    orderId: 'order_1',
    meta: {
      pollIntervalMs: 450,
      maxPollAttempts: 12,
      maxTimeoutRetries: 3,
    },
  },
  {
    timestamp: '2026-11-27T13:21:19.192Z',
    fromState: 'POLLING',
    toState: 'SETTLED',
    orderId: 'order_1',
    meta: {
      attempt: 1,
      status: 'payment-finalized',
      attribution_verified: true,
      attribution_merchant_name: TEAM_NAME,
      token_total_raw: '250000',
      tx_signature: HAPPY_TX,
    },
  },
];

const TAMPERED_DECISION_ALLOWED = {
  allowed: true,
  details: {
    amount: '250000',
    spentToday: '0',
    projectedSpend: '250000',
    maxTxAmount: '1000000',
    dailyLimit: '5000000',
  },
};

const TAMPERED_TRACE: TraceEvent[] = [
  {
    timestamp: '2026-11-27T13:22:01.104Z',
    fromState: 'INIT',
    toState: 'POLICY_CHECKED',
    meta: {
      phase: 'pre_order',
      spentToday: '0',
      decision: TAMPERED_DECISION_ALLOWED,
    },
  },
  {
    timestamp: '2026-11-27T13:22:01.105Z',
    fromState: 'POLICY_CHECKED',
    toState: 'ORDER_CREATED',
    orderId: 'order_1',
    meta: {
      flow_id: 'flow_1',
      payment_request_id: 'pr_1',
      token_total_raw: '250000',
      quote_expires_at: '2026-11-27T13:27:01.105Z',
    },
  },
  {
    timestamp: '2026-11-27T13:22:01.106Z',
    fromState: 'ORDER_CREATED',
    toState: 'PREPARED',
    orderId: 'order_1',
    meta: {
      token_total_raw: '250000',
      quote_expires_at: '2026-11-27T13:27:01.106Z',
      re_quoted: false,
    },
  },
  {
    timestamp: '2026-11-27T13:22:01.107Z',
    fromState: 'PREPARED',
    toState: 'POLICY_CHECKED',
    orderId: 'order_1',
    meta: {
      phase: 'post_quote',
      quotedTotalRaw: '250000',
      decision: TAMPERED_DECISION_ALLOWED,
    },
  },
  {
    timestamp: '2026-11-27T13:22:01.108Z',
    fromState: 'POLICY_CHECKED',
    toState: 'FAILED',
    orderId: 'order_1',
    meta: {
      reason: 'POLICY_MISMATCH',
      phase: 'pre_sign',
      check: 'amount',
      expected: '250000',
      actual: '1250000',
      validation: {
        valid: false,
        allowed: false,
        reason: 'POLICY_MISMATCH',
        field: 'amount',
        details: {
          field: 'amount',
          expected: '250000',
          actual: '1250000',
        },
      },
    },
  },
];

const DAILY_LIMIT_DECISION = {
  allowed: false,
  reason: 'EXCEEDS_DAILY_LIMIT',
  details: {
    amount: '900000',
    spentToday: '4500000',
    projectedSpend: '5400000',
    maxTxAmount: '1000000',
    dailyLimit: '5000000',
    code: 'EXCEEDS_DAILY_LIMIT',
  },
};

const OVER_LIMIT_TRACE: TraceEvent[] = [
  {
    timestamp: '2026-11-27T13:23:44.218Z',
    fromState: 'INIT',
    toState: 'POLICY_CHECKED',
    meta: {
      phase: 'pre_order',
      spentToday: '4500000',
      decision: DAILY_LIMIT_DECISION,
    },
  },
  {
    timestamp: '2026-11-27T13:23:44.219Z',
    fromState: 'POLICY_CHECKED',
    toState: 'FAILED',
    meta: {
      reason: 'EXCEEDS_DAILY_LIMIT',
      policy: DAILY_LIMIT_DECISION,
    },
  },
];

const ZERO_CALLS = {
  get_chain_config: 0,
  create_order: 0,
  get_order: 0,
  prepare_payment: 0,
  finalize_payment: 0,
  estimate_fee: 0,
  submit_payment: 0,
  query_payment: 0,
};

export const STATIC_PAYMENTS: PaymentRecord[] = [
  {
    id: '01-happy',
    scenario: 'happy',
    label: 'Authorized payment',
    note: 'Trusted merchant, supported token, quote matches intent.',
    verdict: 'allowed',
    status: 'SETTLED',
    request: {
      merchantName: TEAM_NAME,
      token: CHAINS['hsk-testnet'].token.address,
      amountRaw: '250000',
      metadata: { scenario: 'happy', mock: true, source: 'static-demo' },
    },
    chain: CHAINS['hsk-testnet'],
    receipt: STATIC_RECEIPT,
    outcome: {
      state: 'SETTLED',
      orderId: 'order_1',
      flowId: 'flow_1',
      paymentRequestId: 'pr_1',
      paymentId: 'pay_pr_1',
      txSignature: HAPPY_TX,
      amountRaw: '250000',
      signature: HAPPY_SIGNATURE,
      receiptTxHash: HAPPY_RECEIPT_TX,
      trace: HAPPY_TRACE,
    },
    trace: HAPPY_TRACE,
    calls: {
      ...ZERO_CALLS,
      get_chain_config: 1,
      create_order: 1,
      prepare_payment: 1,
      finalize_payment: 1,
      submit_payment: 1,
      query_payment: 1,
    },
    createdAt: '2026-11-27T13:21:19.184Z',
    finishedAt: '2026-11-27T13:21:19.192Z',
    paymentExplorerUrl: `${CHAINS['hsk-testnet'].explorer_tx_url}${HAPPY_TX}`,
    receiptExplorerUrl: `${STATIC_RECEIPT.explorerTxUrl}${HAPPY_RECEIPT_TX}`,
  },
  {
    id: '05-tampered-quote',
    scenario: 'tampered-quote',
    label: 'Tampered quote',
    note: 'Server inflates the amount and swaps the recipient pre-sign.',
    verdict: 'blocked',
    status: 'FAILED',
    request: {
      merchantName: TEAM_NAME,
      token: CHAINS['hsk-testnet'].token.address,
      amountRaw: '250000',
      metadata: { scenario: 'tampered-quote', mock: true, source: 'static-demo' },
    },
    chain: CHAINS['hsk-testnet'],
    receipt: STATIC_RECEIPT,
    outcome: {
      state: 'FAILED',
      reason: 'POLICY_MISMATCH',
      orderId: 'order_1',
      flowId: 'flow_1',
      paymentRequestId: 'pr_1',
      txSignature: null,
      trace: TAMPERED_TRACE,
    },
    trace: TAMPERED_TRACE,
    calls: {
      ...ZERO_CALLS,
      get_chain_config: 1,
      create_order: 1,
      prepare_payment: 1,
    },
    createdAt: '2026-11-27T13:22:01.104Z',
    finishedAt: '2026-11-27T13:22:01.108Z',
  },
  {
    id: '03-over-limit',
    scenario: 'over-limit',
    label: 'Daily limit breach',
    note: 'The persistent spend ledger is already near the daily cap.',
    verdict: 'blocked',
    status: 'FAILED',
    request: {
      merchantName: TEAM_NAME,
      token: CHAINS['hsk-testnet'].token.address,
      amountRaw: '900000',
      metadata: { scenario: 'over-limit', mock: true, source: 'static-demo' },
    },
    chain: CHAINS['hsk-testnet'],
    receipt: STATIC_RECEIPT,
    outcome: {
      state: 'FAILED',
      reason: 'EXCEEDS_DAILY_LIMIT',
      txSignature: null,
      trace: OVER_LIMIT_TRACE,
    },
    trace: OVER_LIMIT_TRACE,
    calls: ZERO_CALLS,
    createdAt: '2026-11-27T13:23:44.218Z',
    finishedAt: '2026-11-27T13:23:44.219Z',
  },
];

export function staticPaymentForScenario(
  scenario: PaymentRecord['scenario'],
): PaymentRecord | undefined {
  return STATIC_PAYMENTS.find((payment) => payment.scenario === scenario);
}
