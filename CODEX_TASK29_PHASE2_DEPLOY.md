# Task 29 — Phase 2 Contracts: Sepolia + Mainnet Incremental Deploy

> References: `deploy/09_deploy_client_rpg.ts`, `deploy/10_deploy_subscription.ts`
> Difficulty: MEDIUM — incremental deploy onto existing live system
> Prerequisite: Task 28 complete, all tests passing (81+ Hardhat, 29 Foundry)

---

## Objective

Deploy the two new Phase 2 contracts (`TavernClientRPG` and `TavernSubscription`) to both **Base Sepolia** and **Base Mainnet**, wire them into the existing live contract system, verify on BaseScan, and run smoke tests.

This is an **incremental deploy** — the 7 core contracts (Token, Registry, Escrow, Staking, Governance, AutomationRouter, AdminPriceFeed) are already live. We add 2 new contracts and wire them in.

---

## Pre-flight Checks

```bash
npx hardhat compile --force
npx hardhat test          # all pass (81+)
node scripts/run-forge.js # 29 fuzz pass
npx tsc --noEmit          # clean
```

---

## Step 1: Base Sepolia Deployment

### 1-A. Environment Variables

Ensure `.env` has existing Sepolia values plus:

```
# Existing (from Task 25)
BASE_SEPOLIA_RPC_URL=<...>
DEPLOYER_PRIVATE_KEY=<...>
BASESCAN_API_KEY=<...>

# Existing deployed addresses (from deployments/baseSepolia.json)
# The deploy scripts should read these automatically
```

### 1-B. Deploy TavernClientRPG

```bash
npx hardhat run deploy/09_deploy_client_rpg.ts --network baseSepolia
```

This should:
1. Deploy `TavernClientRPG`
2. Grant `ESCROW_ROLE` on RPG → Escrow
3. Grant `KEEPER_ROLE` on RPG → AutomationRouter
4. Call `escrow.setClientRPG(rpg)`
5. Call `router.setClientRPG(rpg)`
6. Verify on BaseScan Sepolia
7. Update `deployments/baseSepolia.json` with `tavernClientRPG` address

### 1-C. Deploy TavernSubscription

```bash
npx hardhat run deploy/10_deploy_subscription.ts --network baseSepolia
```

This should:
1. Deploy `TavernSubscription(usdc, escrow, registry)`
2. Call `subscription.setClientRPG(rpg)`
3. Grant `KEEPER_ROLE` on Subscription → AutomationRouter
4. Grant `SUBSCRIPTION_ROLE` on RPG → Subscription
5. Call `escrow.setSubscriptionContract(subscription)` (if applicable)
6. Call `router.setSubscriptionContract(subscription)`
7. Verify on BaseScan Sepolia
8. Update `deployments/baseSepolia.json` with `tavernSubscription` address

### 1-D. Sepolia Smoke Test

Run a targeted smoke test for the new contracts:

```javascript
// In Hardhat console --network baseSepolia:

// 1. RPG — register client + check level
const rpg = await ethers.getContractAt("TavernClientRPG", "<RPG_ADDRESS>");
console.log("SEASON_DURATION:", (await rpg.SEASON_DURATION()).toString());
console.log("currentSeasonNumber:", (await rpg.currentSeasonNumber()).toString());
console.log("MIN_WITHDRAWAL_LEVEL:", (await rpg.MIN_WITHDRAWAL_LEVEL()).toString());

// 2. Subscription — check config
const sub = await ethers.getContractAt("TavernSubscription", "<SUB_ADDRESS>");
console.log("SUBSCRIPTION_FEE_BPS:", (await sub.SUBSCRIPTION_FEE_BPS()).toString());
console.log("SUBSCRIPTION_PERIOD:", (await sub.SUBSCRIPTION_PERIOD()).toString());
console.log("accumulatedFees:", (await sub.accumulatedFees()).toString());

// 3. Escrow — verify RPG wiring
const escrow = await ethers.getContractAt("TavernEscrow", "<ESCROW_ADDRESS>");
console.log("clientRPG:", await escrow.clientRPG());

// 4. Router — verify new wiring
const router = await ethers.getContractAt("TavernAutomationRouter", "<ROUTER_ADDRESS>");
const [needed,] = await router.checkUpkeep("0x");
console.log("upkeepNeeded:", needed);

// 5. Create a test quest and verify EXP flow (optional E2E)
// ... use deployer as client, register, complete quest, check EXP
```

---

## Step 2: Base Mainnet Deployment

### 2-A. Pre-flight for Mainnet

1. Confirm Sepolia smoke test passed
2. Ensure deployer has ≥ 0.02 ETH on Base mainnet (2 contract deploys + role grants)
3. Set `MAINNET_CONFIRM=true` in `.env`

### 2-B. Deploy TavernClientRPG to Mainnet

```bash
npx hardhat run deploy/09_deploy_client_rpg.ts --network base
```

The deploy script must detect `--network base` and:
- Read existing mainnet addresses from `deployments/base.json`
- Deploy RPG with mainnet Token + Escrow addresses
- Wire roles using mainnet contract instances
- Verify on BaseScan (mainnet)
- Update `deployments/base.json`

### 2-C. Deploy TavernSubscription to Mainnet

```bash
npx hardhat run deploy/10_deploy_subscription.ts --network base
```

Same pattern — read mainnet addresses, deploy, wire, verify, update manifest.

### 2-D. Mainnet Read-Only Smoke Test

```javascript
// Same checks as Sepolia but on mainnet
// Do NOT create real quests or subscriptions during smoke test
// Verify: RPG constants, Subscription constants, Escrow wiring, Router wiring
```

### 2-E. Chainlink Automation Update

The existing mainnet upkeep should automatically pick up the new TaskTypes (SeasonReset, SubscriptionExpiry) since the Router contract address hasn't changed — only its internal state was updated via setter calls.

Verify with:
```bash
npx hardhat console --network base
> const router = await ethers.getContractAt("TavernAutomationRouter", "<ROUTER>")
> console.log("clientRPG:", await router.clientRPG())
> console.log("subscriptionContract:", await router.subscriptionContract())
> const [needed,] = await router.checkUpkeep("0x")
> console.log("upkeepNeeded:", needed)
```

---

## Step 3: Deploy Script Requirements

### 3-A. `deploy/09_deploy_client_rpg.ts` Must Support Both Networks

```typescript
// Detect network
const network = await ethers.provider.getNetwork();
const isMainnet = network.chainId === 8453n;
const isSepolia = network.chainId === 84532n;

// Load correct manifest
const manifestPath = isMainnet
  ? "deployments/base.json"
  : "deployments/baseSepolia.json";

// Read existing addresses from manifest
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const escrowAddress = manifest.addresses.tavernEscrow;
const tokenAddress = manifest.addresses.tavernToken;
const routerAddress = manifest.addresses.tavernAutomationRouter;

// Mainnet safety check
if (isMainnet) {
  if (!flagEnabled(process.env.MAINNET_CONFIRM)) {
    throw new Error("Set MAINNET_CONFIRM=true for mainnet deploy");
  }
}
```

### 3-B. `deploy/10_deploy_subscription.ts` Same Pattern

Read manifest → get USDC + Escrow + Registry + RPG addresses → deploy → wire → verify → update manifest.

### 3-C. Manifest Update Format

Add to existing `baseSepolia.json` / `base.json`:

```json
{
  "addresses": {
    "...existing...",
    "tavernClientRPG": "<address>",
    "tavernSubscription": "<address>"
  },
  "phase2Deploy": {
    "executedAt": "<ISO timestamp>",
    "transactionHashes": {
      "clientRPGDeploy": "<hash>",
      "subscriptionDeploy": "<hash>",
      "escrowSetClientRPG": "<hash>",
      "escrowSetSubscription": "<hash>",
      "routerSetClientRPG": "<hash>",
      "routerSetSubscription": "<hash>",
      "rpgEscrowRoleGrant": "<hash>",
      "rpgKeeperRoleGrant": "<hash>",
      "rpgSubscriptionRoleGrant": "<hash>",
      "subscriptionKeeperRoleGrant": "<hash>"
    },
    "verification": {
      "tavernClientRPG": true,
      "tavernSubscription": true
    }
  }
}
```

---

## Step 4: Documentation Updates

### 4-A. Update `deployments/baseSepolia.json`

Auto-updated by deploy scripts. Verify new addresses present.

### 4-B. Update `deployments/base.json`

Auto-updated by deploy scripts. Verify new addresses present.

### 4-C. Update `DEPLOY_GUIDE.md`

Add Phase 2 section:
- TavernClientRPG address (Sepolia + Mainnet)
- TavernSubscription address (Sepolia + Mainnet)
- Role wiring for new contracts
- Phase 2 deploy commands

### 4-D. Update `HANDOFF_RESUME.md`

Add Task 29 entry:
```
## Task 29 — Phase 2 Sepolia + Mainnet Deploy
- Status: COMPLETE
- TavernClientRPG deployed to Sepolia + Mainnet
- TavernSubscription deployed to Sepolia + Mainnet
- All roles wired, contracts verified
- Smoke tests passed on both networks
```

### 4-E. Update `GAP_ANALYSIS_MASTER_VS_CODE.md`

Final update — both M6 and M8 should show as RESOLVED with live deployment status.

### 4-F. Update `claw-tavern-app.html` (optional)

Add Phase 2 contract addresses to the frontend if applicable.

---

## Completion Checklist

```
[ ] Pre-flight: compile, test, fuzz, tsc — all clean
[ ] --- SEPOLIA ---
[ ] deploy/09_deploy_client_rpg.ts runs on baseSepolia
[ ] TavernClientRPG deployed + verified on Sepolia
[ ] RPG roles wired (ESCROW_ROLE, KEEPER_ROLE)
[ ] Escrow.setClientRPG() called
[ ] Router.setClientRPG() called
[ ] deploy/10_deploy_subscription.ts runs on baseSepolia
[ ] TavernSubscription deployed + verified on Sepolia
[ ] Subscription roles wired (KEEPER_ROLE, SUBSCRIPTION_ROLE on RPG)
[ ] Escrow.setSubscriptionContract() called (if applicable)
[ ] Router.setSubscriptionContract() called
[ ] baseSepolia.json updated with 2 new addresses
[ ] Sepolia smoke test passed
[ ] --- MAINNET ---
[ ] deploy/09_deploy_client_rpg.ts runs on base (mainnet)
[ ] TavernClientRPG deployed + verified on mainnet BaseScan
[ ] RPG roles wired on mainnet
[ ] deploy/10_deploy_subscription.ts runs on base (mainnet)
[ ] TavernSubscription deployed + verified on mainnet BaseScan
[ ] Subscription roles wired on mainnet
[ ] base.json updated with 2 new addresses + phase2Deploy block
[ ] Mainnet read-only smoke test passed
[ ] Chainlink Automation picks up new TaskTypes
[ ] --- DOCS ---
[ ] DEPLOY_GUIDE.md updated
[ ] HANDOFF_RESUME.md updated
[ ] GAP_ANALYSIS M6+M8 → RESOLVED (live)
```

---

## Rollback Plan

If a Phase 2 contract has issues after mainnet deploy:
1. `escrow.setClientRPG(address(0))` — disables RPG checks, client rewards go back to direct transfer mode
2. `router.setClientRPG(address(0))` — disables SeasonReset automation
3. `router.setSubscriptionContract(address(0))` — disables SubscriptionExpiry automation
4. The 7 core contracts continue to function independently
