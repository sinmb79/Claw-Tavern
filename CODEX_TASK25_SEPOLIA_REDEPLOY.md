# Task 25 — Base Sepolia Full Redeployment + Smoke Test

> References: `deploy/07_phase3_redeploy.ts`, `deploy/08_mainnet_deploy.ts`
> Difficulty: Medium (deploy script execution + verification + smoke test)
> Prerequisite: Task 24 complete, all tests passing

---

## Objective

Perform a clean Base Sepolia redeployment reflecting all changes from Tasks 22–24:
1. Deploy all 8 contracts with updated constructors and logic
2. Wire all roles (MINTER, KEEPER, ADMIN, GOVERNANCE, ARBITER, SLASHER, REFRESHER)
3. Verify all contracts on BaseScan Sepolia
4. Execute an end-to-end smoke test on-chain
5. Update deployment manifest and documentation

---

## Pre-flight Checks

Before deploying, verify locally:
```bash
npx hardhat compile
npx hardhat test          # all pass
node scripts/run-forge.js # fuzz pass
npx tsc --noEmit          # clean
```

Ensure `.env` has:
```
BASE_SEPOLIA_RPC_URL=<your Base Sepolia RPC>
DEPLOYER_PRIVATE_KEY=<deployer private key>
BASESCAN_API_KEY=<BaseScan API key>
BASE_SEPOLIA_USDC=<MockUSDC or real USDC address>
BASE_SEPOLIA_ETH_USD_FEED=<Chainlink ETH/USD feed on Base Sepolia>
```

---

## Step 1: Deploy Script Update

### 1-A. Update `deploy/07_phase3_redeploy.ts`

Ensure the deploy script reflects all Task 22–24 contract changes:

**TavernToken:**
- No constructor args (zero-arg constructor)

**TavernRegistry:**
- Constructor: `(address guildToken)`
- Post-deploy: `grantRole(MINTER_ROLE, registry)` on TavernToken for operation mints

**TavernStaking:**
- Constructor: `(address tvrnToken, address registry)`
- Verify `slashEjection()`, `slashChallenge()` exist

**TavernEscrow:**
- Constructor: `(address usdc, address tavernToken, address registry, address ethUsdFeed, address tvrnUsdFeed)`
- Post-deploy: All existing role grants + GOVERNANCE_ROLE

**AdminPriceFeed:**
- Constructor: `(int256 initialPrice)` — use `1_000_000` ($0.01 with 8 decimals)
- Post-deploy: `setRefresher(automationRouter, true)`

**TavernGovernance:**
- Constructor: `(address tavernToken, address registry)`

**TavernAutomationRouter:**
- Constructor: `(address escrow, address registry, address priceFeed)` — 3 args
- Post-deploy: `grantRole(KEEPER_ROLE, deployer)` if not auto-granted

### 1-B. Role Wiring Matrix

After all contracts are deployed, execute these role grants:

| Target Contract | Role | Grantee |
|-----------------|------|---------|
| TavernToken | MINTER_ROLE | TavernEscrow |
| TavernToken | MINTER_ROLE | TavernRegistry (**NEW** — for operationMint) |
| TavernToken | ESCROW_ROLE | TavernEscrow |
| TavernToken | BURNER_ROLE | TavernStaking |
| TavernToken | GOVERNANCE_ROLE | TavernGovernance |
| TavernEscrow | KEEPER_ROLE | TavernAutomationRouter |
| TavernEscrow | KEEPER_ROLE | deployer |
| TavernEscrow | GOVERNANCE_ROLE | TavernGovernance |
| TavernRegistry | ARBITER_ROLE | TavernEscrow |
| TavernRegistry | KEEPER_ROLE | TavernAutomationRouter |
| TavernRegistry | KEEPER_ROLE | deployer |
| TavernStaking | SLASHER_ROLE | TavernEscrow (if applicable) |
| TavernStaking | SLASHER_ROLE | deployer |
| AdminPriceFeed | isRefresher | TavernAutomationRouter |

### 1-C. Deployment Manifest

Write deployment addresses to `deployments/baseSepolia.json`:

```json
{
  "generatedAt": "<ISO timestamp>",
  "network": { "name": "baseSepolia", "chainId": 84532 },
  "deployer": "<address>",
  "addresses": {
    "adminPriceFeed": "<address>",
    "tavernToken": "<address>",
    "tavernRegistry": "<address>",
    "tavernEscrow": "<address>",
    "tavernStaking": "<address>",
    "tavernGovernance": "<address>",
    "tavernAutomationRouter": "<address>",
    "mockUsdc": "<address or null>"
  }
}
```

---

## Step 2: Contract Verification

Verify all contracts on BaseScan Sepolia:

```bash
npx hardhat verify --network baseSepolia <TavernToken_address>
npx hardhat verify --network baseSepolia <TavernRegistry_address> <guildTokenArg>
npx hardhat verify --network baseSepolia <TavernEscrow_address> <usdc> <token> <registry> <ethFeed> <tvrnFeed>
npx hardhat verify --network baseSepolia <TavernStaking_address> <token> <registry>
npx hardhat verify --network baseSepolia <AdminPriceFeed_address> 1000000
npx hardhat verify --network baseSepolia <TavernGovernance_address> <token> <registry>
npx hardhat verify --network baseSepolia <TavernAutomationRouter_address> <escrow> <registry> <priceFeed>
```

If using the `scripts/verify-contracts.ts` helper, update it to include the new constructor args for TavernAutomationRouter (3 args).

---

## Step 3: On-Chain Smoke Test

Create `scripts/sepolia-smoke-test.ts`:

```typescript
// Smoke test sequence:
// 1. Check TavernToken: totalSupply() == 0, MAX_SUPPLY == 2.1B
// 2. Check pool remainders: questPoolRemaining, attendancePoolRemaining, clientPoolRemaining, operationPoolRemaining
// 3. AdminPriceFeed: latestRoundData() returns $0.01 and is fresh
// 4. Create a quest (USDC or ETH), fund it, accept it
// 5. Submit result, wait for auto-approve window, execute auto-approve
// 6. Verify agent received 87% × 70% currency payout
// 7. Verify TVRN was minted to agent (87% × 30% in TVRN)
// 8. Verify planning/verification agents received 5% each (if assigned)
// 9. Verify servicePool increased by attendance portion
// 10. Check maxQuestDeposit enforcement (create quest exceeding cap → expect revert)
// 11. Check settlementPaused (pause, attempt settlement → expect revert, unpause)
// 12. Check governance role: call governanceDowngradeFeeStage → expect revert (not governance)
// 13. AutomationRouter: checkUpkeep() returns PriceRefresh if feed is stale
```

Run: `npx hardhat run scripts/sepolia-smoke-test.ts --network baseSepolia`

---

## Step 4: Update Documentation

### HANDOFF_RESUME.md
- Add Task 25 entry: "Base Sepolia full redeployment with all Task 22-24 changes"
- Record all deployed contract addresses

### DEPLOY_GUIDE.md
- Update with new constructor args
- Update role wiring matrix
- Add smoke test instructions

### deployments/baseSepolia.json
- Auto-generated by deploy script

---

## Checklist

### Pre-deploy
- [ ] `npx hardhat compile` — clean
- [ ] `npx hardhat test` — all PASS
- [ ] `node scripts/run-forge.js` — fuzz PASS
- [ ] `.env` configured with Base Sepolia credentials

### Deployment
- [ ] All 8 contracts deployed (7 + MockUSDC if needed)
- [ ] All role grants executed (see matrix above)
- [ ] `AdminPriceFeed.setRefresher(router, true)` called
- [ ] Deployment manifest saved to `deployments/baseSepolia.json`

### Verification
- [ ] All contracts verified on BaseScan Sepolia
- [ ] Source code visible and matches

### Smoke Test
- [ ] Token state: totalSupply=0, MAX_SUPPLY=2.1B, 4 pools correct
- [ ] Quest lifecycle: create→fund→accept→submit→autoApprove
- [ ] Settlement: agent currency payout, TVRN mint, planning/verification shares, servicePool
- [ ] Security: maxQuestDeposit revert, settlementPaused revert
- [ ] AutomationRouter: PriceRefresh upkeep triggers correctly

### Documentation
- [ ] HANDOFF_RESUME.md updated
- [ ] DEPLOY_GUIDE.md updated
- [ ] deployments/baseSepolia.json created

---

## Notes

- **Mainnet deployment** should NOT happen until the smoke test on Sepolia is fully green and reviewed.
- After Sepolia is confirmed, a separate task will cover Base Mainnet deployment with production parameters.
- If MockUSDC is used on Sepolia, note that real USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) should be used on mainnet.
