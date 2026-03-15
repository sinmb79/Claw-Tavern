# Task 20 — Mainnet Preparation

> Codex execution instruction. This task is code-only — no live deployments.
> Prepare the entire codebase for a Base mainnet launch.

---

## Goal

The six-contract system is live and QA'd on Base Sepolia. This task closes the Phase 3 roadmap by making the codebase mainnet-ready. No mainnet deployment happens in this task — the deliverable is the tooling, configuration, analysis, and fuzz coverage that lets a confident mainnet deploy happen next.

---

## Deliverable 1 — Gas Optimization Report + Fixes

Create `GAS_OPTIMIZATION_REPORT.md` at the project root.

### Process

1. Run `npm run compile` and capture the contract sizes from the Hardhat output.
2. For each of the 6 core contracts, identify gas-heavy patterns:
   - Redundant storage reads (cache in memory instead)
   - Unchecked math where overflow is provably impossible (Solidity 0.8 auto-checks cost gas)
   - Tight-packing struct storage slots where possible
   - Short-circuiting conditionals (cheapest check first)
   - `calldata` vs `memory` for external function params
   - Event emission optimization (indexed vs non-indexed param count)
   - Dead code or unreachable branches
3. Apply safe, non-breaking gas fixes directly to the contracts.
4. Re-run `npm run compile` and record before/after contract sizes.
5. Re-run `npm run test` — all existing tests must still pass.
6. Document each change in the report with: file, line range, what changed, estimated gas impact.

### Priority Contracts (by size and call frequency)

| Contract | Lines | Priority |
|---|---:|---|
| `TavernEscrow.sol` | 1025 | HIGH — most called, largest |
| `TavernRegistry.sol` | 626 | HIGH — second largest |
| `contracts/TavernAutomationRouter.sol` | 278 | MEDIUM — called every upkeep cycle |
| `contracts/TavernGovernance.sol` | 253 | MEDIUM |
| `TavernToken.sol` | 152 | LOW — simple ERC20 |
| `TavernStaking.sol` | 114 | LOW — simple bond logic |

### Constraints

- Do NOT change any public/external function signatures.
- Do NOT change event signatures.
- Do NOT change storage layout (no slot reordering that breaks existing data).
- Do NOT remove any access control checks.
- Do NOT weaken oracle validation guards.
- All changes must be backward-compatible with the existing deployment manifest and frontend.

---

## Deliverable 2 — Expanded Fuzz Test Suite

### Existing Fuzz Tests (keep all)

- `test/fuzz/FuzzCompensation.t.sol`
- `test/fuzz/FuzzOracleEdge.t.sol`
- `test/fuzz/FuzzTransferLock.t.sol`
- `test/fuzz/FuzzQuotaHysteresis.t.sol`
- `test/fuzz/FuzzFeeStage.t.sol`
- `test/fuzz/BaseFuzz.t.sol`

### New Fuzz Tests Required

Create these new files in `test/fuzz/`:

#### `FuzzStaking.t.sol`

Target invariants from AUDIT_SCOPE.md #6 and #7:
- `stake()` must revert for any amount != `100e18`
- `isStaked()` must return `true` only when `amount >= STAKE_AMOUNT && !slashed`
- Repeated `requestUnstake()` must not reset `unstakeRequestAt` to a later time
- `withdraw()` must revert at `cooldown - 1` seconds and succeed at `cooldown + 0`
- `slash()` must burn exactly `50%` of bond (check token balance before/after)
- `slash()` must set `unstakeRequestAt` immediately
- Slash then withdraw timing interaction
- Slash before vs after `requestUnstake()`

#### `FuzzGovernance.t.sol`

Target invariants from AUDIT_SCOPE.md #8 and #9:
- `getVotingPower()` must equal `sqrt(balance)` for vanilla holders (no bonuses)
- `getVotingPower()` must equal `sqrt(balance) * 1.2` for active agents
- `getVotingPower()` must equal `sqrt(balance) * 1.5` for founding agents
- Voting power at balance `0` must be `0`
- Voting power at balance `1` must be `1` (sqrt(1) = 1)
- Voting power at very large balances (near `type(uint256).max / 2`) must not overflow
- Proposal threshold boundary: `99.999...e18 TVRN` must fail, `100e18` must pass
- Queue timing: normal proposal ETA must be `>= block.timestamp + 2 days`
- Queue timing: `EmergencyFreeze` ETA must be `<= block.timestamp`
- Vote tally with mixed active/founding/vanilla voters must sum correctly

#### `FuzzAutomation.t.sol`

Target invariants from AUDIT_SCOPE.md #10 and #11:
- Cursor wraparound with `nextQuestId = 1` (empty quest range)
- Cursor wraparound with `nextQuestId = 2` (single quest)
- Cursor at `nextQuestId - 1` must wrap to `1` on next scan
- `checkUpkeep()` return must match actual escrow quest state
- Task type priority: timeout > auto-approve > fee-stage > quota-rebalance
- `performUpkeep()` must revert without `KEEPER_ROLE`
- Stale `pendingQuotaScores` must not trigger rebalance before interval elapses

### Foundry Config

The existing `foundry.toml` is already configured:
```toml
[fuzz]
runs = 10000
```

All new fuzz tests must:
- Extend `BaseFuzz.t.sol` if it provides shared setup
- Use `vm.assume()` to constrain inputs to meaningful ranges
- Use `vm.expectRevert()` for expected failure cases
- Compile with `forge build` (Solidity 0.8.20)
- Pass with `npm run audit:fuzz`

---

## Deliverable 3 — Slither Static Analysis Pass

### Process

1. Run `npm run audit:slither` (uses existing `slither.config.json`).
2. Capture the full output.
3. Triage every finding:
   - **Fix**: apply the fix if it is a real issue (reentrancy, unchecked return, etc.)
   - **Acknowledge**: if it is a false positive or accepted design choice, document why
4. Create `SLITHER_REPORT.md` at the project root with:
   - Date, commit hash, Slither version
   - Summary table: `Critical | High | Medium | Low | Informational` counts
   - Per-finding rows: detector name, severity, file:line, status (Fixed / Acknowledged), notes
5. Re-run Slither after fixes — the report must reflect the final clean state.

### Slither Config Reference

Current `slither.config.json`:
```json
{
  "compile_force_framework": "hardhat",
  "filter_paths": "node_modules,contracts/Mock.*",
  "solc_remaps": [
    "@openzeppelin/=node_modules/@openzeppelin/",
    "@chainlink/=node_modules/@chainlink/"
  ]
}
```

Do NOT modify the filter to hide real findings. Mock contracts are already excluded.

---

## Deliverable 4 — Base Mainnet Deploy Script

Create `deploy/08_mainnet_deploy.ts`.

### Requirements

This script must deploy the same 6-contract stack to Base mainnet (chainId `8453`) following the same pattern as `deploy/07_phase3_redeploy.ts` but with mainnet-specific changes.

#### Hardhat Config Update

Add a `base` network entry to `hardhat.config.ts`:

```typescript
base: {
  url: process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org",
  chainId: 8453,
  accounts: getAccounts()
}
```

Add `base` to the etherscan `customChains` array:

```typescript
{
  network: "base",
  chainId: 8453,
  urls: {
    apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
    browserURL: "https://basescan.org"
  }
}
```

#### Constructor Arguments — Mainnet Addresses

The script must read these from env vars (no hardcoded mainnet addresses):

| Env Var | Purpose |
|---|---|
| `MAINNET_USDC_ADDRESS` | Base mainnet USDC |
| `MAINNET_ETH_USD_FEED` | Chainlink ETH/USD on Base mainnet |
| `MAINNET_TVRN_USD_FEED` | TVRN/USD feed address (custom or Chainlink) |
| `MAINNET_INITIAL_TEAM_ADDRESS` | Team multisig or deployer |
| `MAINNET_KEEPER_ADDRESS` | Chainlink forwarder for router |
| `MAINNET_ARBITER_ADDRESS` | Dispute resolution address |

The script must **abort with a clear error** if any required env var is missing. No fallback defaults for mainnet.

#### Deploy Order

Same as `deploy/07_phase3_redeploy.ts`:

1. Deploy `TavernToken` (fresh — no reuse on mainnet)
2. Deploy `TavernRegistry(token, initialTeam)`
3. Deploy `TavernEscrow(token, registry, usdc, ethUsdFeed, tvrnUsdFeed)`
4. Deploy `TavernStaking(token, registry)`
5. Deploy `TavernGovernance(token, registry)`
6. Deploy `TavernAutomationRouter(escrow, registry)`
7. Wire roles (same grants as Phase 3 — see `deploy/07_phase3_redeploy.ts`)
8. Call `registry.setStakingContract(staking)`
9. Verify all 6 contracts on Basescan
10. Write `deployments/base.json` manifest

#### Resume Env Vars

Support the same `MAINNET_REUSE_*` pattern:
- `MAINNET_REUSE_TOKEN_ADDRESS` / `MAINNET_REUSE_TOKEN_TX_HASH`
- `MAINNET_REUSE_REGISTRY_ADDRESS` / `MAINNET_REUSE_REGISTRY_TX_HASH`
- `MAINNET_REUSE_ESCROW_ADDRESS` / `MAINNET_REUSE_ESCROW_TX_HASH`
- `MAINNET_REUSE_STAKING_ADDRESS` / `MAINNET_REUSE_STAKING_TX_HASH`
- `MAINNET_REUSE_GOVERNANCE_ADDRESS` / `MAINNET_REUSE_GOVERNANCE_TX_HASH`
- `MAINNET_REUSE_ROUTER_ADDRESS` / `MAINNET_REUSE_ROUTER_TX_HASH`

#### Safety

- Add a confirmation prompt or `MAINNET_CONFIRM=true` env guard before any mainnet transaction
- Log estimated gas costs before each deploy step
- Back up any existing `deployments/base.json` before overwriting

#### Package.json Script

Add:
```json
"deploy:mainnet": "hardhat run deploy/08_mainnet_deploy.ts --network base"
```

---

## Deliverable 5 — `.env.example` Update

Update `.env.example` with all new mainnet env vars documented:

```
# === Base Mainnet ===
BASE_MAINNET_RPC_URL=
MAINNET_USDC_ADDRESS=
MAINNET_ETH_USD_FEED=
MAINNET_TVRN_USD_FEED=
MAINNET_INITIAL_TEAM_ADDRESS=
MAINNET_KEEPER_ADDRESS=
MAINNET_ARBITER_ADDRESS=
MAINNET_CONFIRM=false

# Resume vars (set only if reusing already-deployed contracts)
MAINNET_REUSE_TOKEN_ADDRESS=
MAINNET_REUSE_TOKEN_TX_HASH=
MAINNET_REUSE_REGISTRY_ADDRESS=
MAINNET_REUSE_REGISTRY_TX_HASH=
MAINNET_REUSE_ESCROW_ADDRESS=
MAINNET_REUSE_ESCROW_TX_HASH=
MAINNET_REUSE_STAKING_ADDRESS=
MAINNET_REUSE_STAKING_TX_HASH=
MAINNET_REUSE_GOVERNANCE_ADDRESS=
MAINNET_REUSE_GOVERNANCE_TX_HASH=
MAINNET_REUSE_ROUTER_ADDRESS=
MAINNET_REUSE_ROUTER_TX_HASH=
```

---

## Deliverable 6 — Pre-Launch Audit Checklist

Create `MAINNET_CHECKLIST.md` at the project root.

This is the **final go/no-go checklist** before a mainnet deploy. Structure:

### Section 1 — Static Analysis

- [ ] Slither run completed with 0 Critical / 0 High unresolved
- [ ] All Medium findings either fixed or documented with rationale
- [ ] `SLITHER_REPORT.md` committed

### Section 2 — Fuzz Testing

- [ ] All existing fuzz tests pass (`npm run audit:fuzz`)
- [ ] `FuzzStaking.t.sol` added and passing
- [ ] `FuzzGovernance.t.sol` added and passing
- [ ] `FuzzAutomation.t.sol` added and passing
- [ ] 10,000 runs per test minimum

### Section 3 — Unit Tests

- [ ] `npm run test` passes (all Hardhat tests)
- [ ] No skipped tests

### Section 4 — Gas Optimization

- [ ] `GAS_OPTIMIZATION_REPORT.md` committed
- [ ] Contract sizes below 24KB deployment limit:
  - [ ] TavernEscrow < 24KB
  - [ ] TavernRegistry < 24KB
  - [ ] TavernGovernance < 24KB
  - [ ] TavernAutomationRouter < 24KB
  - [ ] TavernToken < 24KB
  - [ ] TavernStaking < 24KB

### Section 5 — Oracle Strategy

- [ ] `MAINNET_ETH_USD_FEED` points to Chainlink Base mainnet ETH/USD feed
- [ ] `MAINNET_TVRN_USD_FEED` strategy decided and documented:
  - Option A: Deploy custom feed with admin update (short-term)
  - Option B: Chainlink TVRN/USD feed (when available)
  - Option C: DEX TWAP oracle adapter
- [ ] Oracle staleness window (1 hour) is appropriate for mainnet block times
- [ ] Feed decimals match expected values (8 for Chainlink standard)

### Section 6 — Access Control Audit

- [ ] All role grants documented in deploy manifest
- [ ] No role granted to EOA that should be multisig
- [ ] `DEFAULT_ADMIN_ROLE` transfer to multisig planned
- [ ] `SLASHER_ROLE` holder documented and justified
- [ ] `MINTER_ROLE` restricted to Escrow only
- [ ] `BURNER_ROLE` restricted to Staking only
- [ ] `KEEPER_ROLE` chain: Forwarder → Router → Escrow + Registry

### Section 7 — Deployment

- [ ] `deploy/08_mainnet_deploy.ts` written and tested against Hardhat local fork
- [ ] Resume env vars tested (interrupt + resume flow)
- [ ] `deployments/base.json` manifest schema matches `baseSepolia.json`
- [ ] Basescan verification logic works for Base mainnet
- [ ] `MAINNET_CONFIRM=true` guard tested

### Section 8 — Frontend

- [ ] `claw-tavern-app.html` has a mainnet config switch or separate mainnet build
- [ ] Mainnet RPC URL configured
- [ ] Mainnet USDC address configured
- [ ] Mainnet chain ID `8453` in wallet connection logic

### Section 9 — Operational Readiness

- [ ] Automation upkeep registration plan documented (LINK funding amount, gas limit)
- [ ] Initial TVRN distribution plan documented (staking bootstrap, governance bootstrap)
- [ ] Emergency freeze procedure documented (who proposes, expected timeline)
- [ ] Monitoring plan documented (event listeners, balance alerts)
- [ ] Deployer key security reviewed (hardware wallet, multisig)

### Section 10 — Documentation

- [ ] `WHITEPAPER_V2.md` reflects mainnet intent (no testnet-only language in final version)
- [ ] `AUDIT_SCOPE.md` current with any Task 20 contract changes
- [ ] `DEPLOY_GUIDE.md` updated with mainnet section
- [ ] `HANDOFF_RESUME.md` updated with Task 20 completion

---

## Deliverable 7 — Frontend Mainnet Config

Update `claw-tavern-app.html`:

- Add a `NETWORK_CONFIG` object that switches between `baseSepolia` and `base` profiles
- Each profile holds: chainId, rpc, contract addresses, USDC address, block explorer URL
- Default to `baseSepolia` until mainnet deploy populates the `base` profile
- Show a network badge in the header ("Base Sepolia" vs "Base Mainnet")
- Warn users if connected wallet chainId doesn't match the active profile

Do NOT hardcode mainnet addresses yet — leave them as placeholder `0x0` in the `base` profile. They will be filled after the actual mainnet deploy.

---

## Checklist

### Gas Optimization

- [ ] `GAS_OPTIMIZATION_REPORT.md` created
- [ ] Gas fixes applied to contracts
- [ ] `npm run compile` passes
- [ ] `npm run test` passes after gas changes
- [ ] Before/after contract sizes documented

### Fuzz Tests

- [ ] `test/fuzz/FuzzStaking.t.sol` created and passing
- [ ] `test/fuzz/FuzzGovernance.t.sol` created and passing
- [ ] `test/fuzz/FuzzAutomation.t.sol` created and passing
- [ ] `npm run audit:fuzz` passes all tests
- [ ] Existing fuzz tests still pass

### Slither

- [ ] `SLITHER_REPORT.md` created
- [ ] All Critical/High findings resolved or documented
- [ ] Re-run after fixes shows clean state

### Mainnet Deploy Script

- [ ] `deploy/08_mainnet_deploy.ts` created
- [ ] `hardhat.config.ts` updated with `base` network
- [ ] `.env.example` updated with mainnet vars
- [ ] `MAINNET_CONFIRM` guard implemented
- [ ] Resume env vars supported
- [ ] `package.json` script added: `deploy:mainnet`

### Checklist Document

- [ ] `MAINNET_CHECKLIST.md` created
- [ ] All 10 sections present
- [ ] Actionable checkboxes (not vague items)

### Frontend

- [ ] `claw-tavern-app.html` updated with network config switch
- [ ] Network badge visible
- [ ] Chain mismatch warning implemented
- [ ] Mainnet profile has placeholder addresses

### Build

- [ ] `npm run compile` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run test` passes
- [ ] No broken markdown links

### HANDOFF

- [ ] `HANDOFF_RESUME.md` updated:
  - Task 20 row: "Completed — mainnet preparation package delivered"
  - "What Changed In Task 20" section added
  - Important Project Files updated with new files
  - Recommendation updated: "Phase 3 complete. Ready for external audit and mainnet deploy."

---

## Phase 3 Roadmap (Tasks 16–20)

| Task | Description | Status |
|------|-------------|--------|
| 16 | Live deploy Governance + Router | ✅ Completed |
| 17 | Coordinated Phase 3 redeploy | ✅ Completed |
| 18 | E2E testnet QA (10/10 PASS) | ✅ Completed |
| 19 | Whitepaper v2 + docs update | ✅ Completed |
| **20** | **This task** — Mainnet preparation | Code only |
