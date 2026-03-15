# Task 29 — Full 9-Contract Redeployment (Sepolia + Mainnet)

> References: `deploy/07_phase3_redeploy.ts`, `deploy/08_mainnet_deploy.ts`, `deploy/09_deploy_client_rpg.ts`, `deploy/10_deploy_subscription.ts`
> Difficulty: HIGH — full replacement of all live contracts
> Prerequisite: Task 28-A complete, 98 tests + 29 fuzz passing

---

## Context

The current on-chain `TavernEscrow` and `TavernAutomationRouter` (deployed in Tasks 25/26) do **not** have the `setClientRPG()` or `setSubscriptionContract()` setter functions added in Tasks 27–28. Incremental Phase 2 deploy is therefore impossible.

**Solution:** Full redeployment of all 9 contracts on both Sepolia and Mainnet, replacing the old 7-contract set with the updated 9-contract system.

**Partial Sepolia artifact from failed Task 29 attempt:**
- `TavernClientRPG` at `0x8A50aeFe907D5268d13ab89748750c9ff6446dC5` — ignore this, will be replaced.

---

## Pre-flight Checks

```bash
npx hardhat compile --force
npx hardhat test          # 98 passing
node scripts/run-forge.js # 29 fuzz passing
npx tsc --noEmit          # clean
```

---

## Step 1: Update Deploy Scripts

### 1-A. Merge Phase 2 into Core Deploy Scripts

The existing `deploy/07_phase3_redeploy.ts` (Sepolia) and `deploy/08_mainnet_deploy.ts` (Mainnet) must be updated to deploy **all 9 contracts** in a single run:

**Deploy order (9 contracts):**
1. AdminPriceFeed
2. TavernToken
3. TavernRegistry
4. TavernEscrow (with updated bytecode including `setClientRPG`, `setSubscriptionContract`, `clientWithdrawTVRN`)
5. TavernStaking
6. TavernGovernance
7. TavernAutomationRouter (with updated bytecode including `setClientRPG`, `setSubscriptionContract`, `SeasonReset`, `SubscriptionExpiry`)
8. TavernClientRPG (NEW)
9. TavernSubscription (NEW)

### 1-B. Update `deploy/07_phase3_redeploy.ts` (Sepolia)

After deploying all 9 contracts, wire everything in this order:

**Phase 1 role wiring (existing):**

| Target | Role | Grantee |
|--------|------|---------|
| TavernToken | MINTER_ROLE | TavernEscrow |
| TavernToken | MINTER_ROLE | TavernRegistry |
| TavernToken | ESCROW_ROLE | TavernEscrow |
| TavernToken | BURNER_ROLE | TavernStaking |
| TavernToken | GOVERNANCE_ROLE | TavernGovernance |
| TavernRegistry | ARBITER_ROLE | TavernEscrow |
| TavernRegistry | ARBITER_ROLE | arbiterAddress |
| TavernRegistry | KEEPER_ROLE | TavernAutomationRouter |
| TavernRegistry | KEEPER_ROLE | deployer |
| TavernEscrow | KEEPER_ROLE | TavernAutomationRouter |
| TavernEscrow | KEEPER_ROLE | deployer |
| TavernEscrow | GOVERNANCE_ROLE | TavernGovernance |
| TavernStaking | SLASHER_ROLE | TavernEscrow |
| TavernStaking | SLASHER_ROLE | deployer |
| TavernAutomationRouter | KEEPER_ROLE | keeperAddress |
| AdminPriceFeed | isRefresher | TavernAutomationRouter |
| TavernRegistry | stakingContract | TavernStaking |

**Phase 2 wiring (NEW):**

| Target | Action | Grantee/Value |
|--------|--------|---------------|
| TavernClientRPG | ESCROW_ROLE | TavernEscrow |
| TavernClientRPG | KEEPER_ROLE | TavernAutomationRouter |
| TavernClientRPG | SUBSCRIPTION_ROLE | TavernSubscription |
| TavernEscrow | setClientRPG() | TavernClientRPG address |
| TavernAutomationRouter | setClientRPG() | TavernClientRPG address |
| TavernSubscription | setClientRPG() | TavernClientRPG address |
| TavernSubscription | KEEPER_ROLE | TavernAutomationRouter |
| TavernEscrow | setSubscriptionContract() | TavernSubscription address (if applicable) |
| TavernAutomationRouter | setSubscriptionContract() | TavernSubscription address |

### 1-C. Update `deploy/08_mainnet_deploy.ts` (Mainnet)

Same 9-contract deploy + wiring as above. Additional requirements:
- `MAINNET_CONFIRM=true` safety check
- `MAINNET_OPERATOR_WALLET` env var for TavernSubscription's operatorWallet
- All `MAINNET_REUSE_*` env vars must be **blank** for full redeploy
- Add new reuse vars: `MAINNET_REUSE_CLIENT_RPG_ADDRESS`, `MAINNET_REUSE_SUBSCRIPTION_ADDRESS`

### 1-D. Constructor Args (New Contracts)

| Contract | Constructor Args |
|----------|-----------------|
| TavernClientRPG | `(address tavernToken, address escrow)` |
| TavernSubscription | `(address usdc, address escrow, address registry)` |

After deploy, call setters:
- `subscription.setClientRPG(rpg.address)`
- `subscription.setOperatorWallet(operatorWallet)` (from env var or deployer)

### 1-E. `.env.example` Updates

Add:
```
# Phase 2 — Subscription
OPERATOR_WALLET=<address for 5% subscription fee>
# Leave blank for deployer address as default

# Phase 2 — Reuse (for partial deploy recovery)
MAINNET_REUSE_CLIENT_RPG_ADDRESS=
MAINNET_REUSE_CLIENT_RPG_TX_HASH=
MAINNET_REUSE_SUBSCRIPTION_ADDRESS=
MAINNET_REUSE_SUBSCRIPTION_TX_HASH=
```

---

## Step 2: Base Sepolia Full Redeployment

### 2-A. Clear Reuse Variables

Ensure all `SEPOLIA_REUSE_*` or equivalent variables are blank.

### 2-B. Execute

```bash
npx hardhat run deploy/07_phase3_redeploy.ts --network baseSepolia
```

Expected output: 9 contract deploys + all role wiring + Phase 2 setter calls + verification.

### 2-C. Manifest Update

`deployments/baseSepolia.json` must now include:
```json
{
  "addresses": {
    "adminPriceFeed": "<new>",
    "tavernToken": "<new>",
    "tavernRegistry": "<new>",
    "tavernEscrow": "<new>",
    "tavernStaking": "<new>",
    "tavernGovernance": "<new>",
    "tavernAutomationRouter": "<new>",
    "tavernClientRPG": "<new>",
    "tavernSubscription": "<new>",
    "mockUsdc": "<if applicable>"
  }
}
```

### 2-D. Sepolia Automation

Register new Chainlink Automation upkeep for the new Router address (old upkeep points to old Router).

1. Cancel old upkeep (withdraw remaining LINK)
2. Register new upkeep with new Router address
3. Grant KEEPER_ROLE to new forwarder
4. Update `deployments/baseSepolia.automation.json`

### 2-E. Sepolia Smoke Test

Run `scripts/phase2-readonly-smoke.ts` (or equivalent):

```bash
npx hardhat run scripts/phase2-readonly-smoke.ts --network baseSepolia
```

Verify:
1. All 9 contracts respond to basic reads
2. RPG: SEASON_DURATION, MIN_WITHDRAWAL_LEVEL, level thresholds
3. Subscription: SUBSCRIPTION_FEE_BPS = 500, operatorWallet set
4. Escrow: clientRPG() returns RPG address
5. Router: clientRPG() + subscriptionContract() set
6. Token: MAX_SUPPLY = 2.1B, totalSupply = 0
7. Staking: BOND_AMOUNT = 100 TVRN
8. Price feed: latestRoundData returns valid price

Optional E2E (on Sepolia only):
- Register client → complete quest → check EXP + claimable TVRN
- Subscribe to agent → verify 95/5 split in same tx

---

## Step 3: Base Mainnet Full Redeployment

### 3-A. Pre-Mainnet Checklist

```
[ ] Sepolia smoke test passed
[ ] Deployer has ≥ 0.08 ETH on Base mainnet (9 deploys + ~20 role/setter txs)
[ ] .env: MAINNET_CONFIRM=true
[ ] .env: MAINNET_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
[ ] .env: MAINNET_ETH_USD_FEED=0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70
[ ] .env: MAINNET_DEPLOY_TVRN_FEED=true
[ ] .env: MAINNET_KEEPER_ADDRESS=<deployer>
[ ] .env: MAINNET_ARBITER_ADDRESS=<deployer>
[ ] .env: OPERATOR_WALLET=<deployer or dedicated wallet>
[ ] All MAINNET_REUSE_* variables blank
```

### 3-B. Execute

```bash
npx hardhat run deploy/08_mainnet_deploy.ts --network base
```

### 3-C. Mainnet Automation

1. Cancel old mainnet upkeep (withdraw LINK)
2. Register new upkeep with new Router
3. Fund with 2–5 LINK
4. Grant KEEPER_ROLE to new forwarder
5. Update `deployments/base.automation.json`

### 3-D. Mainnet Read-Only Smoke Test

Same checks as Sepolia — **do NOT create real quests or subscriptions**.

### 3-E. AdminPriceFeed Refresh

```bash
npx hardhat console --network base
> const feed = await ethers.getContractAt("AdminPriceFeed", "<NEW_FEED_ADDRESS>")
> await feed.refreshPrice()
```

---

## Step 4: Manifest & Documentation

### 4-A. Deployment Manifests

Both `deployments/baseSepolia.json` and `deployments/base.json` must contain all 9 addresses + constructorArgs + rolesGranted for Phase 2 contracts.

### 4-B. Automation Manifests

Update both `baseSepolia.automation.json` and `base.automation.json` with new upkeep IDs and forwarder addresses.

### 4-C. `DEPLOY_GUIDE.md`

- Replace all old contract addresses with new ones
- Add Phase 2 contract sections (RPG + Subscription)
- Note: old contracts are now deprecated

### 4-D. `HANDOFF_RESUME.md`

```
## Task 29 — Full 9-Contract Redeployment
- Status: COMPLETE
- Reason: On-chain Escrow/Router lacked Phase 2 setter hooks
- Sepolia: 9 contracts deployed + verified + automation re-registered
- Mainnet: 9 contracts deployed + verified + automation re-registered
- Old contracts deprecated (addresses preserved in backup manifests)
```

### 4-E. `GAP_ANALYSIS_MASTER_VS_CODE.md`

Update M6 and M8 status from "RESOLVED (local code)" to "RESOLVED (live on Sepolia + Mainnet)".

### 4-F. Backup Old Manifests

Before overwriting, copy:
```bash
cp deployments/baseSepolia.json deployments/baseSepolia.v1-backup.json
cp deployments/base.json deployments/base.v1-backup.json
cp deployments/baseSepolia.automation.json deployments/baseSepolia.automation.v1-backup.json
cp deployments/base.automation.json deployments/base.automation.v1-backup.json
```

### 4-G. `claw-tavern-app.html`

Update frontend with new 9 contract addresses.

---

## Completion Checklist

```
[ ] Pre-flight: compile, test (98), fuzz (29), tsc clean
[ ] Deploy scripts updated for 9-contract deploy + Phase 2 wiring
[ ] .env.example updated with OPERATOR_WALLET + Phase 2 reuse vars
[ ] Old manifests backed up
[ ] --- SEPOLIA ---
[ ] 9 contracts deployed on Sepolia
[ ] All roles wired (Phase 1 + Phase 2)
[ ] Phase 2 setters called (setClientRPG, setSubscriptionContract, setOperatorWallet)
[ ] All 9 contracts verified on BaseScan Sepolia
[ ] Old upkeep cancelled, new upkeep registered
[ ] Forwarder KEEPER_ROLE granted on new Router
[ ] baseSepolia.json updated with 9 addresses
[ ] baseSepolia.automation.json updated
[ ] Sepolia smoke test passed (readonly + optional E2E)
[ ] --- MAINNET ---
[ ] Deployer has ≥ 0.08 ETH on Base mainnet
[ ] 9 contracts deployed on Mainnet
[ ] All roles wired (Phase 1 + Phase 2)
[ ] Phase 2 setters called
[ ] All 9 contracts verified on BaseScan
[ ] Old upkeep cancelled, new upkeep registered + funded
[ ] Forwarder KEEPER_ROLE granted on new Router
[ ] base.json updated with 9 addresses
[ ] base.automation.json updated
[ ] AdminPriceFeed refreshPrice() called
[ ] Mainnet read-only smoke test passed
[ ] --- DOCS ---
[ ] DEPLOY_GUIDE.md updated (all new addresses)
[ ] HANDOFF_RESUME.md updated
[ ] GAP_ANALYSIS M6+M8 → RESOLVED (live)
[ ] claw-tavern-app.html updated
```

---

## Recovery: Partial Deploy

If script fails midway, populate `REUSE_*` variables for already-deployed contracts and re-run. The script skips contracts with valid reuse addresses.

---

## Important Notes

1. **Old contracts remain on-chain** but are no longer used. They hold no user funds (no real quests were created on mainnet).
2. **LINK tokens**: Withdraw from old upkeeps before cancelling. Re-fund new upkeeps.
3. **Mainnet ETH**: Budget ~0.08 ETH for 9 deploys + 20 role/setter txs + verifications.
4. **Sepolia partial artifact**: The `TavernClientRPG` at `0x8A50...` from the failed attempt is orphaned — safe to ignore.
5. **operatorWallet**: Set to deployer initially. Can be changed later via `setOperatorWallet()`.
