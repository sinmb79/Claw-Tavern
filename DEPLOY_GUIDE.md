# Claw Tavern Deployment Guide

This guide reflects the final live v2 deployment state on Base Sepolia and Base Mainnet.

## 1. Active Deploy Scripts

Current live deploy scripts:

- `deploy/07_phase3_redeploy.ts`: full 9-contract Base Sepolia deploy
- `deploy/08_mainnet_deploy.ts`: full 9-contract Base Mainnet deploy

Historical / superseded scripts:

- `deploy/01_deploy.ts` through `deploy/06_deploy_automation_router.ts`
- `deploy/09_deploy_client_rpg.ts`
- `deploy/10_deploy_subscription.ts`

Those scripts are kept for history and local recovery reference, but the live rollout path is the full 9-contract redeploy flow.

## 2. Live v2 Contract Set

The v2 deployment always includes:

1. `AdminPriceFeed`
2. `TavernToken`
3. `TavernRegistry`
4. `TavernEscrow`
5. `TavernStaking`
6. `TavernGovernance`
7. `TavernAutomationRouter`
8. `TavernClientRPG`
9. `TavernSubscription`

## 3. npm Script Map

Primary scripts:

- `npm run deploy:sepolia`
- `npm run deploy:mainnet`
- `npm run smoke:sepolia`
- `npm run smoke:mainnet`
- `npm run register:automation:sepolia`
- `npm run register:automation:mainnet`
- `npm run cancel:automation:sepolia`
- `npm run cancel:automation:mainnet`
- `npm run cancel:automation:sepolia:wait`
- `npm run cancel:automation:mainnet:wait`
- `npm run verify:automation:sepolia`
- `npm run verify:automation:mainnet`

Compatibility aliases remain for:

- `deploy:phase3:baseSepolia`
- `smoke:phase2:baseSepolia`
- `smoke:phase2:base`
- `register:automation`
- `register:automation:base`
- `cancel:automation`
- `cancel:automation:base`
- `verify:automation`
- `verify:automation:base`

## 4. Environment Variables

Copy `.env.example` to `.env`.

### Shared

- `DEPLOYER_PRIVATE_KEY`
- `BASESCAN_API_KEY`

### Base Sepolia

- `BASE_SEPOLIA_RPC_URL`
- `BASE_SEPOLIA_USDC_ADDRESS`
- `BASE_SEPOLIA_ETH_USD_FEED`
- `KEEPER_ADDRESS`
- `ARBITER_ADDRESS`
- `CHAINLINK_AUTOMATION_REGISTRY_ADDRESS`
- `CHAINLINK_AUTOMATION_REGISTRAR_ADDRESS`
- `CHAINLINK_AUTOMATION_FORWARDER_ADDRESS`
- `BASE_SEPOLIA_SUBSCRIPTION_OPERATOR_WALLET`
- `BASE_SEPOLIA_OPERATOR_WALLET`

Sepolia recovery variables:

- `PHASE3_REUSE_ADMIN_PRICE_FEED_ADDRESS`
- `PHASE3_REUSE_ADMIN_PRICE_FEED_TX_HASH`
- `PHASE3_REUSE_TOKEN_ADDRESS`
- `PHASE3_REUSE_TOKEN_TX_HASH`
- `PHASE3_REUSE_REGISTRY_ADDRESS`
- `PHASE3_REUSE_REGISTRY_TX_HASH`
- `PHASE3_REUSE_ESCROW_ADDRESS`
- `PHASE3_REUSE_ESCROW_TX_HASH`
- `PHASE3_REUSE_STAKING_ADDRESS`
- `PHASE3_REUSE_STAKING_TX_HASH`
- `PHASE3_REUSE_GOVERNANCE_ADDRESS`
- `PHASE3_REUSE_GOVERNANCE_TX_HASH`
- `PHASE3_REUSE_ROUTER_ADDRESS`
- `PHASE3_REUSE_ROUTER_TX_HASH`
- `PHASE3_REUSE_CLIENT_RPG_ADDRESS`
- `PHASE3_REUSE_CLIENT_RPG_TX_HASH`
- `PHASE3_REUSE_SUBSCRIPTION_ADDRESS`
- `PHASE3_REUSE_SUBSCRIPTION_TX_HASH`

Leave Sepolia reuse variables blank for a fresh deploy.

### Base Mainnet

- `BASE_MAINNET_RPC_URL`
- `MAINNET_CONFIRM=true`
- `MAINNET_USDC_ADDRESS`
- `MAINNET_ETH_USD_FEED`
- `MAINNET_DEPLOY_TVRN_FEED=true` or `MAINNET_REUSE_TVRN_FEED_ADDRESS`
- `MAINNET_KEEPER_ADDRESS`
- `MAINNET_ARBITER_ADDRESS`
- `MAINNET_CHAINLINK_AUTOMATION_REGISTRY_ADDRESS`
- `MAINNET_CHAINLINK_AUTOMATION_REGISTRAR_ADDRESS`
- `MAINNET_CHAINLINK_AUTOMATION_FORWARDER_ADDRESS`
- `MAINNET_SUBSCRIPTION_OPERATOR_WALLET`
- `MAINNET_OPERATOR_WALLET`
- `OPERATOR_WALLET`

Mainnet recovery variables:

- `MAINNET_REUSE_TOKEN_ADDRESS`
- `MAINNET_REUSE_TOKEN_TX_HASH`
- `MAINNET_REUSE_REGISTRY_ADDRESS`
- `MAINNET_REUSE_REGISTRY_TX_HASH`
- `MAINNET_REUSE_ESCROW_ADDRESS`
- `MAINNET_REUSE_ESCROW_TX_HASH`
- `MAINNET_REUSE_STAKING_ADDRESS`
- `MAINNET_REUSE_STAKING_TX_HASH`
- `MAINNET_REUSE_GOVERNANCE_ADDRESS`
- `MAINNET_REUSE_GOVERNANCE_TX_HASH`
- `MAINNET_REUSE_ROUTER_ADDRESS`
- `MAINNET_REUSE_ROUTER_TX_HASH`
- `MAINNET_REUSE_TVRN_FEED_ADDRESS`
- `MAINNET_REUSE_TVRN_FEED_TX_HASH`
- `MAINNET_REUSE_CLIENT_RPG_ADDRESS`
- `MAINNET_REUSE_CLIENT_RPG_TX_HASH`
- `MAINNET_REUSE_SUBSCRIPTION_ADDRESS`
- `MAINNET_REUSE_SUBSCRIPTION_TX_HASH`

Leave all `MAINNET_REUSE_*` variables blank for a fresh deploy.

## 5. Automation Lifecycle

The full automation lifecycle is:

1. Deploy the new 9-contract set
2. Run the read-only smoke script
3. Cancel the old upkeep
4. Wait out the Chainlink cancellation delay if LINK withdrawal is needed
5. Withdraw old upkeep LINK
6. Register the new upkeep against the new `TavernAutomationRouter`
7. Fund registration with at least the registrar minimum LINK
8. Grant `KEEPER_ROLE` to the new forwarder on `TavernAutomationRouter`
9. Verify the new upkeep, forwarder, and role holders on-chain

Supporting scripts:

- `scripts/cancel-automation-upkeeps.ts`
- `scripts/register-automation.ts`
- `scripts/verify-automation-health.ts`
- `scripts/cleanup-legacy-automation.ts`

Recommended commands:

```bash
npm run deploy:sepolia
npm run smoke:sepolia
npm run cancel:automation:sepolia:wait
npm run register:automation:sepolia
npm run verify:automation:sepolia
```

```bash
npm run deploy:mainnet
npm run smoke:mainnet
npm run cancel:automation:mainnet:wait
npm run register:automation:mainnet
npm run verify:automation:mainnet
```

## 6. Wiring Performed By The Deploy Scripts

The live deploy scripts wire:

- token `MINTER_ROLE` -> registry
- token `MINTER_ROLE` -> escrow
- token `MINTER_ROLE` -> RPG
- token `ESCROW_ROLE` -> escrow
- token `BURNER_ROLE` -> staking
- token `GOVERNANCE_ROLE` -> governance
- registry `ARBITER_ROLE` -> escrow
- registry `ARBITER_ROLE` -> configured arbiter
- registry `KEEPER_ROLE` -> router
- registry `KEEPER_ROLE` -> deployer
- escrow `KEEPER_ROLE` -> router
- escrow `KEEPER_ROLE` -> deployer
- escrow `GOVERNANCE_ROLE` -> governance
- staking `SLASHER_ROLE` -> escrow
- staking `SLASHER_ROLE` -> deployer
- router `KEEPER_ROLE` -> deployer
- router `KEEPER_ROLE` -> configured keeper
- `AdminPriceFeed.setRefresher(router, true)`
- RPG `ESCROW_ROLE` -> escrow
- RPG `KEEPER_ROLE` -> router
- RPG `SUBSCRIPTION_ROLE` -> subscription
- subscription `KEEPER_ROLE` -> router
- `registry.setStakingContract(staking)`
- `escrow.setClientRPG(rpg)`
- `router.setClientRPG(rpg)`
- `subscription.setClientRPG(rpg)`
- `router.setSubscriptionContract(subscription)`

## 7. Immediate Settlement Model

`TavernSubscription` uses the Task 28-A settlement model:

- `subscribe()` pulls the full monthly USDC amount from the client
- `95%` is sent to the agent in the same transaction
- `5%` is sent to `operatorWallet` in the same transaction
- contract-held fee accumulation is not used

## 8. Rollback Procedure

### Soft rollback of v2 auxiliary hooks

If RPG or subscription behavior must be disabled without replacing the whole deploy:

- call `escrow.setClientRPG(address(0))`
- call `router.setClientRPG(address(0))`
- call `subscription.setClientRPG(address(0))`
- call `router.setSubscriptionContract(address(0))`

This disables the v2 auxiliary paths while preserving the deployed core set.

### Manifest / frontend rollback

If frontend or operator tooling must temporarily point back to pre-v2 manifests:

- restore `deployments/baseSepolia.v1-backup.json`
- restore `deployments/baseSepolia.automation.v1-backup.json`
- restore `deployments/base.v1-backup.json`
- restore `deployments/base.automation.v1-backup.json`

This only restores local source-of-truth files. It does not move live on-chain state back to old contracts by itself.

### Full operational rollback

If a full rollback to older contracts is ever required:

- repoint frontend and operator tooling to the intended contract set
- cancel the current upkeep
- register automation for the rollback target
- revalidate role holders and smoke tests before reopening traffic

## 9. Current Live Source Of Truth

- `deployments/baseSepolia.json`
- `deployments/baseSepolia.automation.json`
- `deployments/base.json`
- `deployments/base.automation.json`
- `test/phase2-smoke-baseSepolia.json`
- `test/phase2-smoke-base.json`
