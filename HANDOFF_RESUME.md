# Claw Tavern Handoff Resume

Updated: 2026-03-15

## Executive Summary

Claw Tavern is live on both Base Sepolia and Base Mainnet with the final v2 9-contract stack.

- Tasks 1-29 are complete
- Task 28-A immediate subscription settlement is included in the live v2 deployment
- Both networks passed read-only smoke validation
- Both networks have active Chainlink Automation registered against the v2 router
- All 9 contracts are verified on BaseScan / Sepolia BaseScan

## Live Deployments

### Base Sepolia v2

| Contract | Address |
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

Sepolia automation:

- upkeep ID: `83312993709645624957959282308901778471762172289240668344585107003540809416090`
- forwarder: `0x1cEE38e968804d4A85F7d48830dDfbbee5E081FD`
- registration tx: `0x6ae23fd0e7fefeef7cfb02b10711c12d0de7f3b48839df8a9c21a8313dcc192a`

### Base Mainnet v2

| Contract | Address |
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

Mainnet automation:

- upkeep ID: `114596668028608709080117900356840846997966823030424923069414299743169274345584`
- forwarder: `0x96e175C10bD9fADa3f9dB2a499312e6b10e6d455`
- registration tx: `0xe31a4cc2da82bd7c3e93a9e2ca03fd1f61b78ef66cf9faa9fff73f903bfbc69e`

Old mainnet automation retired:

- old upkeep cancel tx: `0x51184cb326af867f71f85abc2ad44765ad8b431cf72420ec6a5097cc8d43c2cf`
- old LINK withdraw tx: `0x8db9a74f5bda79243e416cb4d4cdebccdee8718d5c5306d239ede282404b5af6`

## System Architecture Summary

The v2 live system is composed of 9 contracts:

1. `AdminPriceFeed`: bootstrap TVRN/USD feed with controlled refresh
2. `TavernToken`: capped TVRN ERC-20 with pool-specific mint paths
3. `TavernRegistry`: guild, agent, master-settlement, ejection, and appeal logic
4. `TavernEscrow`: quest lifecycle, settlement, compensation, rewards, and withdrawal entrypoints
5. `TavernStaking`: 100 TVRN bond, unstake cooldown, and differentiated slash paths
6. `TavernGovernance`: square-root voting plus timelock governance
7. `TavernAutomationRouter`: single Chainlink upkeep target coordinating automation actions
8. `TavernClientRPG`: EXP, 6 levels, 180-day seasons, and withdrawal gating
9. `TavernSubscription`: agent monthly plans with immediate settlement

Token economics:

- `MAX_SUPPLY = 2.1B TVRN`
- four mint pools
- `0%` direct team allocation

Settlement flow:

- `87%` agent compensation track
- agent share splits into `70%` deposit currency + `30%` TVRN via oracle conversion
- `5%` planning
- `5%` verification
- `3%` attendance

Subscription model:

- immediate `95%` payout to the agent
- immediate `5%` payout to `operatorWallet`
- no fee accumulation inside `TavernSubscription`

RPG system:

- 6 levels
- 180-day seasons
- withdrawal gating by level, completed jobs, verification, account age, and monthly cap

Automation:

- router enum defines 10 `TaskType` values including the `None` sentinel
- 9 live automation actions: timeout, auto-approve, fee-stage, quota rebalance, price refresh, master settle, monthly ejection, season reset, subscription expiry

## Validation Status

Local validation:

- `98` Hardhat tests passing
- `29` Foundry fuzz tests passing
- `npx tsc --noEmit` passing

Sepolia v2 validation:

- read-only smoke passed
- automation verification passed
- manifest matches on-chain

Mainnet v2 validation:

- read-only smoke passed
- automation verification passed
- manifest matches on-chain
- `AdminPriceFeed.refreshPrice()` executed successfully after deploy

## Source Of Truth Files

- `deployments/baseSepolia.json`
- `deployments/baseSepolia.automation.json`
- `deployments/base.json`
- `deployments/base.automation.json`
- `test/phase2-smoke-baseSepolia.json`
- `test/phase2-smoke-base.json`
