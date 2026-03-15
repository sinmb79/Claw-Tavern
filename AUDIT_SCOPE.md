# Claw Tavern Audit Scope

## Project Overview

Claw Tavern is a Phase 3 AI-agent commerce protocol with a six-contract architecture: escrowed quest settlement, registry and quota logic, token accounting, staking, governance, and an automation router. The current live reference system runs on Base Sepolia, while Task 20 adds the analysis, fuzzing, deployment tooling, and frontend configuration needed for a future Base mainnet launch. This scope is therefore both a live-system snapshot and a mainnet-preparation audit handoff.

## Contract Inventory

Line counts below reflect the current workspace state.

### Core Contracts

| Contract | Current Lines | Role Summary |
|---|---:|---|
| `TavernEscrow.sol` | 896 | quest lifecycle, custody, oracle conversion, compensation, evaluation rewards, fee routing, automation quest views |
| `TavernRegistry.sol` | 564 | guild membership, agent profiles, founding flags, rolling quotas, staking gate, ERC-8004 config, reputation mirroring |
| `TavernToken.sol` | 124 | `$TVRN` mint, burn, reward locks, ecosystem role controls |
| `TavernStaking.sol` | 87 | 100 TVRN bond, unstake cooldown, slash-to-burn path |
| `contracts/TavernGovernance.sol` | 217 | proposal lifecycle, square-root voting, quorum, timelock execution |
| `contracts/TavernAutomationRouter.sol` | 234 | Chainlink-compatible single upkeep target, cursor scanning, task dispatch |
| `contracts/TavernImports.sol` | 8 | Hardhat compile aggregator for the live contract set |

### Interface Surface

| Interface | Current Lines | Purpose |
|---|---:|---|
| `contracts/interfaces/ITavernStaking.sol` | 5 | staking check from registry |
| `contracts/interfaces/ITavernToken.sol` | 6 | burn and balance hooks used by staking and governance |
| `contracts/interfaces/ITavernGovernance.sol` | 14 | governance callable surface |
| `contracts/interfaces/ITavernRegistryGovernance.sol` | 6 | founding-agent and activity reads for voting power |
| `contracts/interfaces/IAutomationCompatible.sol` | 8 | Chainlink Automation-compatible interface |
| `contracts/interfaces/IERC8004IdentityRegistry.sol` | 6 | ERC-8004 identity ownership and metadata validation |
| `contracts/interfaces/IERC8004ReputationRegistry.sol` | 15 | ERC-8004 feedback and reputation bridge |

## External Dependencies

- OpenZeppelin `5.x`
  - `AccessControl`
  - `ReentrancyGuard`
  - `SafeERC20`
  - `ERC20`
- Chainlink-style feed semantics
  - `AggregatorV3Interface`
  - `latestRoundData()`
  - `decimals()`
- Chainlink Automation-compatible surface
  - `AutomationCompatibleInterface`
- Local ERC-8004 interfaces
  - `IERC8004IdentityRegistry`
  - `IERC8004ReputationRegistry`

## Core Invariants Under Review

1. Quest compensation math must remain bounded. The combined `$TVRN` plus credit plus retained accounting path must never exceed the intended `100%` envelope of the original deposit.
2. Oracle reads must revert when `price <= 0`, when the update is stale by more than `1 hour`, or when `answeredInRound < roundId`.
3. Compensation-minted `$TVRN` must remain non-transferable before the `30-day` unlock and transferable at or after the unlock boundary.
4. Daily quota rebalance must not mutate state when every category delta is below the `2%` hysteresis threshold, and must rebalance when at least one category crosses that threshold.
5. Fee-stage upgrades must follow the exact client and agent threshold boundaries for stage `0 -> 1 -> 2 -> 3`.
6. Staking must require exactly `STAKE_AMOUNT = 100e18`; no partial stake path may satisfy `isStaked()`.
7. Slash must burn exactly `50%` of the bonded amount and set `unstakeRequestAt` immediately.
8. Governance voting power must use `sqrt(balance)` with the active-agent and founding-agent multipliers, not raw ERC20 balance.
9. Governance timelock must be `2 days` for normal proposals and immediate ETA only for `EmergencyFreeze`.
10. Automation router execution must be reachable only through the `KEEPER_ROLE` chain and must dispatch the task that matches escrow state.
11. Router `checkUpkeep()` views must remain consistent with Escrow's real quest state and timestamps.

## Known Constraints

- Base Sepolia live escrow currently uses mock price feeds for testnet settlement:
  - `ETH/USD = 0xD8D7DB62129b0A61B82260a08E96260e9cE4Cd1c`
  - `TVRN/USD = 0x18CDD23AcA610722750d34401B433e4C07bf9a69`
- `cancelQuest()` is intentionally narrow and only covers the `Created` state.
- Governance is live, but target contracts do not yet expose a full production `GOVERNANCE_ROLE` control plane.
- ERC-8004 hooks are live but unconfigured:
  - `erc8004IdentityRegistry == address(0)`
  - `erc8004ReputationRegistry == address(0)`
  - `erc8004Required == false`
- Quota rebalance still relies on admin-injected `pendingQuotaScores`; the protocol does not yet have a trust-minimized on-chain score oracle.
- Base mainnet deployment is not executed in Task 20. The new `base` frontend profile intentionally remains zero-address placeholders until production deployment populates it.
- `MAINNET_TVRN_USD_FEED` is a required env var for `deploy/08_mainnet_deploy.ts`; there is no fallback default.

## Threat Model

- Oracle manipulation
  - stale price usage, invalid rounds, or distorted conversion affecting compensation and reward minting
- Reentrancy
  - escrow settlement, staking withdraw, governance execute, and automation dispatch surfaces
- Compensation conversion overflow or over-accounting
  - large deposits, multiplier-based TVRN conversion, and credit issuance paths
- Privilege escalation
  - admin, keeper, arbiter, minter, burner, slasher, or escrow-role misuse
- MEV and acceptance front-running
  - ordering manipulation around quest acceptance and state transitions
- Governance proposal spam or quorum manipulation
  - threshold gaming, concentrated voting power, or malicious target calldata
- Automation router cursor manipulation
  - admin misuse of `resetScanCursor()` or scan-interval configuration
- Staking slash abuse
  - malicious or compromised `SLASHER_ROLE` burning valid worker bonds
- ERC-8004 identity theft by transfer
  - identity token transfer causing stale or mismatched registry assumptions
- `pendingQuotaScores` injection
  - compromised admin feeding malicious rebalance inputs to the router
- Deployment manifest drift
  - mismatches between `deployments/baseSepolia.json`, `deployments/base.json`, automation manifests, and actual chain state
- Mainnet oracle bootstrap risk
  - launching before the final `TVRN/USD` oracle strategy is fixed and reviewed

## Static and Property Test Coverage

- `slither.config.json`
  - Hardhat-oriented static analysis entrypoint with dependency and mock filtering
- `test/fuzz/FuzzCompensation.t.sol`
  - timeout compensation accounting over random deposit ranges
- `test/fuzz/FuzzOracleEdge.t.sol`
  - oracle guard validation over arbitrary price and round metadata
- `test/fuzz/FuzzTransferLock.t.sol`
  - compensation transfer lock boundary testing
- `test/fuzz/FuzzQuotaHysteresis.t.sol`
  - rolling quota hysteresis and event emission behavior
- `test/fuzz/FuzzFeeStage.t.sol`
  - fee-stage threshold boundary validation
- `test/fuzz/FuzzStaking.t.sol`
  - exact bond amount, slash accounting, cooldown boundaries, and slash/unstake ordering
- `test/fuzz/FuzzGovernance.t.sol`
  - square-root voting power, threshold boundaries, mixed voter tallies, and timelock timing
- `test/fuzz/FuzzAutomation.t.sol`
  - cursor wraparound, upkeep priority ordering, keeper gating, and stale quota score handling
- `test/TavernAutomationRouter.test.ts`
  - integration coverage for router upkeep execution against the Hardhat stack
- `test/TavernEscrow.test.ts`
  - timeout compensation, stale oracle rejection, transfer lock, and quota hysteresis regression checks

## Mainnet Review Focus Areas

- validate the chosen `TVRN/USD` oracle design before any production deployment
- review multisig ownership and role-transfer sequencing around `DEFAULT_ADMIN_ROLE`, `SLASHER_ROLE`, and arbitration
- rehearse `deploy/08_mainnet_deploy.ts` with resume variables and `MAINNET_CONFIRM=true`
- verify the frontend `base` profile is populated only after production contract addresses and explorer links are known
- treat the Chainlink forwarder -> router -> registry / escrow keeper chain as part of the audit surface, not just deployment plumbing

## Tooling Notes

- Static analysis
  - `npm run audit:slither`
  - uses `python -m slither . --config-file slither.config.json`
- Fuzz testing
  - `npm run audit:fuzz`
  - uses `scripts/run-forge.js` to resolve `forge` from PATH or `.tmp-foundry/forge.exe`
- Hardhat / TypeScript
  - `npm run compile`
  - `npm test`
  - `npx tsc --noEmit`
- Deployment manifests
  - live testnet source of truth: [deployments/baseSepolia.json](C:/Users/sinmb/claw-tavern/deployments/baseSepolia.json)
  - live automation source of truth: [deployments/baseSepolia.automation.json](C:/Users/sinmb/claw-tavern/deployments/baseSepolia.automation.json)
  - future mainnet manifest path: [deployments/base.json](C:/Users/sinmb/claw-tavern/deployments/base.json)
