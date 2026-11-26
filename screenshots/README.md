# Scenario screenshots

Captured from the local mock dashboard (`ui/` + `scripts/serve-trace.ts`).

| file | scenario | result |
| --- | --- | --- |
| `01-happy.png` | happy | SETTLED, payment + receipt links |
| `02-malicious-invoice.png` | malicious-invoice | POLICY_BLOCKED / UNSUPPORTED_TOKEN |
| `03-over-limit.png` | over-limit | POLICY_BLOCKED / EXCEEDS_MAX_TX |
| `04-untrusted-merchant.png` | untrusted-merchant | POLICY_BLOCKED / UNTRUSTED_MERCHANT |
| `05-tampered-quote.png` | tampered-quote | POLICY_MISMATCH pre-sign |
| `06-quote-expired-requote.png` | quote-expired-requote | prepare_payment ×2, create_order ×1, SETTLED |
| `07-timeout.png` | timeout | two poll timeouts, same order, SETTLED |
| `08-sepolia-happy.png` | happy on Sepolia profile | badge + explorer links switch dynamically |

No screenshot was produced by a live MCP call. Payment and receipt hashes are
deterministic mock fixtures.
