# Task 19 — Whitepaper v2 + Documentation Update

> Codex execution instruction. This task is code-only — no deployments.
> Update all documentation to reflect the actual live Phase 3 system.

---

## Goal

The current `WHITEPAPER_DRAFT.md` and `AUDIT_SCOPE.md` were written during Phase 1 (Task 5/6). They describe a 3-contract system with staking, governance, ERC-8004, and automation listed as "Phase 2 roadmap." All of that is now **live on Base Sepolia**. Update all documentation so it accurately reflects what is deployed and tested.

---

## Deliverable 1 — `WHITEPAPER_V2.md`

Create a **new file** `WHITEPAPER_V2.md` (do NOT overwrite the original draft — keep it for historical comparison).

### What Must Change

The v1 whitepaper describes a 3-contract Phase 1 system. The v2 must describe the full 6-contract live system. Specific sections that need rewriting or significant expansion:

**§3 Architecture Overview:**
- Now 6 contracts, not 3. Add `TavernStaking`, `TavernGovernance`, `TavernAutomationRouter`.
- Describe the single-upkeep Chainlink Automation architecture (router pattern).
- Mention the `TavernImports.sol` aggregator pattern.

**§6 $TVRN Tokenomics:**
- Staking is no longer "Phase 2 planned" — it is live. Document the 100 TVRN bond, 7-day cooldown, 50% slash-to-burn.
- Fee routing is now 60/20/20 split implemented in `_routeFeeAmount()`.

**§10 Governance & DAO:**
- Major rewrite needed. v1 says governance is future. v2 must document:
  - `TavernGovernance.sol` is live
  - sqrt(balance) voting with 1.2x active-agent bonus and 1.5x founding-agent bonus
  - 6 ProposalTypes: ParameterChange, FeeStageOverride, EmissionAdjustment, EmergencyFreeze, RoleGrant, Custom
  - 5-day voting period, 2-day timelock (except EmergencyFreeze = instant queue)
  - Quorum: 10% of total supply by sqrt voting power
  - Full lifecycle: propose → vote → queue → execute/cancel

**§12 Ecosystem & Interoperability:**
- ERC-8004 is no longer "Phase 2 planned." It is live (unconfigured).
- Document the dual-path registration: self-register OR ERC-8004 NFT
- Document `erc8004Required` admin flag
- Document best-effort reputation mirroring via `giveFeedback()`
- Document tagged events for reputation flow

**§13 Security:**
- Add subsection for staking security (slash mechanics, SLASHER_ROLE isolation)
- Add subsection for governance security (timelock, EmergencyFreeze, nonReentrant execute)
- Add subsection for automation security (KEEPER_ROLE chain: Chainlink → Forwarder → Router → Escrow/Registry)
- Update contract inventory to include all 6 contracts

**§14 Roadmap:**
- Phase 1 and Phase 2 are now COMPLETED. Rewrite as accomplished milestones.
- Phase 3 (current): mainnet preparation, audit, gas optimization.
- Phase 4 (future): agent-to-agent delegation, multi-chain, advanced validation.

**New Section — §X Automation Architecture:**
- Add a dedicated section explaining the `TavernAutomationRouter` pattern
- 4 TaskTypes: ExecuteTimeout, AutoApprove, FeeStageCheck, QuotaRebalance
- Batch quest scanning with cursor
- `pendingQuotaScores` admin injection for off-chain data
- Single Chainlink upkeep targeting the router

**New Section — §X Staking Mechanics:**
- Expand the brief mention in §6 into a full section
- 100 TVRN bond requirement for guild membership
- 7-day unstake cooldown
- 50% slash-to-burn via SLASHER_ROLE
- Must leave guild before unstaking
- Relationship: Registry.joinGuild() checks staking.isStaked()

### Tone and Style

- Match the existing whitepaper's narrative style (professional but accessible, tavern metaphors woven in)
- Keep the disclaimer section (§16) unchanged
- Keep the abstract updated but concise
- Total length: aim for ~250-350 lines (v1 is 172 lines, v2 should be roughly 1.5-2x given the expanded scope)

### Structural Outline

```
1. Abstract (updated)
2. Introduction (minor updates)
3. Architecture Overview (major rewrite — 6 contracts)
4. Quest Lifecycle (minor updates — add automation trigger notes)
5. Compensation Model (unchanged core, add mock feed note for testnet)
6. $TVRN Tokenomics (expand staking integration)
7. Evaluation System (unchanged)
8. Agent Reputation & Quota (add automation-driven rebalance detail)
9. Staking Mechanics (NEW section)
10. Oracle & Price Feeds (minor update — testnet uses mock feeds)
11. Governance & DAO (major rewrite — live governance)
12. Automation Architecture (NEW section)
13. Ecosystem & Interoperability (major update — ERC-8004 live)
14. Security (expand for 6 contracts)
15. Roadmap (rewrite — Phase 1+2 completed, Phase 3+4 ahead)
16. Conclusion (updated)
17. Disclaimer (unchanged)
```

---

## Deliverable 2 — `AUDIT_SCOPE.md` Update

**Edit in-place** (the original is the working document).

### What Must Change

**Contract Inventory:**
- Add `TavernStaking.sol`, `TavernGovernance.sol`, `TavernAutomationRouter.sol` with line counts
- Add interface files: `ITavernStaking.sol`, `ITavernToken.sol`, `ITavernGovernance.sol`, `ITavernRegistryGovernance.sol`, `IAutomationCompatible.sol`, `IERC8004IdentityRegistry.sol`, `IERC8004ReputationRegistry.sol`
- Update `TavernRegistry.sol` line count (it grew with ERC-8004)
- Update `TavernEscrow.sol` line count (it grew with `getAutomationQuestView`)

**External Dependencies:**
- Add Chainlink AutomationCompatibleInterface
- Note: ERC-8004 interfaces are local (no npm dependency)

**Core Invariants:**
- Add: Staking bond must equal exactly STAKE_AMOUNT (100e18) — no partial stakes
- Add: Slash must burn exactly 50% and force unstake request
- Add: Governance voting power must use sqrt(balance) not raw balance
- Add: Governance timelock must be 2 days except EmergencyFreeze
- Add: Automation router must only execute through KEEPER_ROLE chain
- Add: Quest state in router's checkUpkeep must match Escrow's actual state

**Known Constraints:**
- Update: Staking is no longer "Phase 2 not implemented" — remove that line
- Update: TVRN/USD feed is now a MockV3Aggregator on testnet at `0x18CDD23AcA610722750d34401B433e4C07bf9a69`
- Add: Governance currently has no GOVERNANCE_ROLE wiring on target contracts (proposals execute but can't directly modify other contracts)
- Add: ERC-8004 identity/reputation registries are deployed but unconfigured (address(0))

**Threat Model:**
- Add: Governance proposal spam / quorum manipulation
- Add: Automation router cursor manipulation (admin-only, but document)
- Add: Staking slash abuse via SLASHER_ROLE
- Add: ERC-8004 identity theft via transferred NFTs
- Add: pendingQuotaScores injection by compromised admin

**Fuzz Tests:**
- Add recommended fuzz targets for staking (slash boundary, cooldown boundary)
- Add recommended fuzz targets for governance (voting power overflow, sqrt edge cases)
- Add recommended fuzz targets for automation (batch cursor wraparound, empty quest range)

---

## Deliverable 3 — `DEPLOY_GUIDE.md` Update

**Edit in-place.**

### What Must Change

- Update the contract list to include all 6 contracts
- Add Phase 3 coordinated redeploy instructions (reference `deploy/07_phase3_redeploy.ts`)
- Add the resume env var documentation for `PHASE3_REUSE_*`
- Add mock TVRN/USD feed deployment step for testnet
- Update the automation registration section to describe router-mode
- Document the current live addresses as the reference deployment
- Add a "Post-Deploy E2E QA" section referencing `scripts/e2e-testnet-qa.ts`

---

## Checklist

### Whitepaper v2

- [ ] `WHITEPAPER_V2.md` created (new file, not overwriting v1)
- [ ] §3 rewritten for 6-contract architecture
- [ ] §6 expanded with live staking details
- [ ] §9 (Staking Mechanics) new section added
- [ ] §10/11 (Governance) major rewrite with live details
- [ ] §12 (Automation Architecture) new section added
- [ ] §13 (Ecosystem) updated for live ERC-8004
- [ ] §14 (Security) expanded for all 6 contracts
- [ ] §15 (Roadmap) rewritten with Phase 1+2 as completed milestones
- [ ] Disclaimer preserved unchanged
- [ ] Narrative style consistent with v1

### Audit Scope

- [ ] Contract inventory updated (6 contracts + interfaces)
- [ ] Line counts reflect current source
- [ ] Core invariants expanded for staking, governance, automation
- [ ] Known constraints updated
- [ ] Threat model expanded
- [ ] Fuzz test recommendations added

### Deploy Guide

- [ ] Contract list updated
- [ ] Phase 3 redeploy documented
- [ ] Resume env vars documented
- [ ] Mock feed deployment step added
- [ ] Router-mode automation documented
- [ ] E2E QA reference added

### Build

- [ ] `npm run compile` passes (no contract changes, just docs)
- [ ] `npx tsc --noEmit` passes
- [ ] No broken markdown links in any doc

### HANDOFF

- [ ] `HANDOFF_RESUME.md` updated:
  - Task 19 row: "Completed — docs refreshed for Phase 3 live system"
  - "What Changed In Task 19" section added
  - Important Project Files section updated with `WHITEPAPER_V2.md`

---

## Phase 3 Roadmap (Tasks 16–20)

| Task | Description | Status |
|------|-------------|--------|
| 16 | Live deploy Governance + Router | ✅ Completed |
| 17 | Coordinated Phase 3 redeploy | ✅ Completed |
| 18 | E2E testnet QA (10/10 PASS) | ✅ Completed |
| **19** | **This task** — Whitepaper v2 + docs update | Code only |
| 20 | Mainnet Prep | Pending |
