A2A Payment Firewall adds a deterministic spending guardrail layer to HashKey
Smart Payment agent payments. Before an agent signs any EIP-712 mandate, our
firewall enforces per-tx/daily limits, merchant/token allowlists, and cross-checks
the server quote against the approved intent — blocking tampered or hallucinated
invoices before signature. Settled payments are anchored to an on-chain
ReceiptRegistry on HSK Chain. Built strictly per the official HSP Agentic Payment
Guide (all 8 MCP tools, no hardcoded chain/token), 61 passing tests, live trace UI.
Aligns with HashKey's compliance/security focus. Roadmap: multi-agent marketplace,
reusable mandates, mainnet production. Demo video + GitHub below.
