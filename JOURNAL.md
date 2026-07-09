# JOURNAL — sera
Continuity ledger per CTO charter §6/§6bis. Every entry is evidence-grounded.

Format per entry:
## <date> · <slice/WO id> · <status: in-progress | in-review | done | blocked-on-founder>
- What was done (with the tool result / test output that proves it)
- Decisions made · safest-defaults applied on open ⏳ (flagged) · founder overrides
- Pending / next

---

## 2026-07-09 · E0 bootstrap (pre-WO-SE0.1) · done
- Pre-flight: repo slug verified `sera` (origin remote `beurni2/sera` — lowercase kebab-case). `platform-contracts` pinned clone verified at `b10f4822b173c9cd4b162f416ad213bf580ab652`; `/CONSUMING.md` read.
- **Pin decision:** `git ls-remote --tags` on platform-contracts origin shows no `v0.1.0` (only the founder-artifact tag `boss`, ignored per instruction — being deleted) — **pin ref is the commit sha `b10f4822…`**; move to `#v0.1.0` in the first version-bump PR.
- Pinned-Quote pre-check (source): `supplyMode`/`handlingClass`/`kittingSealId` appear in `shapes/quote.ts` ONLY in the comment stating they are excluded; the schema is `.strict()` (undeclared keys are a parse failure). Empirical confirmation against the installed package follows in the Step-4 state-back.
- Bootstrapped from the pinned clone: `/docs` (seven canon documents), `/CLAUDE.md` + `/AGENTS.md` (byte-identical), `/WORK-ORDERS/WO-SE0.1.md`, this fresh `/JOURNAL.md`.
- Known-from-siblings (same day): CI needs the `PLATFORM_CONTRACTS_READ_TOKEN` insteadOf auth step before install (founder ruling; secret already added to this repo per founder) · pnpm/action-setup must NOT carry a `version` input (packageManager pin is the source) · RN shells must not runtime-import node-only canon barrels (type-only imports + devDependencies + ban-test; prove with `expo export`) · Playwright-style web servers must bind 127.0.0.1 in CI. All applied from birth.
- Pending / next: WO-SE0.1 on branch `e0/wo-se0.1`.
