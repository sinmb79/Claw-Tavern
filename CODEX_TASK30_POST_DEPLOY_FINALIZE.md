# CODEX TASK 30 — Post-Deploy Finalization

**Objective**: Update all project documentation and frontend to reflect the live 9-contract v2 system on both Sepolia and Mainnet. This is the final housekeeping task before public launch.

---

## Part 1 — Verify Frontend Address Sync

The `deploy/08_mainnet_deploy.ts` script calls `updateFrontendAddresses()` which should have auto-replaced contract addresses in the frontend HTML.

### 1-A. Verify `claw-tavern-app.html`

Open the HTML file and confirm ALL 9 contract addresses match the new mainnet manifest (`deployments/base.json`):

| Contract | Expected Mainnet Address |
|---|---|
| `AdminPriceFeed` | `0xb484695F28382E9960d37728Aa724777FC252149` |
| `TavernToken` | `0x7E0185DF566269906711ada358cD816394e20447` |
| `TavernRegistry` | `0xF19Fc7b03Af2704e9a8d7D11071dE92014B9A0ac` |
| `TavernEscrow` | `0xd78000aDdd0e9eFAf597fDFE8BF47aF2b6cd53e4` |
| `TavernStaking` | `0x8593D907FC46Ea84c2d6C74E78b04565DAD8860E` |
| `TavernGovernance` | `0x46407450a1CeAB0F6BFd40e1df33D85fB1E088Ca` |
| `TavernAutomationRouter` | `0x5dfCd50a8412AebC87F97eE2fD890924643b40EC` |
| `TavernClientRPG` | `0xAAA156e23D8E89FBA9f17C3e4ff6ad42ed9fB4A3` |
| `TavernSubscription` | `0x1868c2133Cb6cB0cF993e0F877CE0B8C758050CB` |

If ANY address is stale (matches v1 addresses or is missing), manually fix it.

### 1-B. Verify ABI Coverage

Confirm the frontend includes ABI fragments for the two new contracts:
- `TavernClientRPG` — at minimum: `getClientProfile`, `currentSeason`, `checkWithdrawalEligibility`
- `TavernSubscription` — at minimum: `getSubscription`, `agentMonthlyRate`, `subscribe`

If missing, extract minimal ABI fragments from `artifacts/contracts/TavernClientRPG.sol/TavernClientRPG.json` and `artifacts/contracts/TavernSubscription.sol/TavernSubscription.json` and add them to the frontend.

### 1-C. Network Switcher

If the frontend has a Sepolia/Mainnet toggle, verify Sepolia addresses also point to the new v2 set:

| Contract | Expected Sepolia Address |
|---|---|
| `AdminPriceFeed` | `0x1E072c705Cb306BA3Dd03A5f952ecd0c82416F80` |
| `TavernToken` | `0xf57549A6207421FFbA836B12C9343B060bE9A8Ed` |
| `TavernRegistry` | `0x08a3adAfb04E03589B9D167B6FA8b2152507107B` |
| `TavernEscrow` | `0x77EDA16B3a35B5732bdc252eD127Db08fB6f273D` |
| `TavernStaking` | `0x77235E24b49936cE3D6b195E6a1c4c68F686D82A` |
| `TavernGovernance` | `0x8c653FFe2EaD67a7147D86e9a0c9617F31b95f3C` |
| `TavernAutomationRouter` | `0x77F4feFE154EB40b316421800d8D2FB8ccb99E14` |
| `TavernClientRPG` | `0x877183b139981A4e7Dd593f6223C56e28032fc7D` |
| `TavernSubscription` | `0xEDc2D80075F26399f3af2d61800bdf95DCC90AaA` |

---

## Part 2 — Update HANDOFF_RESUME.md

Replace the entire file content to reflect the final v2 state. The updated document must include:

### 2-A. Executive Summary
- All tasks (1 through 29) marked as completed
- Both Sepolia and Mainnet running 9-contract v2 system
- Remove all references to "pending", "local code only", or "incremental rollout"

### 2-B. Live Deployment Tables

**Base Sepolia v2** — all 9 contracts with new addresses:
```
AdminPriceFeed:         0x1E072c705Cb306BA3Dd03A5f952ecd0c82416F80
TavernToken:            0xf57549A6207421FFbA836B12C9343B060bE9A8Ed
TavernRegistry:         0x08a3adAfb04E03589B9D167B6FA8b2152507107B
TavernEscrow:           0x77EDA16B3a35B5732bdc252eD127Db08fB6f273D
TavernStaking:          0x77235E24b49936cE3D6b195E6a1c4c68F686D82A
TavernGovernance:       0x8c653FFe2EaD67a7147D86e9a0c9617F31b95f3C
TavernAutomationRouter: 0x77F4feFE154EB40b316421800d8D2FB8ccb99E14
TavernClientRPG:        0x877183b139981A4e7Dd593f6223C56e28032fc7D
TavernSubscription:     0xEDc2D80075F26399f3af2d61800bdf95DCC90AaA
```

Sepolia automation:
- upkeep ID: `83312993709645624957959282308901778471762172289240668344585107003540809416090`
- forwarder: `0x1cEE38e968804d4A85F7d48830dDfbbee5E081FD`

**Base Mainnet v2** — all 9 contracts with new addresses:
```
AdminPriceFeed:         0xb484695F28382E9960d37728Aa724777FC252149
TavernToken:            0x7E0185DF566269906711ada358cD816394e20447
TavernRegistry:         0xF19Fc7b03Af2704e9a8d7D11071dE92014B9A0ac
TavernEscrow:           0xd78000aDdd0e9eFAf597fDFE8BF47aF2b6cd53e4
TavernStaking:          0x8593D907FC46Ea84c2d6C74E78b04565DAD8860E
TavernGovernance:       0x46407450a1CeAB0F6BFd40e1df33D85fB1E088Ca
TavernAutomationRouter: 0x5dfCd50a8412AebC87F97eE2fD890924643b40EC
TavernClientRPG:        0xAAA156e23D8E89FBA9f17C3e4ff6ad42ed9fB4A3
TavernSubscription:     0x1868c2133Cb6cB0cF993e0F877CE0B8C758050CB
```

Mainnet automation:
- upkeep ID: `114596668028608709080117900356840846997966823030424923069414299743169274345584`
- forwarder: `0x96e175C10bD9fADa3f9dB2a499312e6b10e6d455`

Old mainnet automation (cancelled):
- old upkeep cancel tx: `0x51184cb326af867f71f85abc2ad44765ad8b431cf72420ec6a5097cc8d43c2cf`
- old LINK withdraw tx: `0x8db9a74f5bda79243e416cb4d4cdebccdee8718d5c5306d239ede282404b5af6`

### 2-C. System Architecture Summary

Brief section covering:
- 9 contracts and their roles
- Token economics (MAX_SUPPLY 2.1B, 4 pools, 0% team)
- Settlement flow (87% agent split: 70% deposit currency + 30% TVRN via oracle, 5% planning, 5% verification, 3% attendance)
- Subscription model (immediate 95/5 split, no accumulation)
- RPG system (6 levels, seasons, withdrawal gating)
- Automation (10 TaskTypes via Chainlink Keeper)

### 2-D. Validation Status
- 98 Hardhat tests + 29 fuzz tests passing
- Both networks: smoke tests passed, automation verified
- All 9 contracts verified on BaseScan / Sepolia BaseScan

### 2-E. Remove Obsolete Sections
- Remove "Sepolia Partial Artifact To Ignore" section (no longer relevant post-redeploy)
- Remove "Known Constraint Confirmed On-Chain" section (resolved by full redeploy)
- Remove "Next Execution Order" section (deployment is complete)

---

## Part 3 — Update DEPLOY_GUIDE.md

Update to reflect the final deployment state:

### 3-A. Current Deploy Scripts
Document the active scripts and their purpose:
- `deploy/07_phase3_redeploy.ts` — Base Sepolia full 9-contract deploy
- `deploy/08_mainnet_deploy.ts` — Base Mainnet full 9-contract deploy
- Mark older deploy scripts (01-06) as historical/superseded

### 3-B. Env Var Reference
Complete `.env` variable list for both networks including:
- `MAINNET_CONFIRM`, `MAINNET_USDC_ADDRESS`, `MAINNET_ETH_USD_FEED`
- `MAINNET_DEPLOY_TVRN_FEED`, `OPERATOR_WALLET`
- `MAINNET_REUSE_*` pattern (blank = fresh deploy)
- Sepolia equivalents

### 3-C. Automation Section
Document the full automation lifecycle:
- Deploy → Cancel old upkeep → Register new → Fund LINK → Grant KEEPER_ROLE → Verify
- Reference scripts: `cancel-automation-upkeeps.ts`, `register-automation.ts`, `verify-automation-health.ts`

### 3-D. Rollback Procedure
Document rollback via setter to `address(0)` and manifest restore from v1 backups.

---

## Part 4 — Update GAP_ANALYSIS_MASTER_VS_CODE.md

### 4-A. Status Update
Change header to indicate all 8 gaps (M1-M8) are now **RESOLVED and LIVE on both networks**.

### 4-B. Add Deployment Confirmation
For each gap entry (M1-M8), append a line confirming it is deployed:
```
Deployed: Sepolia v2 + Base Mainnet v2 (Task 29)
```

### 4-C. Add Future Roadmap Section
Add a new section "Post-Launch Roadmap (Not Yet Implemented)" listing:
- m1: RPG visual system (Claw3D integration — deferred)
- m2: Soul-bound NFT badges
- m3: In-app chat system
- m4: AgentAdapter framework
- m5: The Graph subgraph indexing
- m6: SubToken (subscription token)
- m7: Raid events (multi-agent cooperative quests)

---

## Part 5 — Clean Up package.json Scripts

Ensure `package.json` has clean, documented npm scripts for the final deploy flow:

```json
{
  "deploy:sepolia": "npx hardhat run deploy/07_phase3_redeploy.ts --network baseSepolia",
  "deploy:mainnet": "npx hardhat run deploy/08_mainnet_deploy.ts --network base",
  "smoke:sepolia": "npx hardhat run scripts/phase2-readonly-smoke.ts --network baseSepolia",
  "smoke:mainnet": "npx hardhat run scripts/phase2-readonly-smoke.ts --network base",
  "cancel:automation:sepolia": "npx hardhat run scripts/cancel-automation-upkeeps.ts --network baseSepolia",
  "cancel:automation:mainnet": "npx hardhat run scripts/cancel-automation-upkeeps.ts --network base",
  "verify:automation:sepolia": "npx hardhat run scripts/verify-automation-health.ts --network baseSepolia",
  "verify:automation:mainnet": "npx hardhat run scripts/verify-automation-health.ts --network base"
}
```

Remove or alias any stale script names. Ensure existing scripts are not broken.

---

## Acceptance Checklist

- [ ] `claw-tavern-app.html` contains all 9 mainnet addresses matching `deployments/base.json`
- [ ] `claw-tavern-app.html` contains ABI fragments for TavernClientRPG and TavernSubscription
- [ ] `claw-tavern-app.html` Sepolia addresses match `deployments/baseSepolia.json`
- [ ] `HANDOFF_RESUME.md` reflects final v2 state on both networks with all 9 addresses
- [ ] `HANDOFF_RESUME.md` has no references to pending/local-only work
- [ ] `DEPLOY_GUIDE.md` updated with current scripts, env vars, automation lifecycle
- [ ] `GAP_ANALYSIS_MASTER_VS_CODE.md` shows all M1-M8 as RESOLVED + LIVE
- [ ] `GAP_ANALYSIS_MASTER_VS_CODE.md` has future roadmap section
- [ ] `package.json` scripts are clean and point to correct deploy/smoke/automation files
- [ ] `npx tsc --noEmit` passes
- [ ] No stale v1 addresses appear in any documentation file
