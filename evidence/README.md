# Evidence index

All screenshots below come from the local mock dashboard
(`ui/` + `scripts/serve-trace.ts`) unless noted otherwise. Mock traces are
tagged `mode=mock`; no real transaction was broadcast for those captures.

## Scenario screenshots

Location: [`screenshots/`](./screenshots)

| file | scenario | result |
| --- | --- | --- |
| `01-happy.png` | happy path | SETTLED, payment + receipt links |
| `02-malicious-invoice.png` | malicious invoice | POLICY_BLOCKED / UNSUPPORTED_TOKEN |
| `03-over-limit.png` | over limit | POLICY_BLOCKED / EXCEEDS_MAX_TX |
| `04-untrusted-merchant.png` | untrusted merchant | POLICY_BLOCKED / UNTRUSTED_MERCHANT |
| `05-tampered-quote.png` | tampered quote | POLICY_MISMATCH pre-sign, signature not called |
| `06-quote-expired-requote.png` | quote expired | prepare_payment ×2 on same order, SETTLED |
| `07-timeout.png` | payment timeout | two poll timeouts, same order, SETTLED |
| `08-sepolia-happy.png` | happy path, Sepolia profile | chain badge + explorer links switch dynamically |

## Faucet

Location: [`faucet-tab.png`](./faucet-tab.png), [`faucet-tab1.png`](./faucet-tab1.png), [`faucet-tab2.png`](./faucet-tab2.png)

HSK testnet faucet tab showing the wallet address used for the QA payment rail.

## Telegram / allowlist

Location: [`telegram/`](./telegram)

| file | content |
| --- | --- |
| `allowlist_quest.png` | allowlist quest / access step for the HSP QA gateway |
| `email.png` | provisioning email for the allowlisted host |
| `w3frances.png` | Telegram support thread on gateway access |

## Transaction hashes

| item | hash / address | explorer |
| --- | --- | --- |
| ReceiptRegistry (HSK testnet 133) | `0x5a2e50040dd7242231ee593cf61f5d34e15ef121` | https://explorer.testnet.hsk.xyz/address/0x5a2e50040dd7242231ee593cf61f5d34e15ef121 |
| Registry deploy tx | `0xddec5941b902b99f7139338ac79562d261d6762230f327d4d88bfcb56c5e623f` | https://explorer.testnet.hsk.xyz/tx/0xddec5941b902b99f7139338ac79562d261d6762230f327d4d88bfcb56c5e623f |
| Live payment tx | _pending live allowlisted run_ | — |
| Receipt tx | _pending live allowlisted run_ | — |

Deployment metadata: [`../deployments/133.json`](../deployments/133.json)

## Reproduce locally

```bash
npm install
npm test                        # 61 passing
npm run demo-payment -- --mock  # writes data/demo-trace.json, mode=mock
npm run serve:trace             # open the trace UI
```
