export type PaymentState =
  | 'INIT'
  | 'POLICY_CHECKED'
  | 'ORDER_CREATED'
  | 'REQUOTING'
  | 'PREPARED'
  | 'SIGNED'
  | 'FINALIZED'
  | 'SUBMITTED'
  | 'POLLING'
  | 'SAFE_AWAITING_FINALITY'
  | 'SETTLED'
  | 'FAILED';

export interface TraceEvent {
  timestamp: string;
  fromState: PaymentState;
  toState: PaymentState;
  orderId?: string;
  meta?: Record<string, unknown>;
}

export interface PaymentRequest {
  merchantName: string;
  token: string;
  amountRaw: string;
  metadata?: Record<string, unknown>;
}

export interface TokenConfig {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
}

export type ProfileId = 'hsk-testnet' | 'sepolia';

export interface ChainConfig {
  chain_id: number | string;
  chain_name?: string;
  token: TokenConfig;
  permit2?: string;
  explorer_url?: string;
  payment_protocol?: string;
  gas_fee_advanced?: boolean;
  profile_id: ProfileId;
  profile_label: string;
  explorer_tx_url: string;
  explorer_address_url: string;
}

export interface ProfileSummary {
  id: ProfileId;
  label: string;
  chainId: number;
  chainName: string;
  tokenSymbol: string;
}

export interface ReceiptConfig {
  chainName: string;
  chainId: number;
  registryAddress: string;
  explorerUrl: string;
  explorerTxUrl: string;
  deploymentTxHash?: string;
  deployedAt?: string;
}

export interface PolicyFile {
  maxTxAmount: string;
  dailyLimit: string;
  allowedMerchants: string[];
  allowedTokens: string[];
}

export type ScenarioId =
  | 'happy'
  | 'malicious-invoice'
  | 'over-limit'
  | 'untrusted-merchant'
  | 'tampered-quote'
  | 'quote-expired-requote'
  | 'timeout';

export interface ScenarioSummary {
  id: ScenarioId;
  label: string;
  note: string;
  verdict: 'allowed' | 'blocked';
}

export interface ServerConfig {
  activeProfile: ProfileId;
  profiles: ProfileSummary[];
  chain: ChainConfig;
  receipt: ReceiptConfig;
  policy: PolicyFile;
  scenarios: ScenarioSummary[];
  demo: {
    mockDriven: boolean;
    liveMcpCalls: boolean;
    profileLabel: string;
  };
}

export interface PaymentOutcome {
  state: 'SETTLED' | 'FAILED';
  reason?: string;
  orderId?: string;
  flowId?: string;
  paymentRequestId?: string;
  paymentId?: string;
  txSignature?: string | null;
  amountRaw?: string;
  signature?: string;
  receiptTxHash?: string;
  receiptError?: string;
  trace: TraceEvent[];
}

export interface PaymentCalls {
  get_chain_config: number;
  create_order: number;
  get_order: number;
  prepare_payment: number;
  finalize_payment: number;
  estimate_fee: number;
  submit_payment: number;
  query_payment: number;
}

export interface PaymentRecord {
  id: string;
  scenario: ScenarioId;
  label: string;
  note: string;
  verdict: 'allowed' | 'blocked';
  status: 'running' | 'SETTLED' | 'FAILED';
  request: PaymentRequest;
  chain: ChainConfig;
  receipt: ReceiptConfig;
  outcome?: PaymentOutcome;
  trace: TraceEvent[];
  calls: PaymentCalls;
  createdAt: string;
  finishedAt?: string;
  paymentExplorerUrl?: string;
  receiptExplorerUrl?: string;
}

export type StreamEvent =
  | { type: 'hello'; at: string }
  | { type: 'payment'; payment: PaymentRecord }
  | { type: 'trace'; paymentId: string; event: TraceEvent }
  | { type: 'policy'; policy: PolicyFile }
  | { type: 'profile'; config: ServerConfig };
