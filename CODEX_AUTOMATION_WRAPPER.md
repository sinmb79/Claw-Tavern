# Task 14 — Chainlink Automation Native Wrapper

> Codex implementation instruction. Do NOT deploy to Base Sepolia — code-only (same as Task 13 Path A).
> Compile, type-check, and test locally only.

---

## Goal

Create `TavernAutomationRouter.sol` — a single contract implementing Chainlink's `AutomationCompatibleInterface` (`checkUpkeep` / `performUpkeep`) that replaces the current placeholder upkeep registrations with native on-chain automation logic.

Currently, the three registered upkeeps are **placeholder registrations**: Chainlink calls them but the contracts have no `checkUpkeep`/`performUpkeep` hooks. The router fixes this by acting as the upkeep target that Chainlink calls directly.

---

## Architecture

```
Chainlink Automation Registry
        │
        ▼
TavernAutomationRouter (single upkeep target)
   ├─ checkUpkeep()  → scans for pending work
   └─ performUpkeep() → executes the identified task
        │
        ├─► TavernEscrow.executeTimeout(questId)
        ├─► TavernEscrow.executeAutoApprove(questId)
        ├─► TavernEscrow.checkAndUpgradeFeeStage()
        └─► TavernRegistry.dailyQuotaRebalance(scores)
```

One upkeep registration on Chainlink → one contract → multiple task types.

---

## 1. Interface File

Create `contracts/interfaces/IAutomationCompatible.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata checkData)
        external
        returns (bool upkeepNeeded, bytes memory performData);

    function performUpkeep(bytes calldata performData) external;
}
```

---

## 2. TavernAutomationRouter.sol

Location: `contracts/TavernAutomationRouter.sol`

### 2.1 Imports & State

```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IAutomationCompatible.sol";
```

Roles:
- `DEFAULT_ADMIN_ROLE` — deployer
- `ADMIN_ROLE` — configuration changes
- `KEEPER_ROLE` — Chainlink forwarder (calls `performUpkeep`)

State variables:
- `address public escrow;` (TavernEscrow)
- `address public registry;` (TavernRegistry)
- `uint256 public scanBatchSize;` — max quests to scan per checkUpkeep call (default: 50)
- `uint256 public lastScanCursor;` — resume point for quest scanning
- `uint256 public lastQuotaRebalanceAt;` — timestamp of last dailyQuotaRebalance execution
- `uint256 public quotaRebalanceInterval;` — seconds between rebalances (default: 24 hours = 86400)
- `uint256 public feeStageCheckInterval;` — seconds between fee stage checks (default: 1 hours = 3600)
- `uint256 public lastFeeStageCheckAt;`

### 2.2 Task Enum

```solidity
enum TaskType {
    None,           // 0 — no work
    ExecuteTimeout, // 1
    AutoApprove,    // 2
    FeeStageCheck,  // 3
    QuotaRebalance  // 4
}
```

### 2.3 Escrow Interface (local)

Declare a minimal interface for calling TavernEscrow:

```solidity
interface ITavernEscrowAutomation {
    function quests(uint256 questId) external view returns (
        uint256 questId_,
        address client,
        address agent,
        address currency,
        uint256 depositAmount,
        uint8 state,
        uint256 createdAt,
        uint256 fundedAt,
        uint256 acceptedAt,
        uint256 submittedAt,
        uint256 resultViewedAt,
        uint256 evaluatedAt,
        uint8[5] memory evalScores,
        bool compensated,
        uint256 tvrnUnlockTime
    );

    function nextQuestId() external view returns (uint256);
    function executeTimeout(uint256 questId) external;
    function executeAutoApprove(uint256 questId) external;
    function checkAndUpgradeFeeStage() external returns (uint256);
    function previewFeeStage() external view returns (uint256);
    function currentFeeStage() external view returns (uint256);
}
```

Note: `state` field comes back as `uint8` from the auto-generated getter. Map to:
- `2` = Accepted, `3` = InProgress → timeout candidates
- `4` = Submitted → auto-approve candidates

Constants from TavernEscrow (duplicate here):
- `SUBMISSION_TIMEOUT = 48 hours`
- `AUTO_APPROVE_DELAY = 72 hours`

### 2.4 Registry Interface (local)

```solidity
interface ITavernRegistryAutomation {
    function dailyQuotaRebalance(uint256[6] calldata todayScores) external;
}
```

### 2.5 checkUpkeep Implementation

```solidity
function checkUpkeep(bytes calldata /* checkData */)
    external
    view
    override
    returns (bool upkeepNeeded, bytes memory performData)
{
    // Priority 1: scan for timed-out quests
    (bool found, uint256 questId) = _findTimeoutCandidate();
    if (found) {
        return (true, abi.encode(TaskType.ExecuteTimeout, questId));
    }

    // Priority 2: scan for auto-approve quests
    (found, questId) = _findAutoApproveCandidate();
    if (found) {
        return (true, abi.encode(TaskType.AutoApprove, questId));
    }

    // Priority 3: fee stage upgrade
    if (_shouldCheckFeeStage()) {
        if (_feeStageCanUpgrade()) {
            return (true, abi.encode(TaskType.FeeStageCheck, uint256(0)));
        }
    }

    // Priority 4: quota rebalance (time-gated)
    if (_shouldRebalanceQuota()) {
        return (true, abi.encode(TaskType.QuotaRebalance, uint256(0)));
    }

    return (false, "");
}
```

**Important**: `checkUpkeep` must be `view` (or at least callable as view by Chainlink off-chain simulation). All helper functions `_find*` and `_should*` must be `view`/`pure`.

### 2.6 performUpkeep Implementation

```solidity
function performUpkeep(bytes calldata performData) external override {
    require(
        hasRole(KEEPER_ROLE, msg.sender) ||
        hasRole(ADMIN_ROLE, msg.sender) ||
        hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
        "Not keeper"
    );

    (TaskType taskType, uint256 param) = abi.decode(performData, (TaskType, uint256));

    if (taskType == TaskType.ExecuteTimeout) {
        ITavernEscrowAutomation(escrow).executeTimeout(param);
    } else if (taskType == TaskType.AutoApprove) {
        ITavernEscrowAutomation(escrow).executeAutoApprove(param);
    } else if (taskType == TaskType.FeeStageCheck) {
        ITavernEscrowAutomation(escrow).checkAndUpgradeFeeStage();
        lastFeeStageCheckAt = block.timestamp;
    } else if (taskType == TaskType.QuotaRebalance) {
        _executeQuotaRebalance();
        lastQuotaRebalanceAt = block.timestamp;
    } else {
        revert("Unknown task type");
    }
}
```

### 2.7 Quest Scanning Helpers

```solidity
function _findTimeoutCandidate() internal view returns (bool found, uint256 questId) {
    uint256 maxId = ITavernEscrowAutomation(escrow).nextQuestId();
    uint256 start = lastScanCursor > 0 ? lastScanCursor : 1;
    uint256 end = start + scanBatchSize;
    if (end > maxId) end = maxId;

    for (uint256 i = start; i <= end; i++) {
        (,,,, , uint8 state,, , uint256 acceptedAt,,,,,,) =
            ITavernEscrowAutomation(escrow).quests(i);
        // state 2 = Accepted, 3 = InProgress
        if ((state == 2 || state == 3) && block.timestamp > acceptedAt + 48 hours) {
            return (true, i);
        }
    }

    // Wrap around if we hit the end
    if (end >= maxId && start > 1) {
        for (uint256 i = 1; i < start && i <= maxId; i++) {
            (,,,, , uint8 state,, , uint256 acceptedAt,,,,,,) =
                ITavernEscrowAutomation(escrow).quests(i);
            if ((state == 2 || state == 3) && block.timestamp > acceptedAt + 48 hours) {
                return (true, i);
            }
        }
    }

    return (false, 0);
}

function _findAutoApproveCandidate() internal view returns (bool found, uint256 questId) {
    uint256 maxId = ITavernEscrowAutomation(escrow).nextQuestId();
    uint256 start = lastScanCursor > 0 ? lastScanCursor : 1;
    uint256 end = start + scanBatchSize;
    if (end > maxId) end = maxId;

    for (uint256 i = start; i <= end; i++) {
        (,,,, , uint8 state,,,, uint256 submittedAt,,,,, ) =
            ITavernEscrowAutomation(escrow).quests(i);
        // state 4 = Submitted
        if (state == 4 && block.timestamp > submittedAt + 72 hours) {
            return (true, i);
        }
    }

    if (end >= maxId && start > 1) {
        for (uint256 i = 1; i < start && i <= maxId; i++) {
            (,,,, , uint8 state,,,, uint256 submittedAt,,,,, ) =
                ITavernEscrowAutomation(escrow).quests(i);
            if (state == 4 && block.timestamp > submittedAt + 72 hours) {
                return (true, i);
            }
        }
    }

    return (false, 0);
}
```

**After each `performUpkeep` execution for timeout/autoApprove**, advance `lastScanCursor`:
```solidity
// Inside performUpkeep, after executeTimeout or executeAutoApprove:
lastScanCursor = param + 1;
uint256 maxId = ITavernEscrowAutomation(escrow).nextQuestId();
if (lastScanCursor > maxId) lastScanCursor = 1;
```

### 2.8 Quota Rebalance

The `dailyQuotaRebalance(uint256[6])` on TavernRegistry needs off-chain computed scores. Two options:

**Option A (implement this):** Store placeholder scores on-chain, updatable by ADMIN_ROLE. The router reads them and passes to registry.

```solidity
uint256[6] public pendingQuotaScores;

function setPendingQuotaScores(uint256[6] calldata scores) external onlyRole(ADMIN_ROLE) {
    pendingQuotaScores = scores;
}

function _executeQuotaRebalance() internal {
    ITavernRegistryAutomation(registry).dailyQuotaRebalance(pendingQuotaScores);
}

function _shouldRebalanceQuota() internal view returns (bool) {
    return block.timestamp >= lastQuotaRebalanceAt + quotaRebalanceInterval;
}
```

This allows an off-chain service (or Boss) to set scores, then Chainlink triggers the actual rebalance on schedule. Phase 3 can replace with a true on-chain oracle feed.

### 2.9 Fee Stage Helper

```solidity
function _shouldCheckFeeStage() internal view returns (bool) {
    return block.timestamp >= lastFeeStageCheckAt + feeStageCheckInterval;
}

function _feeStageCanUpgrade() internal view returns (bool) {
    uint256 current = ITavernEscrowAutomation(escrow).currentFeeStage();
    uint256 preview = ITavernEscrowAutomation(escrow).previewFeeStage();
    return preview > current;
}
```

### 2.10 Admin Functions

```solidity
function setEscrow(address _escrow) external onlyRole(ADMIN_ROLE);
function setRegistry(address _registry) external onlyRole(ADMIN_ROLE);
function setScanBatchSize(uint256 _size) external onlyRole(ADMIN_ROLE);
function setQuotaRebalanceInterval(uint256 _interval) external onlyRole(ADMIN_ROLE);
function setFeeStageCheckInterval(uint256 _interval) external onlyRole(ADMIN_ROLE);
function resetScanCursor(uint256 _cursor) external onlyRole(ADMIN_ROLE);
```

### 2.11 Events

```solidity
event TaskExecuted(TaskType indexed taskType, uint256 param, uint256 timestamp);
event ScanCursorAdvanced(uint256 newCursor);
event ConfigUpdated(string field, uint256 value);
```

Emit `TaskExecuted` at the end of each `performUpkeep` branch.

### 2.12 Constructor

```solidity
constructor(address _escrow, address _registry) {
    require(_escrow != address(0), "Escrow zero");
    require(_registry != address(0), "Registry zero");
    escrow = _escrow;
    registry = _registry;
    scanBatchSize = 50;
    quotaRebalanceInterval = 86400; // 24h
    feeStageCheckInterval = 3600;   // 1h

    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _grantRole(ADMIN_ROLE, msg.sender);
    _grantRole(KEEPER_ROLE, msg.sender);
}
```

---

## 3. KEEPER_ROLE on Escrow and Registry

The router needs `KEEPER_ROLE` on both `TavernEscrow` and `TavernRegistry` so it can call `executeTimeout`, `executeAutoApprove`, `checkAndUpgradeFeeStage`, and `dailyQuotaRebalance`.

This is a **deployment-time** concern. Document it; don't wire it in code yet (no live deploy).

---

## 4. Deploy Script

Create `deploy/06_deploy_automation_router.ts`:

- Deploys `TavernAutomationRouter` with current Escrow + Registry addresses from manifest
- Grants `KEEPER_ROLE` to router on both Escrow and Registry
- Verifies on Basescan
- Updates `deployments/baseSepolia.json` with `tavernAutomationRouter` address
- Updates `claw-tavern-app.html` CONFIG if `tavernAutomationRouter` key exists

Pattern: same as `deploy/05_deploy_governance.ts` — idempotent, manifest-based, local-validation output for Hardhat runs.

---

## 5. Update TavernImports.sol

Add `import "./TavernAutomationRouter.sol";` so Hardhat compiles it.

---

## 6. Update register-automation.ts

After router is deployed, the script's upkeep definitions should point at the **router address** as the single upkeep target, not at Escrow/Registry directly. Add a conditional block:

```typescript
// If router is deployed, register a single upkeep pointing at the router
const routerAddress = deployment.addresses.tavernAutomationRouter;
if (routerAddress && routerAddress !== ZERO_ADDRESS) {
    // Single upkeep: name="tavernAutomationRouter", target=routerAddress
    // triggerType: conditional (0), gasLimit: 1_000_000
    // checkData: "0x"
}
```

Keep the old 3-upkeep path as fallback when router is not deployed.

---

## 7. Tests

Create `test/TavernAutomationRouter.test.ts`:

### 7.1 Unit Tests

1. **checkUpkeep returns false when no quests exist**
2. **checkUpkeep finds timeout candidate** — create quest, fund, accept, warp past 48h, assert `checkUpkeep` returns `(true, abi.encode(ExecuteTimeout, questId))`
3. **performUpkeep executes timeout** — call `performUpkeep` with encoded timeout data, verify quest state is `TimedOut`
4. **checkUpkeep finds auto-approve candidate** — create quest, fund, accept, submit, warp past 72h, assert returns `AutoApprove`
5. **performUpkeep executes auto-approve** — verify quest state is `AutoApproved`
6. **Fee stage check** — set up enough clients/agents to trigger stage upgrade, warp past interval, assert `FeeStageCheck` returned
7. **Quota rebalance** — set `pendingQuotaScores`, warp past 24h, verify `QuotaRebalance` returned and executed
8. **KEEPER_ROLE enforcement** — non-keeper calling `performUpkeep` reverts
9. **Scan cursor advancement** — after executing timeout on quest N, cursor advances to N+1
10. **Batch size limit** — with 100 quests and batchSize=10, only first 10 scanned

### 7.2 Integration

- Deploy full stack (Token, Registry, Escrow, Staking, Router)
- Grant router `KEEPER_ROLE` on Escrow and Registry
- Run through a quest lifecycle and verify automation catches timeout/auto-approve

---

## 8. Checklist

### Contract

- [ ] `contracts/interfaces/IAutomationCompatible.sol` created
- [ ] `contracts/TavernAutomationRouter.sol` created
- [ ] Implements `AutomationCompatibleInterface`
- [ ] `TaskType` enum: None, ExecuteTimeout, AutoApprove, FeeStageCheck, QuotaRebalance
- [ ] `checkUpkeep` is `view`, returns `(bool, bytes)`
- [ ] `performUpkeep` requires `KEEPER_ROLE`
- [ ] `_findTimeoutCandidate()` scans quests in state 2/3 past 48h
- [ ] `_findAutoApproveCandidate()` scans quests in state 4 past 72h
- [ ] `_feeStageCanUpgrade()` compares `previewFeeStage()` vs `currentFeeStage()`
- [ ] `_shouldRebalanceQuota()` time-gated by `quotaRebalanceInterval`
- [ ] `pendingQuotaScores` + `setPendingQuotaScores()` for off-chain score injection
- [ ] `lastScanCursor` advances after each timeout/autoApprove execution
- [ ] Wrap-around logic when cursor exceeds `nextQuestId`
- [ ] `TaskExecuted` event emitted for every `performUpkeep`
- [ ] All admin setters (`setEscrow`, `setRegistry`, `setScanBatchSize`, etc.) gated by `ADMIN_ROLE`
- [ ] Constructor validates non-zero addresses and sets defaults

### Infrastructure

- [ ] `TavernImports.sol` updated
- [ ] `deploy/06_deploy_automation_router.ts` created
- [ ] Deploy script grants `KEEPER_ROLE` to router on Escrow + Registry
- [ ] Deploy script updates `deployments/baseSepolia.json`
- [ ] `register-automation.ts` updated with router-aware single-upkeep path
- [ ] Old 3-upkeep path kept as fallback

### Tests

- [ ] `test/TavernAutomationRouter.test.ts` created
- [ ] Timeout detection + execution test
- [ ] Auto-approve detection + execution test
- [ ] Fee stage check test
- [ ] Quota rebalance test
- [ ] KEEPER_ROLE enforcement test
- [ ] Scan cursor advancement test
- [ ] Batch size limit test
- [ ] Full integration test (Token → Registry → Escrow → Staking → Router)

### Validation

- [ ] `npm run compile` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes (all new + existing tests)
- [ ] No live deploy (code-only, Path A)

### HANDOFF

- [ ] `HANDOFF_RESUME.md` updated with "What Changed In Task 14" section
- [ ] `deployments/baseSepolia.json` updated with `tavernAutomationRouter: null` placeholder
- [ ] `claw-tavern-app.html` CONFIG updated with `tavernAutomationRouter: "0x0000000000000000000000000000000000000000"` placeholder

---

## Phase 3 Notes (DO NOT implement now)

- Replace `pendingQuotaScores` with Chainlink Functions or on-chain oracle for real-time score computation
- Add `StreamsLookupCompatibleInterface` for Chainlink Data Streams integration
- Consider separate upkeeps per task type if gas costs become a bottleneck
- Log-trigger upkeeps for event-driven automation (e.g., trigger timeout check on `QuestAccepted` event + 48h delay)
