# HSP A2A Firewall

A policy-enforcing payment agent for the HashKey HSP MCP rail. It turns an
untrusted payment intent into an HSP order, checks the server-supplied EIP-712
quote against the approved intent before signing, never recreates an order on a
timeout, and writes an on-chain receipt only after a verified settlement.

> Current status: HSK testnet only. The live MCP gateway is QA and may return
> HTTP 403 while access is being provisioned. Every demo path below runs against
> an in-memory mock by default.

## What it does

- **Policy before value moves**: per-transfer limit, daily limit, merchant
  allowlist and token allowlist are checked before `create_order` and re-checked
  after a re-quote.
- **Signs the server payload verbatim**: production signing forwards the
  `prepare_payment.eip712` object unchanged (only the redundant `EIP712Domain`
  type entry is stripped for viem).
- **Cross-checks pre-sign**: payer, amount, recipient, token and chain id are
  verified against the approved intent and live `get_chain_config`.
- **Survives timeouts**: polling never recreates an order; a checkpoint on disk
  lets `npm run resume` find a payment that settled after the local process
  stopped.
- **Records receipts last**: `AgentReceiptRegistry.recordReceipt` is called only
  after `payment-finalized` with `attribution_verified === true`.

## Architecture

```
intent
  │
  ▼
PolicyEngine ──block──▶ FAILED (no order, no signature)
  │ allow
  ▼
create_order (HSP MCP)  ── checkpoint
  │
  ▼
prepare_payment ──▶ policy re-check ──▶ validateQuoteAgainstIntent
  │                                          │ mismatch
  │                                          ▼
  │                                     POLICY_MISMATCH (pre-sign)
  ▼
signServerTypedData (exact server EIP-712)
  │
  ▼
finalize_payment ──▶ submit_payment ──▶ query_payment (poll)
  │                                           │
  │                                           ├─ payment-safe → keep polling
  │                                           ├─ timeout      → retry, same order
  │                                           └─ payment-finalized + attribution
  ▼
SETTLED ──▶ addSpend(ledger) + recordReceipt(registry)
```

Modules:

| Path | Role |
| --- | --- |
| `src/core/policy.ts` | Pure deterministic policy gate |
| `src/core/eip712.ts` | Production signer (R1) |
| `src/core/stateMachine.ts` | Orchestrator, trace, resume guard |
| `src/core/ledger.ts` | UTC-day JSON spend ledger |
| `src/core/receipt.ts` | Receipt hashing, ABI and on-chain write |
| `src/core/paymentState.ts` | Atomic last-payment checkpoint |
| `src/mcp/schemas.ts` | Single source of truth for wire shapes |
| `src/mcp/liveClient.ts` | MCP SDK transport, timeouts, retries, caching |
| `src/mcp/client.ts` | Scenario-driven mock client |

## Why it is safe

- A policy block happens **before** `create_order`, so no order or signature is
  ever produced.
- The signed EIP-712 payload is the server's object, not a re-built one.
- `validateQuoteAgainstIntent` compares amount, payer, recipient, token and
  chain id before the signer is invoked.
- Reads retry at most twice with backoff. Writes (`create_order`,
  `prepare_payment`, `finalize_payment`, `submit_payment`) are never retried.
- A malformed payload is a hard `PARSE_ERROR`; it is never retried.
- Error `30043` triggers exactly one re-quote on the **same** order.
- `payment-safe` is not settlement; receipts and spend are written only on
  `payment-finalized` with verified attribution.
- `execute()` refuses to create a new order while a non-terminal payment is
  checkpointed, unless `--force` is passed.

## Quickstart

```bash
npm install
cp .env.example .env      # fill in values for live runs only
npm test
npx tsc --noEmit

# Everything below is safe offline: --mock never contacts the gateway,
# never broadcasts a transaction and never writes a real receipt.
npm run preflight -- --mock
npm run approve -- --mock
npm run demo-payment -- --mock
npm run resume -- --mock

# Regenerate docs without the live gateway (403-safe).
npm run mcp:dump -- --mock
```

`npm run demo-payment -- --mock` writes `data/demo-trace.json` and a
`data/last-payment.json` checkpoint, then prints the state trace, mock tx hash
and explorer URL.

For a live run once the gateway is reachable:

```bash
npm run preflight
npm run approve
npm run demo-payment
npm run resume
```

## On-chain evidence (HSK testnet, chain 133)

| Item | Value |
| --- | --- |
| Registry | `0x5a2e50040dd7242231ee593cf61f5d34e15ef121` |
| Deploy tx | `0xddec5941b902b99f7139338ac79562d261d6762230f327d4d88bfcb56c5e623f` |
| Deployed at | 2026-11-26T06:46:57.868Z |
| Explorer | https://explorer.testnet.hsk.xyz/address/0x5a2e50040dd7242231ee593cf61f5d34e15ef121 |

The registry is append-only: only the deployer can record, and each
`keccak256(payment_request_id)` key can be written exactly once.

## Roadmap

- [x] Policy engine, pre-sign quote validation, mock E2E harness
- [x] Live MCP client with transport seam, retries, timeout, caching
- [x] Checkpoint/resume guard and on-chain receipt registry
- [x] `--mock` preflight / approve / demo / resume scripts
- [ ] Confirm the live MCP payloads in `docs/schema-diff.md`
- [ ] Live testnet payment with public explorer evidence
- [ ] Multi-token `tokens[]` selection in the UI
- [ ] Mainnet readiness review (audit, key management, RPC redundancy)

## Testnet vs mainnet

This repository is **testnet-first**. All demo keys are deterministic public
fixtures, `data/` is gitignored, and `.env.example` contains no secrets. Do not
point these scripts at mainnet until the live schema diff is complete, the
registry has been independently reviewed, and key management is moved out of a
local `.env` file.
