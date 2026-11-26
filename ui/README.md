# A2A Payment Firewall — Trace UI

Mock-driven dashboard for the `PaymentOrchestrator`. Every scenario runs the
real state machine against `MockHspMcpClient`; the UI and the trace server never
make a live HSP MCP call.

## Run locally

From the repository root:

```bash
npm install
npm run serve:trace        # http://localhost:8787 (mock trace server)
```

In a second terminal:

```bash
cd ui
npm install
npm run dev                # http://localhost:5173
```

Production bundle check:

```bash
cd ui
npm run build
```

## Data flow

- `scripts/serve-trace.ts` exposes:
  - `GET /api/config`
  - `GET /api/payments`
  - `GET /api/trace/:id`
  - `GET /api/stream` (SSE)
  - `POST /api/policy` (persists `data/policy.json`)
  - `POST /api/profile` (switches HSK Testnet / Ethereum Sepolia)
  - `POST /api/demo/:scenario`
- The browser only talks to the local trace server. Chain id, token, decimals,
  payment protocol, explorer URLs and receipt registry all arrive from the
  server at runtime.
- Two mock profiles are available:
  - **HSK Testnet** — chain `133`, example HSK token.
  - **Ethereum Sepolia — official QA rail** — chain `11155111`, Circle USDC.

## Scenarios

| id | outcome |
| --- | --- |
| `happy` | policy pass → quote cross-check → sign → settled → receipt |
| `malicious-invoice` | blocked by `UNSUPPORTED_TOKEN` |
| `over-limit` | blocked by `EXCEEDS_MAX_TX` (`maxTxAmount + 1`) |
| `untrusted-merchant` | blocked by `UNTRUSTED_MERCHANT` |
| `tampered-quote` | blocked pre-sign by `POLICY_MISMATCH` |
| `quote-expired-requote` | `prepare_payment ×2`, `create_order ×1`, settles |
| `timeout` | two poll timeouts, same order, then settles |

Reference screenshots for all seven scenarios plus the Sepolia profile switch
live in `../screenshots/`.
