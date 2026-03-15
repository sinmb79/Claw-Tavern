# Task 17 — Phase 3 Coordinated Redeploy (Registry + Escrow + Staking)

> Codex execution instruction. This task DOES deploy to Base Sepolia.
> Full coordinated redeploy — three new contracts, re-wire everything, re-register automation.

---

## Goal

Deploy new `TavernRegistry`, `TavernEscrow`, and `TavernStaking` to Base Sepolia so the ERC-8004 integration code from Task 13 goes live. Then re-wire all dependent contracts (Governance, AutomationRouter) and re-register Chainlink automation against the new addresses.

**Why redeploy?** Registry and Escrow are not proxied. The Task 13 ERC-8004 changes (dual-path registration, identity linking, reputation mirroring, `erc8004Required` flag) exist only in local source — the live contracts don't have this code.

**What is reused?** `TavernToken` at `0x3b63deb3632b2484bAb6069281f08642ab112b16` — always reused to preserve balances.

---

## Pre-Deploy State (Current Live)

| Contract | Address |
|----------|---------|
| TavernToken | `0x3b63deb3632b2484bAb6069281f08642ab112b16` |
| TavernRegistry | `0x7f4fd10f1F0F847a68855f364a1C09cBF2831D33` |
| TavernEscrow | `0x1528580Db5fDfbaC2fe9d364D9De402490032ccD` |
| TavernStaking | `0x3cBa5c92f8fB5b00B230c37eE32c93B5971DBEa8` |
| TavernGovernance | `0xEC44F23Ee765FA4e2648D36074E9C90F2FFc39ec` |
| TavernAutomationRouter | `0x410575336467F8B0Fb338bce68Ab4638f7bf26Ee` |

---

## Execution Order

```
Step 1:  Create deploy/07_phase3_redeploy.ts
Step 2:  Deploy new TavernRegistry
Step 3:  Deploy new TavernEscrow
Step 4:  Deploy new TavernStaking
Step 5:  Wire roles (Token → Escrow, Token → Staking, Registry → Escrow)
Step 6:  setStakingContract on new Registry
Step 7:  Deploy new TavernGovernance (points to new Token + new Registry)
Step 8:  Deploy new TavernAutomationRouter (points to new Escrow + new Registry)
Step 9:  Grant KEEPER_ROLE to new Router on new Escrow + new Registry
Step 10: Re-register automation (single router upkeep targeting new Router)
Step 11: Grant KEEPER_ROLE to forwarder on new Router
Step 12: Update manifests + frontend
Step 13: Verify all new contracts on Basescan
Step 14: Validation checks
```

---

## Step 1 — Create `deploy/07_phase3_redeploy.ts`

Create a new deploy script modeled on `deploy/04_phase2_redeploy.ts` but extended for Phase 3. Key differences from 04:

1. **Redeploys 5 contracts** (Registry, Escrow, Staking, Governance, AutomationRouter) instead of 3
2. **Records old addresses** for all 5 as legacy/superseded
3. **Supports resume env vars** for all 5:
   - `PHASE3_REUSE_REGISTRY_ADDRESS` / `PHASE3_REUSE_REGISTRY_TX_HASH`
   - `PHASE3_REUSE_ESCROW_ADDRESS` / `PHASE3_REUSE_ESCROW_TX_HASH`
   - `PHASE3_REUSE_STAKING_ADDRESS` / `PHASE3_REUSE_STAKING_TX_HASH`
   - `PHASE3_REUSE_GOVERNANCE_ADDRESS` / `PHASE3_REUSE_GOVERNANCE_TX_HASH`
   - `PHASE3_REUSE_ROUTER_ADDRESS` / `PHASE3_REUSE_ROUTER_TX_HASH`

### Script Structure

```typescript
async function main() {
  // 1. Read existing manifest
  // 2. Capture old addresses for legacy record

  // 3. Deploy or reuse TavernRegistry(tokenAddress)
  //    - assertPhase2RegistrySelectors() — verify stakingContract() exists
  //    - Also verify ERC-8004 selectors: erc8004IdentityRegistry(), erc8004Required()

  // 4. Deploy or reuse TavernEscrow(usdc, tokenAddress, newRegistryAddress, ethUsdFeed, tvrnUsdFeed)
  //    - Verify getAutomationQuestView() selector exists
  //    - Verify mirrorERC8004Reputation call path exists in _notifyRegistryReputation

  // 5. Deploy or reuse TavernStaking(tokenAddress, newRegistryAddress)

  // 6. Role grants on TavernToken:
  //    - MINTER_ROLE → newEscrow
  //    - ESCROW_ROLE → newEscrow
  //    - BURNER_ROLE → newStaking

  // 7. Role grants on new TavernRegistry:
  //    - ARBITER_ROLE → deployer
  //    - ARBITER_ROLE → newEscrow
  //    - KEEPER_ROLE → deployer

  // 8. setStakingContract(newStakingAddress) on new Registry

  // 9. Deploy or reuse TavernGovernance(tokenAddress, newRegistryAddress)
  //    - Constructor: TavernGovernance(TavernToken, TavernRegistry)

  // 10. Deploy or reuse TavernAutomationRouter(newEscrowAddress, newRegistryAddress)
  //     - Constructor: TavernAutomationRouter(TavernEscrow, TavernRegistry)

  // 11. Grant KEEPER_ROLE to new Router on new Escrow + new Registry

  // 12. Update manifest (baseSepolia.json)
  //     - All 5 addresses updated
  //     - All constructorArgs updated
  //     - Legacy record added for old Phase 2 + Phase 3 addresses
  //     - phase3Redeploy section with all tx hashes

  // 13. Update frontend (claw-tavern-app.html)
  //     - Replace all old addresses with new ones
  //     - Replace shortened addresses in Basescan links

  // 14. Verify all 5 contracts on Basescan
}
```

### Constructor Arguments Reference

```typescript
// Registry
const newRegistry = await TavernRegistry.deploy(tokenAddress);

// Escrow
const newEscrow = await TavernEscrow.deploy(
  usdc,           // 0x036CbD53842c5426634e7929541eC2318f3dCF7e
  tokenAddress,   // 0x3b63deb3632b2484bAb6069281f08642ab112b16
  newRegistryAddress,
  ethUsdFeed,     // 0x4aDC67d868Ac7a395922e35C834E3BFa52e3f9c0
  tvrnUsdFeed     // 0x0000000000000000000000000000000000000000
);

// Staking
const newStaking = await TavernStaking.deploy(tokenAddress, newRegistryAddress);

// Governance
const newGovernance = await TavernGovernance.deploy(tokenAddress, newRegistryAddress);

// AutomationRouter
const newRouter = await TavernAutomationRouter.deploy(newEscrowAddress, newRegistryAddress);
```

### Role Grants (complete list)

```typescript
const MINTER_ROLE = await token.MINTER_ROLE();
const ESCROW_ROLE = await token.ESCROW_ROLE();
const BURNER_ROLE = await token.BURNER_ROLE();
const ARBITER_ROLE = await newRegistry.ARBITER_ROLE();
const KEEPER_ROLE = await newRegistry.KEEPER_ROLE();

// Token roles for new Escrow
await ensureRole(token, "TavernToken", MINTER_ROLE, newEscrowAddress);
await ensureRole(token, "TavernToken", ESCROW_ROLE, newEscrowAddress);

// Token roles for new Staking
await ensureRole(token, "TavernToken", BURNER_ROLE, newStakingAddress);

// Registry roles
await ensureRole(newRegistry, "TavernRegistry", ARBITER_ROLE, deployer.address);
await ensureRole(newRegistry, "TavernRegistry", ARBITER_ROLE, newEscrowAddress);
await ensureRole(newRegistry, "TavernRegistry", KEEPER_ROLE, deployer.address);

// Router KEEPER_ROLE on Escrow + Registry
await ensureRole(newRegistry, "TavernRegistry", KEEPER_ROLE, newRouterAddress);
await ensureRole(newEscrow, "TavernEscrow", KEEPER_ROLE, newRouterAddress);

// setStakingContract
const setStakingTx = await newRegistry.setStakingContract(newStakingAddress);
await setStakingTx.wait();
```

**Note**: Do NOT grant KEEPER_ROLE for old forwarders on the new contracts. The old forwarders will be superseded. A new forwarder will be discovered during automation re-registration in Step 10.

### Frontend Update

Replace **all** of these old addresses with their new counterparts throughout `claw-tavern-app.html`:

| Contract | Old Address | Replace with |
|----------|------------|--------------|
| TavernRegistry | `0x7f4fd10f1F0F847a68855f364a1C09cBF2831D33` | `<new>` |
| TavernEscrow | `0x1528580Db5fDfbaC2fe9d364D9De402490032ccD` | `<new>` |
| TavernStaking | `0x3cBa5c92f8fB5b00B230c37eE32c93B5971DBEa8` | `<new>` |
| TavernGovernance | `0xEC44F23Ee765FA4e2648D36074E9C90F2FFc39ec` | `<new>` |
| TavernAutomationRouter | `0x410575336467F8B0Fb338bce68Ab4638f7bf26Ee` | `<new>` |

Also replace shortened address forms (e.g. `0x7f4f...D33`) in Basescan link text.

### Manifest Update

The `baseSepolia.json` must contain:
- All 6 addresses (`tavernToken` unchanged, other 5 updated)
- Updated `constructorArgs` for all 5 redeployed contracts
- A `phase3Redeploy` section with:
  - `executedAt` timestamp
  - tx hashes for all 5 deploys + `setStakingContract`
  - verification status for all 5
- Legacy record capturing the old Phase 2/3 addresses being superseded

---

## Step 2 — Automation Re-registration

After the deploy script completes, run:

```bash
npx hardhat run scripts/register-automation.ts --network baseSepolia
```

This must:
1. Read `deployments/baseSepolia.json` to find the **new** `tavernAutomationRouter` address
2. Register a single native upkeep targeting the new router
3. Discover the new forwarder address
4. Grant `KEEPER_ROLE` to the new forwarder on the new `TavernAutomationRouter`
5. Update `deployments/baseSepolia.automation.json`

**Important**: The `register-automation.ts` script reads the router address from the manifest. Since `deploy/07_phase3_redeploy.ts` updates the manifest with the new router address before this step, the script will automatically target the new router.

If `register-automation.ts` detects the old upkeep targeting the old router, it should register a new upkeep (not skip). The target address mismatch is sufficient reason to re-register.

---

## Step 3 — Validation Checks

### 3.1 On-chain State

```
New TavernRegistry:
  - guildToken() == 0x3b63deb3632b2484bAb6069281f08642ab112b16
  - stakingContract() == <newStakingAddress>
  - guildCount() >= 5 (founding guilds)
  - erc8004IdentityRegistry() == address(0) (not configured yet)
  - erc8004Required() == false
  - hasRole(ARBITER_ROLE, <newEscrowAddress>) == true
  - hasRole(KEEPER_ROLE, <newRouterAddress>) == true

New TavernEscrow:
  - usdc() == 0x036CbD53842c5426634e7929541eC2318f3dCF7e
  - tavernToken() == 0x3b63deb3632b2484bAb6069281f08642ab112b16
  - registry() == <newRegistryAddress>
  - hasRole(KEEPER_ROLE, <newRouterAddress>) == true
  - getAutomationQuestView(0) reverts with "Quest not found" (no quests yet)

New TavernStaking:
  - tvrnToken() == 0x3b63deb3632b2484bAb6069281f08642ab112b16
  - registry() == <newRegistryAddress>
  - STAKE_AMOUNT() == 100e18
  - UNSTAKE_COOLDOWN() == 604800

New TavernGovernance:
  - tavernToken() returns 0x3b63deb3632b2484bAb6069281f08642ab112b16
  - quorum() returns non-zero
  - nextProposalId() == 0

New TavernAutomationRouter:
  - escrow() == <newEscrowAddress>
  - registry() == <newRegistryAddress>
  - scanBatchSize() == 50
  - quotaRebalanceInterval() == 86400
  - hasRole(KEEPER_ROLE, <newForwarderAddress>) == true

TavernToken (unchanged):
  - hasRole(MINTER_ROLE, <newEscrowAddress>) == true
  - hasRole(ESCROW_ROLE, <newEscrowAddress>) == true
  - hasRole(BURNER_ROLE, <newStakingAddress>) == true
```

### 3.2 Automation Health

```bash
npm run verify:automation
```

Should show:
- Single upkeep targeting the **new** TavernAutomationRouter
- Upkeep is active
- New forwarder has KEEPER_ROLE on the new Router

### 3.3 Frontend Spot Check

Open `claw-tavern-app.html`:
- All Basescan links point to new addresses
- CONFIG addresses match new deployments
- Quest Board tab loads (no quests on new escrow is expected)
- Staking tab connects to new staking contract
- Governance tab shows proposal form with new governance contract
- Dashboard KPI cards load

---

## Checklist

### Deploy Script

- [ ] `deploy/07_phase3_redeploy.ts` created
- [ ] Supports `PHASE3_REUSE_*` env vars for all 5 contracts
- [ ] Asserts Phase 2 + ERC-8004 selectors on new Registry
- [ ] Asserts `getAutomationQuestView()` on new Escrow

### Deployments

- [ ] New `TavernRegistry` deployed to Base Sepolia
- [ ] New `TavernEscrow` deployed to Base Sepolia
- [ ] New `TavernStaking` deployed to Base Sepolia
- [ ] New `TavernGovernance` deployed to Base Sepolia
- [ ] New `TavernAutomationRouter` deployed to Base Sepolia
- [ ] All 5 contracts verified on Basescan
- [ ] All deploy tx hashes recorded

### Roles

- [ ] Token: MINTER_ROLE → new Escrow
- [ ] Token: ESCROW_ROLE → new Escrow
- [ ] Token: BURNER_ROLE → new Staking
- [ ] Registry: ARBITER_ROLE → deployer
- [ ] Registry: ARBITER_ROLE → new Escrow
- [ ] Registry: KEEPER_ROLE → deployer
- [ ] Registry: KEEPER_ROLE → new Router
- [ ] Escrow: KEEPER_ROLE → new Router
- [ ] Router: KEEPER_ROLE → new Forwarder
- [ ] `setStakingContract(newStaking)` called on new Registry

### Automation

- [ ] `register-automation.ts` ran with router-path targeting new Router
- [ ] New upkeep registered
- [ ] New upkeep ID recorded
- [ ] New forwarder recorded
- [ ] `verify:automation` passes

### Manifests

- [ ] `deployments/baseSepolia.json` — all 5 addresses updated
- [ ] `deployments/baseSepolia.json` — `phase3Redeploy` section added
- [ ] `deployments/baseSepolia.json` — old addresses moved to `legacyAddresses`
- [ ] `deployments/baseSepolia.automation.json` — updated with new upkeep
- [ ] `claw-tavern-app.html` CONFIG — all 5 addresses replaced
- [ ] `claw-tavern-app.html` Basescan links — all 5 updated

### Tests

- [ ] `npm run compile` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run test` passes (existing tests still green)

### HANDOFF

- [ ] `HANDOFF_RESUME.md` updated:
  - Task 17 row: "Completed on Base Sepolia"
  - Live Deployment Snapshot: all 5 new addresses
  - Automation State: new upkeep + new forwarder
  - Legacy/Superseded: old Phase 2+3 addresses documented
  - "What Changed In Task 17" section added
  - ERC-8004 stub note updated to "ERC-8004 code is now live (unconfigured)"

---

## Rollback Plan

If any deploy fails mid-way:
- Use `PHASE3_REUSE_*` env vars to resume from the last successful deploy
- The old contracts remain fully operational until the manifest is overwritten
- If automation re-registration fails, the old upkeep continues targeting the old router

If the new contracts deploy but have a bug:
- Revert the manifest to the backup (script should create a timestamped backup before overwriting)
- Revert the frontend addresses
- Old contracts still work since Token roles were added (not replaced) — old Escrow still has MINTER_ROLE

---

## Important Notes

1. **Token balances are preserved** — TavernToken is never redeployed
2. **Quest history is reset** — new Escrow starts with `nextQuestId = 0`. This is expected for testnet.
3. **Staking state is reset** — any agents who staked on the old contract will need to re-stake. This is expected for testnet.
4. **Governance proposals are reset** — new Governance starts with `nextProposalId = 0`. This is expected for testnet.
5. **Old contracts are not paused** — they remain on-chain but the manifest/frontend no longer point to them
6. **Do NOT grant old forwarder addresses** on new contracts — fresh automation registration creates a new forwarder
7. **The deploy script should create a backup** of `baseSepolia.json` and `baseSepolia.automation.json` before overwriting

---

## Phase 3 Roadmap (Tasks 16–20)

| Task | Description | Deploy? |
|------|-------------|---------|
| 16 | Live deploy Governance + Router + automation re-registration | ✅ Completed |
| **17** | **This task** — coordinated redeploy Registry + Escrow + Staking + Governance + Router with ERC-8004 | ✅ Base Sepolia |
| 18 | End-to-End Testnet QA — full quest lifecycle, staking, governance proposal, automation execution | ✅ Live tx |
| 19 | Whitepaper v2 + Docs Update — reflect Phase 2+3 features, automation architecture, ERC-8004 | Code only |
| 20 | Mainnet Prep — audit checklist finalization, gas optimization review, deployment runbook | Code only |
