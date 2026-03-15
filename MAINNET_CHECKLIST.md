# Claw Tavern Mainnet Checklist

This is the final go / no-go checklist before a Base mainnet deployment. Checked boxes reflect work already completed in Task 20. Unchecked boxes are still required before a real production launch.

## 1. Static Analysis

- [x] Slither run completed with `0 Critical / 0 High unresolved`
- [x] All Medium findings either fixed or documented with rationale
- [x] `SLITHER_REPORT.md` committed

## 2. Fuzz Testing

- [x] All existing fuzz tests pass (`npm run audit:fuzz`)
- [x] `FuzzStaking.t.sol` added and passing
- [x] `FuzzGovernance.t.sol` added and passing
- [x] `FuzzAutomation.t.sol` added and passing
- [x] `10,000` runs per test minimum

## 3. Unit Tests

- [x] `npm run test` passes
- [x] No skipped tests

## 4. Gas Optimization

- [x] `GAS_OPTIMIZATION_REPORT.md` committed
- [x] Contract sizes below `24 KB`
- [x] `TavernEscrow < 24 KB`
- [x] `TavernRegistry < 24 KB`
- [x] `TavernGovernance < 24 KB`
- [x] `TavernAutomationRouter < 24 KB`
- [x] `TavernToken < 24 KB`
- [x] `TavernStaking < 24 KB`

## 5. Oracle Strategy

- [ ] `MAINNET_ETH_USD_FEED` points to the chosen Chainlink Base mainnet ETH/USD feed in the real deploy `.env`
- [x] `TVRN/USD` strategy decided: `AdminPriceFeed` at `$0.01`
- [ ] `AdminPriceFeed` deployed and verified
- [ ] Initial price set to `1_000_000` (`8` decimals = `$0.01`)
- [ ] Admin refresh cadence documented and assigned to an operator
- [x] Oracle staleness window remains `1 hour`
- [ ] Feed decimal assumptions validated against the chosen mainnet feeds

## 6. Access Control Audit

- [x] All role grants are documented in `deploy/08_mainnet_deploy.ts`
- [ ] No production role is assigned to an EOA that should instead be a multisig
- [ ] `DEFAULT_ADMIN_ROLE` transfer destination decided and rehearsed
- [ ] `SLASHER_ROLE` holder documented and justified for production
- [x] `MINTER_ROLE` is restricted to `TavernEscrow`
- [x] `BURNER_ROLE` is restricted to `TavernStaking`
- [x] `KEEPER_ROLE` chain is defined as `Forwarder -> Router -> Escrow + Registry`

## 7. Deployment

- [x] `deploy/08_mainnet_deploy.ts` written
- [x] `MAINNET_CONFIRM=true` guard implemented
- [x] Resume env vars supported
- [x] `deployments/base.json` manifest write path added
- [ ] Script tested against a Base mainnet fork or dress rehearsal environment
- [ ] Resume flow tested through an intentional interrupt + resume exercise
- [ ] Basescan verification confirmed against a real Base mainnet deployment

## 8. Frontend

- [x] `claw-tavern-app.html` supports `baseSepolia` and `base` profiles
- [x] Network badge is visible in the header
- [x] Chain mismatch warning is implemented
- [x] Mainnet profile is present with placeholder zero addresses
- [x] Mainnet chain ID `8453` is wired into wallet switching logic
- [ ] Final Base mainnet contract addresses populated after production deploy
- [ ] Mainnet USDC address populated after production deploy

## 9. Operational Readiness

- [ ] Automation funding policy documented
- [ ] Initial TVRN distribution plan documented
- [ ] Emergency freeze runbook documented
- [ ] Monitoring and alerting plan documented
- [ ] Deployer key and multisig operational security reviewed

## 10. Documentation

- [ ] `WHITEPAPER_V2.md` updated from live-testnet wording to final mainnet-intent wording
- [x] `AUDIT_SCOPE.md` refreshed for Task 20 line counts and fuzz coverage
- [x] `DEPLOY_GUIDE.md` updated with a Base mainnet preparation section
- [x] `HANDOFF_RESUME.md` updated with Task 20 completion notes
