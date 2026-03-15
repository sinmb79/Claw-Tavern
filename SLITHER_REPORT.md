# Claw Tavern Slither Report

Date: 2026-03-14  
Slither version: `0.11.5`  
Commit hash: `N/A` (`.git` directory not present in this workspace)

## Command

```bash
npm run audit:slither
```

## Final Run Summary

Slither analyzed `38 contracts` with `101 detectors` and returned `73` raw results on the final rerun.

### Raw Severity Counts

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 1 |
| Medium | 6 |
| Low | 41 |
| Informational | 19 |
| Optimization | 6 |

### Triage Outcome

| Category | Count |
|---|---:|
| Critical unresolved | 0 |
| High unresolved | 0 |
| Medium unresolved security blockers | 0 |
| Fixed before final rerun | 9 detector classes |
| Acknowledged / accepted design findings in final rerun | 14 detector classes |

## Fixes Landed Before The Final Rerun

The following issue classes were fixed during Task 20 and no longer appear as active blockers in the final run:

- unchecked ERC20 transfer usage on registry payment paths
- divide-before-multiply compensation arithmetic
- missing zero-address validation on escrow constructor and admin setters
- several reentrancy-no-eth style surfaces on registry, staking, and router paths
- uninitialized local values in quota rebalance logic
- repeated array length reads and loop increments on hot paths
- redundant no-op statement in token unlock sync
- state-after-external-call ordering on router upkeep execution
- hot-path storage rereads in settlement, quota, and staking flows

## Final Finding Triage

| Detector | Raw Severity | Representative Location | Status | Notes |
|---|---|---|---|---|
| `arbitrary-send-eth` | High | `TavernEscrow.sol:1035` | Acknowledged | `_transferCurrency(...)` intentionally pays arbitrary quest counterparties. The call site is constrained by escrow state transitions, deposit accounting, and role/auth checks. |
| `incorrect-equality` | Medium | `TavernEscrow.sol:430`, `contracts/TavernGovernance.sol:248` | Acknowledged | Both are sentinel-style checks: unread timestamp `0` and `_sqrt(0)`. They do not introduce equality-on-price or equality-on-balance risk. |
| `unused-return` | Medium | `TavernEscrow.sol:961`, `TavernEscrow.sol:1015`, `contracts/TavernAutomationRouter.sol:119`, `contracts/TavernAutomationRouter.sol:229` | Acknowledged | These are tuple destructuring / best-effort bridge calls / view tuple reads. No actionable unchecked-transfer issue remains here. |
| `calls-loop` | Low | `contracts/TavernAutomationRouter.sol:224` | Acknowledged | Router scanning intentionally calls the escrow view in a bounded batch loop. `scanBatchSize` remains admin-bounded and defaults to a safe small value. |
| `reentrancy-events` | Low | `TavernRegistry.sol:467` | Acknowledged | The ERC-8004 reputation push is best-effort and event emission after the external call is informational, not balance-affecting. |
| `timestamp` | Low | `TavernEscrow.sol:289`, `TavernRegistry.sol:361`, `TavernStaking.sol:75`, `TavernToken.sol:99`, `contracts/TavernAutomationRouter.sol:81`, `contracts/TavernGovernance.sol:146` | Acknowledged | Time-based behavior is core protocol design: timeout, auto-approve, cooldown, yearly unlocks, and governance windows all intentionally depend on block timestamps. |
| `assembly` | Informational | `contracts/TavernGovernance.sol:194` | Acknowledged | Governance execute bubble-up uses minimal inline assembly only to forward revert data from the target call. |
| `cyclomatic-complexity` | Informational | `TavernRegistry.sol:520` | Acknowledged | `dailyQuotaRebalance(...)` is intentionally dense because it computes six-slot hysteresis and normalization in one transaction. |
| `low-level-calls` | Informational | `TavernEscrow.sol:976`, `TavernEscrow.sol:996`, `TavernEscrow.sol:1035`, `contracts/TavernGovernance.sol:203` | Acknowledged | The token mint fallback chain, optional unlock sync, ETH payout, and governance target execution all require low-level calls by design. |
| `missing-inheritance` | Informational | `TavernRegistry.sol:17`, `TavernToken.sol:19` | Acknowledged | Interfaces are used for cross-contract typing and test harnesses, not as inheritance requirements on the live contracts. |
| `naming-convention` | Informational | `contracts/TavernAutomationRouter.sol:130` | Acknowledged | Underscored setter parameters are cosmetic and intentionally left unchanged. |
| `unindexed-event-address` | Informational | `TavernEscrow.sol:194`, `TavernEscrow.sol:195`, `contracts/TavernAutomationRouter.sol:60` | Acknowledged | Event signatures were intentionally preserved to avoid ABI churn across the deployed system and frontend. |
| `constable-states` | Optimization | `TavernRegistry.sol:91` | Acknowledged | `globalRegistrationFee` is intentionally mutable for governance/admin control and cannot be made constant. |
| `immutable-states` | Optimization | `TavernEscrow.sol:139`, `TavernRegistry.sol:31`, `TavernRegistry.sol:94` | Acknowledged | These variables were left mutable or storage-backed to preserve live-layout compatibility and admin configuration behavior. |

## Auditor Notes

- Raw Slither output still contains a large number of timestamp warnings because the protocol deliberately encodes time-driven market rules.
- No final finding was treated as a blocking security defect after triage.
- The one raw `High` finding is a design-intent payout primitive, not an uncontrolled withdrawal path.
- The main unresolved work before production launch is operational rather than static-analysis driven: multisig role planning, production oracle selection, and mainnet deployment rehearsal.
