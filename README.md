# A2A Payment Firewall — HSP Track 2 (team kolit_vlom)
Deterministic spending guardrails for autonomous agent-to-agent payments
via HashKey Smart Payment (HSP) MCP.

## Problem
AI agents that pay other agents can hallucinate invoices, overspend, or sign
tampered quotes. HSP executes payments; it does not decide whether an agent
SHOULD pay. We add that decision layer — before any EIP-712 signature.

## Architecture
BuyerAgent -> PolicyFirewall -> QuoteCrossCheck -> EIP-712 Sign
  -> HSP MCP (create_order/prepare/finalize/submit/query)
  -> Settlement -> AgentReceiptRegistry (HSK Chain)

## Why it is safe
- Deterministic policy: maxTx, dailyLimit (persistent ledger), merchant/token allowlist.
- Pre-sign cross-check: server eip712 validated against approved intent
  (amount/recipient/token/chainId); mismatch -> POLICY_MISMATCH, never signs.
- Verbatim EIP-712 signing (eip3009 + Permit2); no hardcoded chain/token.
- 30043 -> re-quote on SAME order; payment-timeout -> never recreate order.
- SETTLED only on payment-finalized AND attribution_verified=true.
- On-chain receipt recorded only after final settlement.

## Compliance alignment
Built for HashKey's institutional focus: auditable guardrails, allowlists,
persistent spend limits, on-chain receipt trail.

## Guide compliance
Implements all 8 HSP MCP tools per official Agentic Payment Setup & Execution
Guide (rev 2026-10-30). Chain/token/decimals from live get_chain_config only.

## Quickstart
cp .env.example .env  # fill keys
npm install && npm test          # 61 passing
npm run preflight -- --mock
npm run demo-payment -- --mock   # tagged mode=mock, no real tx
# live (allowlisted host): npm run preflight && npm run demo-payment

## On-chain evidence
- ReceiptRegistry (HSK testnet 133): 0x5a2e50040dd7242231ee593cf61f5d34e15ef121
- Deploy tx: 0xddec5941b902b99f7139338ac79562d261d6762230f327d4d88bfcb56c5e623f
- Live payment tx: <fill after live run>
- Receipt tx: <fill after live run>

## Roadmap
Phase 1 (hackathon): policy firewall + HSP settlement + receipt registry + trace UI.
Phase 2: multi-agent marketplace, reusable mandates, webhook support.
Phase 3: mainnet production, institutional custody integration, audit.

## Testnet/mainnet
QA payment rail + HSK Chain contract per official Q25/Q30. Mainnet deploy for
Demo Day finalists.

## Team
kolit_vlom (solo). GitHub: vektorG/hsp-a2a-firewall.
