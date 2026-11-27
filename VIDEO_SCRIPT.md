0-8s   Hook: "AI agents pay each other via HSP. We stop them signing what they shouldn't."
8-25s  Happy path: live trace Quote->Policy->CrossCheck->Sign->Settlement->Receipt,
       green SETTLED, receipt explorer link. (Use live tx when allowlist lands.)
25-45s tampered-quote -> red POLICY_MISMATCH, signature NOT called.
       "Server inflated the quote — firewall blocked it before signing."
45-55s over-limit -> POLICY_BLOCKED; show daily limit survives restart (ledger).
55-70s Architecture diagram + 61 tests + real HSK contract. "Guide-compliant, chain-agnostic."
70-82s Roadmap 3 phases + website + X. "Built for HashKey's compliance focus."
82-90s GitHub link + team kolit_vlom.
