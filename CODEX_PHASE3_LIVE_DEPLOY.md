# Task 16 — Phase 3 Live Deploy (Governance + AutomationRouter)

> Codex execution instruction. This task DOES deploy to Base Sepolia.
> Two standalone deploys + automation re-registration + frontend address update.

---

## Goal

Deploy `TavernGovernance` and `TavernAutomationRouter` to live Base Sepolia, wire permissions, re-register automation through the router, and update frontend + manifests with live addresses.

These two contracts are standalone — they read from existing Token/Registry/Escrow but don't require Registry/Escrow redeployment.

---

## Execution Order

```
Step 1: Deploy TavernGovernance
Step 2: Deploy TavernAutomationRouter
Step 3: Grant KEEPER_ROLE to Router on Escrow + Registry
Step 4: Re-register automation (single router upkeep)
Step 5: Update frontend + manifests
Step 6: Verify all contracts on Basescan
Step 7: Validation checks
```

---

## Step 1 — Deploy TavernGovernance

```bash
npx hardhat run deploy/05_deploy_governance.ts --network baseSepolia
```

Expected behavior (from existing script):
- Deploys TavernGovernance(TavernToken, TavernRegistry)
- Verifies on Basescan
- Updates `deployments/baseSepolia.json` with `tavernGovernance` address
- Updates `claw-tavern-app.html` CONFIG with live address

Record the deployed address and tx hash.

---

## Step 2 — Deploy TavernAutomationRouter

```bash
npx hardhat run deploy/06_deploy_automation_router.ts --network baseSepolia
```

Expected behavior (from existing script):
- Deploys TavernAutomationRouter(TavernEscrow, TavernRegistry)
- Grants KEEPER_ROLE to router on Escrow and Registry
- Verifies on Basescan
- Updates `deployments/baseSepolia.json` with `tavernAutomationRouter` address
- Updates `claw-tavern-app.html` CONFIG with live address

Record the deployed address and tx hash.

---

## Step 3 — Verify KEEPER_ROLE Grants

After Step 2, confirm on-chain:

```typescript
// Router should have KEEPER_ROLE on both contracts
const KEEPER_ROLE = ethers.id("KEEPER_ROLE");

// Check Escrow
await escrow.hasRole(KEEPER_ROLE, routerAddress); // must be true

// Check Registry
await registry.hasRole(KEEPER_ROLE, routerAddress); // must be true
```

If the deploy script already did this (it should), just verify. If not, run grants manually:

```bash
# Only if needed
cast send $ESCROW "grantRole(bytes32,address)" $KEEPER_ROLE $ROUTER --private-key $PK
cast send $REGISTRY "grantRole(bytes32,address)" $KEEPER_ROLE $ROUTER --private-key $PK
```

---

## Step 4 — Re-register Automation

Now that `tavernAutomationRouter` is in the manifest, the script will use the single-upkeep router path:

```bash
npx hardhat run scripts/register-automation.ts --network baseSepolia
```

Expected behavior:
- Detects `tavernAutomationRouter` in manifest → single `tavernAutomationRouter` upkeep definition
- Old 3 upkeeps (dailyQuotaRebalance, executeTimeout, checkAndUpgradeFeeStage) will be compared against the new single upkeep
- Registers new upkeep targeting the router
- Discovers forwarder, grants KEEPER_ROLE to forwarder on Router
- Backs up existing automation manifest

After registration:
- Note the new upkeep ID
- Note the new forwarder address
- Verify forwarder has KEEPER_ROLE on TavernAutomationRouter

**Important**: The Chainlink forwarder needs KEEPER_ROLE on the **Router** contract (not on Escrow/Registry — the Router already has that). The register-automation.ts script grants KEEPER_ROLE on Escrow and Registry, but you may need to also grant on Router:

```typescript
await router.grantRole(KEEPER_ROLE, forwarderAddress);
```

If `register-automation.ts` doesn't handle this automatically, add a manual grant.

---

## Step 5 — Update Frontend + Manifests

Both deploy scripts should have already updated:
- `deployments/baseSepolia.json` — live addresses for both contracts
- `claw-tavern-app.html` — CONFIG addresses for both contracts

Verify these updates happened. If the Governance tab was showing "not yet deployed" placeholder, it should now show the full proposal UI.

Also update `deployments/baseSepolia.automation.json` — this should have been updated by Step 4.

---

## Step 6 — Basescan Verification

Both deploy scripts include verification. Confirm both contracts show verified source on Basescan:
- TavernGovernance: `https://sepolia.basescan.org/address/<GOVERNANCE_ADDRESS>#code`
- TavernAutomationRouter: `https://sepolia.basescan.org/address/<ROUTER_ADDRESS>#code`

If verification failed during deploy, re-run:
```bash
npx hardhat run scripts/verify-contracts.ts --network baseSepolia
```

---

## Step 7 — Validation Checks

Run the full validation suite:

### 7.1 On-chain State

```
TavernGovernance:
  - tavernToken() == 0x3b63deb3632b2484bAb6069281f08642ab112b16
  - registry address matches 0x7f4fd10f1F0F847a68855f364a1C09cBF2831D33
  - quorum() returns a non-zero value
  - nextProposalId() == 0

TavernAutomationRouter:
  - escrow() == 0x1528580Db5fDfbaC2fe9d364D9De402490032ccD
  - registry() == 0x7f4fd10f1F0F847a68855f364a1C09cBF2831D33
  - scanBatchSize() == 50
  - quotaRebalanceInterval() == 86400
  - has KEEPER_ROLE on Escrow
  - has KEEPER_ROLE on Registry
  - Chainlink forwarder has KEEPER_ROLE on Router
```

### 7.2 Automation Health

```bash
npm run verify:automation
```

Should show:
- Single upkeep targeting TavernAutomationRouter
- Upkeep is active
- Forwarder has KEEPER_ROLE

### 7.3 Frontend Spot Check

Open `claw-tavern-app.html` in a browser:
- Governance tab should show proposal form (not placeholder)
- Governance KPI cards should show live quorum value
- Staking tab should still work (unchanged)
- Header should show TavernGovernance card (no longer hidden)

---

## Checklist

### Deploy

- [ ] `TavernGovernance` deployed to Base Sepolia
- [ ] `TavernAutomationRouter` deployed to Base Sepolia
- [ ] Both contracts verified on Basescan
- [ ] Deploy tx hashes recorded

### Permissions

- [ ] Router has `KEEPER_ROLE` on TavernEscrow
- [ ] Router has `KEEPER_ROLE` on TavernRegistry
- [ ] Chainlink forwarder has `KEEPER_ROLE` on TavernAutomationRouter

### Automation

- [ ] `register-automation.ts` ran with router-path
- [ ] Single `tavernAutomationRouter` upkeep registered
- [ ] New upkeep ID recorded
- [ ] New forwarder recorded
- [ ] `verify:automation` passes

### Manifests

- [ ] `deployments/baseSepolia.json` — governance + router addresses populated
- [ ] `deployments/baseSepolia.automation.json` — router upkeep recorded
- [ ] `claw-tavern-app.html` CONFIG — governance + router addresses populated
- [ ] Governance header card now visible

### HANDOFF

- [ ] `HANDOFF_RESUME.md` updated:
  - Task 16 row: "Completed on Base Sepolia"
  - Live Deployment Snapshot: governance + router addresses filled
  - Automation State: updated to single router upkeep
  - "What Changed In Task 16" section added
- [ ] Old 3-upkeep automation state documented as superseded

---

## Rollback Plan

If either deploy fails mid-way:
- Governance is independent — partial deploy leaves system unchanged
- Router is independent — if it deploys but automation re-registration fails, the old 3-upkeep setup continues working
- Use the `PHASE2_REUSE_*` env var pattern if a deploy needs to be resumed

If the Chainlink forwarder KEEPER_ROLE grant on Router is missed:
- `checkUpkeep` will work (view call)
- `performUpkeep` will revert with "Not keeper" — fix by granting the role

---

## Phase 3 Roadmap (Tasks 16–20)

| Task | Description | Deploy? |
|------|-------------|---------|
| **16** | **This task** — live deploy Governance + Router + automation re-registration | ✅ Base Sepolia |
| 17 | Phase 3 Coordinated Redeploy — Registry + Escrow + Staking with ERC-8004 changes (Task 13 code goes live) | ✅ Base Sepolia |
| 18 | End-to-End Testnet QA — full quest lifecycle, staking, governance proposal, automation execution | ✅ Live tx |
| 19 | Whitepaper v2 + Docs Update — reflect Phase 2+3 features, automation architecture, ERC-8004 | Code only |
| 20 | Mainnet Prep — audit checklist finalization, gas optimization review, deployment runbook | Code only |
