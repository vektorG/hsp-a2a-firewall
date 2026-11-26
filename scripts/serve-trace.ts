import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createAccountSigner } from '../src/core/eip712.js';
import { SpendLedger } from '../src/core/ledger.js';
import { PolicyEngine } from '../src/core/policy.js';
import type { ReceiptRecorder } from '../src/core/receipt.js';
import {
  PaymentOrchestrator,
  type PaymentOutcome,
  type PaymentRequest,
  type TraceEvent,
} from '../src/core/stateMachine.js';
import {
  MOCK_CHAIN_PROFILES,
  MockHspMcpClient,
  type MockChainProfileId,
  type MockScenario,
} from '../src/mcp/client.js';
import type { GetChainConfigOutput } from '../src/mcp/schemas.js';

// ---------------------------------------------------------------------------
// Mock-only demo server. There are NO live MCP calls in this process: every
// scenario runs the real state machine against MockHspMcpClient.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const POLICY_PATH = path.join(DATA_DIR, 'policy.json');
const DEPLOYMENT_PATH = path.join(ROOT, 'deployments', '133.json');
const PORT = Number(process.env.TRACE_PORT ?? 8787);

type ScenarioId =
  | 'happy'
  | 'malicious-invoice'
  | 'over-limit'
  | 'untrusted-merchant'
  | 'tampered-quote'
  | 'quote-expired-requote'
  | 'timeout';

interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  note: string;
  mock: MockScenario;
  merchantName: string;
  amountRaw: string;
  /** `active` means "whatever token the selected chain profile advertises". */
  token: 'active' | Address;
  verdict: 'allowed' | 'blocked';
}

const UNSUPPORTED_INVOICE_TOKEN =
  '0x000000000000000000000000000000000000dEaD' as Address;

const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  happy: {
    id: 'happy',
    label: 'Authorized payment',
    note: 'Trusted merchant, supported token, quote matches intent.',
    mock: 'happy',
    merchantName: 'kolit_vlom',
    amountRaw: '250000',
    token: 'active',
    verdict: 'allowed',
  },
  'malicious-invoice': {
    id: 'malicious-invoice',
    label: 'Malicious invoice',
    note: 'Invoice asks for a token the firewall does not support.',
    mock: 'happy',
    merchantName: 'kolit_vlom',
    amountRaw: '250000',
    token: UNSUPPORTED_INVOICE_TOKEN,
    verdict: 'blocked',
  },
  'over-limit': {
    id: 'over-limit',
    label: 'Over per-tx limit',
    note: 'Amount is maxTxAmount + 1 base unit. No order is created.',
    mock: 'happy',
    merchantName: 'kolit_vlom',
    amountRaw: '0',
    token: 'active',
    verdict: 'blocked',
  },
  'untrusted-merchant': {
    id: 'untrusted-merchant',
    label: 'Untrusted merchant',
    note: 'Agent tries to pay a merchant outside the allowlist.',
    mock: 'happy',
    merchantName: 'shadow_supplier',
    amountRaw: '250000',
    token: 'active',
    verdict: 'blocked',
  },
  'tampered-quote': {
    id: 'tampered-quote',
    label: 'Tampered quote',
    note: 'Server inflates the amount and swaps the recipient pre-sign.',
    mock: 'tampered-quote',
    merchantName: 'kolit_vlom',
    amountRaw: '250000',
    token: 'active',
    verdict: 'blocked',
  },
  'quote-expired-requote': {
    id: 'quote-expired-requote',
    label: 'Quote expired → requote',
    note: 'One 30043 requote on the same order; create_order stays at 1.',
    mock: 'requote-once',
    merchantName: 'kolit_vlom',
    amountRaw: '250000',
    token: 'active',
    verdict: 'allowed',
  },
  timeout: {
    id: 'timeout',
    label: 'Timeout recovery',
    note: 'Two poll timeouts, then finalized. The order is never recreated.',
    mock: 'timeout-then-finalized',
    merchantName: 'kolit_vlom',
    amountRaw: '250000',
    token: 'active',
    verdict: 'allowed',
  },
};

// A deterministic, public demo key. Derived at runtime so no 32-byte key
// literal lives in the source tree.
const DEMO_ACCOUNT = privateKeyToAccount(
  keccak256(toHex('hsp-a2a-firewall-demo-signer')),
);

// ---------------------------------------------------------------------------
// Policy persistence
// ---------------------------------------------------------------------------

interface PolicyFile {
  maxTxAmount: string;
  dailyLimit: string;
  allowedMerchants: string[];
  allowedTokens: string[];
}

const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function defaultPolicy(): PolicyFile {
  return {
    maxTxAmount: '1000000',
    dailyLimit: '5000000',
    allowedMerchants: ['kolit_vlom'],
    allowedTokens: Object.values(MOCK_CHAIN_PROFILES).map(
      (profile) => profile.token.address,
    ),
  };
}

function normalizePolicy(input: unknown): PolicyFile {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('policy must be a JSON object');
  }

  const record = input as Record<string, unknown>;
  const maxTxAmount = record.maxTxAmount;
  const dailyLimit = record.dailyLimit;
  const allowedMerchants = record.allowedMerchants;
  const allowedTokens = record.allowedTokens;

  if (typeof maxTxAmount !== 'string' || !UNSIGNED_INTEGER.test(maxTxAmount)) {
    throw new Error('maxTxAmount must be an unsigned integer string');
  }
  if (typeof dailyLimit !== 'string' || !UNSIGNED_INTEGER.test(dailyLimit)) {
    throw new Error('dailyLimit must be an unsigned integer string');
  }
  if (
    !Array.isArray(allowedMerchants) ||
    allowedMerchants.some((value) => typeof value !== 'string')
  ) {
    throw new Error('allowedMerchants must be an array of strings');
  }
  if (
    !Array.isArray(allowedTokens) ||
    allowedTokens.some(
      (value) => typeof value !== 'string' || !EVM_ADDRESS.test(value),
    )
  ) {
    throw new Error('allowedTokens must be an array of EVM addresses');
  }

  return {
    maxTxAmount,
    dailyLimit,
    allowedMerchants: [...new Set(allowedMerchants.map((value) => value.trim()))]
      .filter(Boolean),
    allowedTokens: [
      ...new Set(allowedTokens.map((value) => value.toLowerCase())),
    ],
  };
}

function readPolicy(): PolicyFile {
  if (!existsSync(POLICY_PATH)) {
    const initial = defaultPolicy();
    writePolicy(initial);
    return initial;
  }

  try {
    return normalizePolicy(JSON.parse(readFileSync(POLICY_PATH, 'utf8')));
  } catch {
    return defaultPolicy();
  }
}

function writePolicy(policy: PolicyFile): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const temporaryPath = `${POLICY_PATH}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, POLICY_PATH);
}

// ---------------------------------------------------------------------------
// Chain + receipt configuration (always supplied by the server)
// ---------------------------------------------------------------------------

interface ChainConfigWire extends GetChainConfigOutput {
  profile_id: MockChainProfileId;
  profile_label: string;
  explorer_tx_url: string;
  explorer_address_url: string;
}

interface ReceiptConfig {
  chainName: string;
  chainId: number;
  registryAddress: string;
  explorerUrl: string;
  explorerTxUrl: string;
  deploymentTxHash?: string;
  deployedAt?: string;
}

interface DeploymentFile {
  chainId?: number;
  address?: string;
  txHash?: string;
  deployedAt?: string;
}

function loadDeployment(): DeploymentFile {
  try {
    return JSON.parse(readFileSync(DEPLOYMENT_PATH, 'utf8')) as DeploymentFile;
  } catch {
    return {};
  }
}

function receiptConfig(): ReceiptConfig {
  const deployment = loadDeployment();
  const hsk = MOCK_CHAIN_PROFILES['hsk-testnet'];
  return {
    chainName: 'HSK Chain',
    chainId: deployment.chainId ?? hsk.chainId,
    registryAddress: deployment.address ?? '',
    explorerUrl: hsk.explorerUrl,
    explorerTxUrl: `${hsk.explorerUrl}/tx/`,
    deploymentTxHash: deployment.txHash,
    deployedAt: deployment.deployedAt,
  };
}

async function chainConfig(profileId: MockChainProfileId): Promise<ChainConfigWire> {
  const profile = MOCK_CHAIN_PROFILES[profileId];
  const mock = new MockHspMcpClient({ scenario: 'happy', profile: profileId });
  const config = await mock.get_chain_config({});

  return {
    ...config,
    profile_id: profile.id,
    profile_label: profile.label,
    explorer_tx_url: `${profile.explorerUrl}/tx/`,
    explorer_address_url: `${profile.explorerUrl}/address/`,
  };
}

// ---------------------------------------------------------------------------
// Payment records
// ---------------------------------------------------------------------------

interface PaymentCalls {
  get_chain_config: number;
  create_order: number;
  get_order: number;
  prepare_payment: number;
  finalize_payment: number;
  estimate_fee: number;
  submit_payment: number;
  query_payment: number;
}

interface PaymentRecord {
  id: string;
  scenario: ScenarioId;
  label: string;
  note: string;
  verdict: 'allowed' | 'blocked';
  status: 'running' | 'SETTLED' | 'FAILED';
  request: PaymentRequest;
  chain: ChainConfigWire;
  receipt: ReceiptConfig;
  outcome?: PaymentOutcome;
  trace: TraceEvent[];
  calls: PaymentCalls;
  createdAt: string;
  finishedAt?: string;
  paymentExplorerUrl?: string;
  receiptExplorerUrl?: string;
}

const records = new Map<string, PaymentRecord>();
const streamClients = new Set<ServerResponse>();
let runSequence = 0;
let activeProfile: MockChainProfileId = 'hsk-testnet';

function broadcast(payload: unknown): void {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of streamClients) {
    client.write(frame);
  }
}

function emptyCalls(): PaymentCalls {
  return {
    get_chain_config: 0,
    create_order: 0,
    get_order: 0,
    prepare_payment: 0,
    finalize_payment: 0,
    estimate_fee: 0,
    submit_payment: 0,
    query_payment: 0,
  };
}

function callsFrom(client: MockHspMcpClient): PaymentCalls {
  return {
    get_chain_config: client.calls.get_chain_config.length,
    create_order: client.calls.create_order.length,
    get_order: client.calls.get_order.length,
    prepare_payment: client.calls.prepare_payment.length,
    finalize_payment: client.calls.finalize_payment.length,
    estimate_fee: client.calls.estimate_fee.length,
    submit_payment: client.calls.submit_payment.length,
    query_payment: client.calls.query_payment.length,
  };
}

function explorerUrl(
  base: string | undefined,
  hash: string | null | undefined,
): string | undefined {
  return base && hash ? `${base}${hash}` : undefined;
}

async function runScenario(scenarioId: ScenarioId): Promise<PaymentRecord> {
  const definition = SCENARIOS[scenarioId];

  if (!definition) {
    throw new Error(`Unknown scenario: ${String(scenarioId)}`);
  }

  const policy = readPolicy();
  const profileId = activeProfile;
  const profile = MOCK_CHAIN_PROFILES[profileId];

  runSequence += 1;
  const id = `demo_${String(runSequence).padStart(3, '0')}`;

  const amountRaw =
    scenarioId === 'over-limit'
      ? (BigInt(policy.maxTxAmount) + 1n).toString()
      : definition.amountRaw;

  const request: PaymentRequest = {
    merchantName: definition.merchantName,
    token:
      definition.token === 'active'
        ? profile.token.address
        : definition.token,
    amountRaw,
    metadata: { scenario: scenarioId, mock: true, profile: profileId },
  };

  const chain = await chainConfig(profileId);
  const receipt = receiptConfig();

  const record: PaymentRecord = {
    id,
    scenario: scenarioId,
    label: definition.label,
    note: definition.note,
    verdict: definition.verdict,
    status: 'running',
    request,
    chain,
    receipt,
    trace: [],
    calls: emptyCalls(),
    createdAt: new Date().toISOString(),
  };

  records.set(id, record);
  broadcast({ type: 'payment', payment: record });

  const client = new MockHspMcpClient({
    scenario: definition.mock,
    merchantName: definition.merchantName,
    profile: profileId,
  });

  const policyEngine = new PolicyEngine({
    maxTxAmount: BigInt(policy.maxTxAmount),
    dailyLimit: BigInt(policy.dailyLimit),
    allowedMerchants: policy.allowedMerchants,
    allowedTokens: policy.allowedTokens,
  });

  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'hsp-trace-'));
  const ledger = new SpendLedger({
    filePath: path.join(temporaryDirectory, 'spend-ledger.json'),
  });

  const receiptRecorder: ReceiptRecorder = {
    async record(params) {
      const txHash = keccak256(
        toHex(`hsp-demo-receipt:${id}:${params.paymentRequestId}`),
      ) as Hex;
      return { txHash };
    },
  };

  const orchestrator = new PaymentOrchestrator({
    client,
    policy: policyEngine,
    ledger,
    signer: createAccountSigner(DEMO_ACCOUNT),
    merchantName: definition.merchantName,
    receiptRecorder,
    pollIntervalMs: 450,
    maxPollAttempts: 12,
    maxTimeoutRetries: 3,
    onTrace(event) {
      record.trace.push(event);
      broadcast({ type: 'trace', paymentId: id, event });
    },
  });

  const outcome = await orchestrator.execute(request);

  record.status = outcome.state;
  record.outcome = outcome;
  record.calls = callsFrom(client);
  record.finishedAt = new Date().toISOString();
  record.paymentExplorerUrl = explorerUrl(
    chain.explorer_tx_url,
    outcome.txSignature,
  );
  record.receiptExplorerUrl = explorerUrl(
    receipt.explorerTxUrl,
    outcome.receiptTxHash,
  );

  broadcast({ type: 'payment', payment: record });
  return record;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 512 * 1024) {
      throw new Error('request body too large');
    }
    chunks.push(buffer);
  }

  if (length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

async function serverConfig() {
  const profile = MOCK_CHAIN_PROFILES[activeProfile];
  return {
    activeProfile,
    profiles: Object.values(MOCK_CHAIN_PROFILES).map((entry) => ({
      id: entry.id,
      label: entry.label,
      chainId: entry.chainId,
      chainName: entry.chainName,
      tokenSymbol: entry.token.symbol,
    })),
    chain: await chainConfig(activeProfile),
    receipt: receiptConfig(),
    policy: readPolicy(),
    scenarios: Object.values(SCENARIOS).map((scenario) => ({
      id: scenario.id,
      label: scenario.label,
      note: scenario.note,
      verdict: scenario.verdict,
    })),
    demo: {
      mockDriven: true,
      liveMcpCalls: false,
      profileLabel: profile.label,
    },
  };
}

function openStream(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write('retry: 2000\n\n');
  response.write(
    `data: ${JSON.stringify({ type: 'hello', at: new Date().toISOString() })}\n\n`,
  );

  streamClients.add(response);
  request.on('close', () => {
    streamClients.delete(response);
    response.end();
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(
    request.url ?? '/',
    `http://${request.headers.host ?? 'localhost'}`,
  );
  const pathname = url.pathname;
  const method = request.method ?? 'GET';

  if (method === 'GET' && pathname === '/api/config') {
    sendJson(response, 200, await serverConfig());
    return;
  }

  if (method === 'GET' && pathname === '/api/payments') {
    sendJson(response, 200, {
      payments: Array.from(records.values()).sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    });
    return;
  }

  if (method === 'GET' && pathname.startsWith('/api/trace/')) {
    const id = decodeURIComponent(pathname.slice('/api/trace/'.length));
    const record = records.get(id);

    if (!record) {
      sendJson(response, 404, { error: `Unknown payment: ${id}` });
      return;
    }

    sendJson(response, 200, record);
    return;
  }

  if (method === 'GET' && pathname === '/api/stream') {
    openStream(request, response);
    return;
  }

  if (method === 'POST' && pathname === '/api/policy') {
    try {
      const policy = normalizePolicy(await readJson(request));
      writePolicy(policy);
      broadcast({ type: 'policy', policy });
      sendJson(response, 200, { policy });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (method === 'POST' && pathname === '/api/profile') {
    try {
      const body = (await readJson(request)) as { profile?: unknown };
      const profileId = body.profile;

      if (
        profileId !== 'hsk-testnet' &&
        profileId !== 'sepolia'
      ) {
        sendJson(response, 400, { error: 'Unknown chain profile' });
        return;
      }

      activeProfile = profileId;
      const config = await serverConfig();
      broadcast({ type: 'profile', config });
      sendJson(response, 200, config);
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (method === 'POST' && pathname.startsWith('/api/demo/')) {
    const scenarioId = decodeURIComponent(
      pathname.slice('/api/demo/'.length),
    ) as ScenarioId;

    if (!(scenarioId in SCENARIOS)) {
      sendJson(response, 404, { error: `Unknown scenario: ${scenarioId}` });
      return;
    }

    try {
      const record = await runScenario(scenarioId);
      sendJson(response, 200, record);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  sendJson(response, 404, { error: `Not found: ${method} ${pathname}` });
}

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      response.end();
    }
  });
});

// Keep the SSE connections warm through proxies that idle-close.
const heartbeat = setInterval(() => {
  for (const client of streamClients) {
    client.write(': ping\n\n');
  }
}, 15_000);
heartbeat.unref();

server.listen(PORT, () => {
  console.log(`HSP trace demo server (mock-only) -> http://localhost:${PORT}`);
  console.log(`Active chain profile: ${activeProfile}`);
  console.log(`Policy file: ${POLICY_PATH}`);
});

function shutdown(): void {
  for (const client of streamClients) {
    client.end();
  }
  streamClients.clear();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
