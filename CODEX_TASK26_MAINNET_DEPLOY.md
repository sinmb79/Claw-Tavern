# Task 26 — Base Mainnet Production Deployment

> References: `deploy/08_mainnet_deploy.ts`, `deployments/baseSepolia.json`
> Difficulty: HIGH — real funds, irreversible
> Prerequisite: Task 25 Sepolia deployment verified, all 59 tests + 29 fuzz passing

---

## Objective

Deploy the full Claw Tavern **7-contract mainnet set** to **Base Mainnet (chainId 8453)** using the existing `deploy/08_mainnet_deploy.ts` script. Wire all roles, verify on BaseScan, run a mainnet smoke test, and produce the production deployment manifest.

---

## Pre-flight Checklist

### 1-A. Local Verification

```bash
npx hardhat compile --force
npx hardhat test                # all 59 pass
node scripts/run-forge.js       # 29 fuzz pass
npx tsc --noEmit                # clean
```

### 1-B. Environment Variables (`.env`)

Set the following **before** running the script:

| Variable | Value | Notes |
|----------|-------|-------|
| `BASE_MAINNET_RPC_URL` | `https://mainnet.base.org` | Or Alchemy/Infura Base mainnet RPC |
| `DEPLOYER_PRIVATE_KEY` | `<deployer private key>` | Must have ≥ 0.05 ETH on Base mainnet |
| `BASESCAN_API_KEY` | `<BaseScan API key>` | Same key works for mainnet + Sepolia |
| `MAINNET_USDC_ADDRESS` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Official USDC on Base |
| `MAINNET_ETH_USD_FEED` | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` | Chainlink ETH/USD on Base mainnet |
| `MAINNET_TVRN_USD_FEED` | _(leave blank)_ | We deploy AdminPriceFeed |
| `MAINNET_DEPLOY_TVRN_FEED` | `true` | Deploy our own AdminPriceFeed |
| `MAINNET_KEEPER_ADDRESS` | `<deployer or dedicated keeper>` | Chainlink Automation forwarder (set deployer initially, update after upkeep registration) |
| `MAINNET_ARBITER_ADDRESS` | `<deployer address>` | Initial arbiter for appeals |
| `MAINNET_CONFIRM` | `true` | Safety flag — script refuses without this |

> **IMPORTANT**: All `MAINNET_REUSE_*` variables must be **blank** for a fresh deployment. Only populate them if resuming a partial deploy.

### 1-C. Deployer Wallet Funding

Ensure deployer wallet has sufficient ETH on Base mainnet:
- Estimated total gas: ~0.02–0.04 ETH (7 contract deploys + ~15 role grant txs + verifications)
- Recommended balance: **≥ 0.05 ETH**
- Bridge ETH from Ethereum mainnet via [bridge.base.org](https://bridge.base.org) if needed

---

## Step 2: Execute Deployment

```bash
npx hardhat run deploy/08_mainnet_deploy.ts --network base
```

The script will:
1. Validate all required env vars (USDC, ETH/USD feed, keeper, arbiter addresses)
2. Deploy AdminPriceFeed (initial price $0.01 = 1_000_000 with 8 decimals)
3. Deploy TavernToken (zero-arg constructor)
4. Deploy TavernRegistry (guildToken = TavernToken)
5. Deploy TavernEscrow (USDC, Token, Registry, ETH/USD feed, TVRN/USD feed)
6. Deploy TavernStaking (Token, Registry)
7. Deploy TavernGovernance (Token, Registry)
8. Deploy TavernAutomationRouter (Escrow, Registry, PriceFeed)
9. Wire all 11 AccessControl grants + 1 AdminPriceFeed refresher grant (see matrix below)
10. Set staking contract on Registry
11. Set AdminPriceFeed refresher for AutomationRouter
12. Verify all contracts on BaseScan
13. Write manifest to `deployments/base.json`

### Role Wiring Matrix (automated by script)

| Target Contract | Role | Grantee |
|-----------------|------|---------|
| TavernToken | MINTER_ROLE | TavernRegistry |
| TavernToken | MINTER_ROLE | TavernEscrow |
| TavernToken | ESCROW_ROLE | TavernEscrow |
| TavernToken | BURNER_ROLE | TavernStaking |
| TavernToken | GOVERNANCE_ROLE | TavernGovernance |
| TavernRegistry | ARBITER_ROLE | TavernEscrow |
| TavernRegistry | ARBITER_ROLE | arbiterAddress |
| TavernRegistry | KEEPER_ROLE | TavernAutomationRouter |
| TavernEscrow | KEEPER_ROLE | TavernAutomationRouter |
| TavernEscrow | GOVERNANCE_ROLE | TavernGovernance |
| TavernAutomationRouter | KEEPER_ROLE | keeperAddress |
| AdminPriceFeed | isRefresher | TavernAutomationRouter |

---

## Step 3: Post-Deploy Verification

### 3-A. BaseScan Verification Check

All 7 contracts must show "Verified" on BaseScan. If any failed during the script:

```bash
npx hardhat verify --network base <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS...>
```

Constructor args reference (from `deployments/base.json` → `constructorArgs`):

| Contract | Args |
|----------|------|
| AdminPriceFeed | `1000000` |
| TavernToken | _(none)_ |
| TavernRegistry | `<TavernToken address>` |
| TavernEscrow | `<USDC> <Token> <Registry> <ETH/USD feed> <TVRN/USD feed>` |
| TavernStaking | `<Token> <Registry>` |
| TavernGovernance | `<Token> <Registry>` |
| TavernAutomationRouter | `<Escrow> <Registry> <PriceFeed>` |

### 3-B. Role Verification (manual spot-check on BaseScan)

For each contract, go to BaseScan → Read Contract → `hasRole()`:
1. TavernToken: `MINTER_ROLE` → Registry ✓, Escrow ✓
2. TavernToken: `GOVERNANCE_ROLE` → Governance ✓
3. TavernEscrow: `KEEPER_ROLE` → AutomationRouter ✓
4. TavernEscrow: `GOVERNANCE_ROLE` → Governance ✓
5. TavernRegistry: `ARBITER_ROLE` → Escrow ✓
6. AdminPriceFeed: `isRefresher(router)` → true ✓

### 3-C. Contract State Verification (BaseScan Read)

| Contract | Function | Expected |
|----------|----------|----------|
| TavernToken | `MAX_SUPPLY()` | `2100000000000000000000000000` (2.1B × 1e18) |
| TavernToken | `totalSupply()` | `0` (no mints yet) |
| TavernEscrow | `maxQuestDeposit()` | `100000000000000000000` (100 ETH) |
| TavernEscrow | `maxQuestDepositUsdc()` | `100000000000` (100,000 USDC × 1e6) |
| TavernEscrow | `settlementPaused()` | `false` |
| TavernEscrow | `currentFeeStage()` | `0` |
| TavernStaking | `BOND_AMOUNT()` | `100000000000000000000` (100 TVRN) |
| TavernStaking | `SLASH_EJECTION_BPS()` | `5000` |
| TavernStaking | `SLASH_CHALLENGE_BPS()` | `1000` |
| AdminPriceFeed | `latestRoundData()` | price = `1000000` ($0.01) |
| TavernRegistry | `stakingContract()` | TavernStaking address |

---

## Step 4: Chainlink Automation Registration

### 4-A. Register Upkeep

1. Go to [automation.chain.link](https://automation.chain.link/)
2. Connect deployer wallet → Switch to **Base Mainnet**
3. "Register new Upkeep" → Custom logic
4. Target contract: `TavernAutomationRouter` address
5. Name: `ClavTavern-MainnetKeeper`
6. Gas limit: `500000`
7. Fund with **2–5 LINK** on Base mainnet
   - LINK on Base: `0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196` (verify this address on BaseScan before funding)

### 4-B. Update Keeper Address

After upkeep registration, Chainlink assigns a **forwarder address**. Update:

```bash
# Grant KEEPER_ROLE to the Chainlink forwarder on AutomationRouter
# (run via Hardhat console or a small script)
npx hardhat console --network base
> const router = await ethers.getContractAt("TavernAutomationRouter", "<ROUTER_ADDRESS>")
> const KEEPER_ROLE = await router.KEEPER_ROLE()
> await router.grantRole(KEEPER_ROLE, "<FORWARDER_ADDRESS>")
```

### 4-C. AdminPriceFeed Initial Refresh

The AdminPriceFeed starts with stale timestamp. Refresh immediately:

```bash
npx hardhat console --network base
> const feed = await ethers.getContractAt("AdminPriceFeed", "<FEED_ADDRESS>")
> await feed.refreshPrice()
```

---

## Step 5: Mainnet Smoke Test (Read-Only)

Do NOT create real quests on mainnet during smoke test. Instead verify read-only:

```bash
npx hardhat console --network base
```

```javascript
// 1. Token basics
const token = await ethers.getContractAt("TavernToken", "<TOKEN_ADDRESS>")
console.log("MAX_SUPPLY:", (await token.MAX_SUPPLY()).toString())
console.log("totalSupply:", (await token.totalSupply()).toString())

// 2. Registry
const registry = await ethers.getContractAt("TavernRegistry", "<REGISTRY_ADDRESS>")
console.log("stakingContract:", await registry.stakingContract())

// 3. Escrow
const escrow = await ethers.getContractAt("TavernEscrow", "<ESCROW_ADDRESS>")
console.log("maxQuestDeposit:", (await escrow.maxQuestDeposit()).toString())
console.log("settlementPaused:", await escrow.settlementPaused())
console.log("currentFeeStage:", (await escrow.currentFeeStage()).toString())

// 4. Staking
const staking = await ethers.getContractAt("TavernStaking", "<STAKING_ADDRESS>")
console.log("BOND_AMOUNT:", (await staking.BOND_AMOUNT()).toString())

// 5. Governance
const gov = await ethers.getContractAt("TavernGovernance", "<GOVERNANCE_ADDRESS>")
console.log("VOTING_PERIOD:", (await gov.VOTING_PERIOD()).toString())

// 6. Price feed
const feed = await ethers.getContractAt("AdminPriceFeed", "<FEED_ADDRESS>")
const [,price,,updatedAt,] = await feed.latestRoundData()
console.log("TVRN/USD price:", price.toString())
console.log("updatedAt:", updatedAt.toString())

// 7. Automation router
const router = await ethers.getContractAt("TavernAutomationRouter", "<ROUTER_ADDRESS>")
const [needed,] = await router.checkUpkeep("0x")
console.log("upkeepNeeded:", needed)
```

All values should match Step 3-C table.

---

## Step 6: Update Documentation

### 6-A. Update `deployments/base.json`

The script auto-generates this. Verify it contains all 7 contract addresses + role grants + tx hashes.

### 6-B. Update `DEPLOY_GUIDE.md`

Add Base Mainnet section with:
- All contract addresses
- Chainlink Automation upkeep ID + forwarder
- Deployment date and deployer address
- `adminPriceFeedRefresherSet` tx hash from `deployments/base.json`

### 6-C. Update `HANDOFF_RESUME.md`

Add Task 26 entry:
```
## Task 26 — Base Mainnet Deployment
- Status: COMPLETE
- Date: <date>
- All 7 contracts deployed and verified on BaseScan
- Chainlink Automation registered
- Read-only smoke test passed
```

### 6-D. Update `claw-tavern-app.html`

Add a network switcher or mainnet contract addresses section (optional — can defer to Phase 2 frontend work).

---

## Completion Checklist

```
[ ] Pre-flight: compile, test (59), fuzz (29), tsc clean
[ ] .env configured with all MAINNET_* variables
[ ] Deployer wallet has ≥ 0.05 ETH on Base mainnet
[ ] deploy/08_mainnet_deploy.ts executed successfully
[ ] All 7 contracts deployed (addresses in base.json)
[ ] All roles wired (12 role grants)
[ ] AdminPriceFeed refresher set for router
[ ] Registry stakingContract set
[ ] All 7 contracts verified on BaseScan
[ ] Chainlink Automation upkeep registered + funded
[ ] Forwarder KEEPER_ROLE granted on router
[ ] AdminPriceFeed refreshPrice() called
[ ] Read-only smoke test passed (7 checks)
[ ] deployments/base.json written with full manifest
[ ] DEPLOY_GUIDE.md updated with mainnet addresses
[ ] HANDOFF_RESUME.md updated with Task 26
```

---

## Recovery: Partial Deploy

If the script fails midway, populate `MAINNET_REUSE_*` env vars with already-deployed addresses:

```
MAINNET_REUSE_TOKEN_ADDRESS=<if already deployed>
MAINNET_REUSE_TOKEN_TX_HASH=<tx hash>
MAINNET_REUSE_REGISTRY_ADDRESS=<if already deployed>
... etc
```

Then re-run the script. It will skip already-deployed contracts and continue from where it left off.

---

## Security Notes

1. **Double-check MAINNET_USDC_ADDRESS** — must be `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (official Circle USDC on Base)
2. **Double-check MAINNET_ETH_USD_FEED** — must be `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` (Chainlink ETH/USD on Base)
3. **Never commit `.env` with private keys**
4. **AdminPriceFeed owner** = deployer. Only the owner can call `updatePrice()`. The automation router can only call `refreshPrice()` (same price, new timestamp).
5. After deployment, consider transferring `DEFAULT_ADMIN_ROLE` on critical contracts to a multisig for production security.
