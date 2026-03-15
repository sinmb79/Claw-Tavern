# Task 23 — Security Hardening + Governance Wiring + Precision Tests

> References: `CODEX_TASK22_TOKENOMICS_REALIGN.md` Fix 7, `GAP_ANALYSIS_MASTER_VS_CODE.md`
> Difficulty: Medium (extend existing contracts + deploy script changes + new tests)
> Prerequisite: Task 22 complete

---

## Objective

Resolve 3 HIGH + 1 MEDIUM issues identified in the Task 22 code review:
1. AdminPriceFeed automated refresh (HIGH)
2. TavernEscrow emergency settlement pause + deposit cap (HIGH)
3. Governance GOVERNANCE_ROLE wiring (HIGH)
4. USDC/ETH decimal precision boundary tests (MEDIUM)

**NOTE:** AdminPriceFeed.sol Fix 1-A is ALREADY IMPLEMENTED. The `isRefresher` mapping, `setRefresher()`, `RefresherUpdated` event, and updated `refreshPrice()` are already in place. Codex should verify these exist and skip to Fix 1-B.

---

## Fix 1: AdminPriceFeed Automated Refresh

### 1-A. AdminPriceFeed.sol — Refresher Authorization (ALREADY DONE)

The following changes are already applied to `contracts/AdminPriceFeed.sol`. **Verify only, do not re-implement:**

```solidity
mapping(address => bool) public isRefresher;

event RefresherUpdated(address indexed addr, bool enabled);

function setRefresher(address addr, bool enabled) external onlyOwner {
    isRefresher[addr] = enabled;
    emit RefresherUpdated(addr, enabled);
}

function refreshPrice() external {
    require(msg.sender == owner() || isRefresher[msg.sender], "Not authorized");
    _recordPrice(rounds[latestRoundId].answer);
}
```

`updatePrice()` remains `onlyOwner` (price changes are owner-only).

### 1-B. TavernAutomationRouter.sol — Add PriceRefresh TaskType

Extend the TaskType enum:
```solidity
enum TaskType {
    None,
    ExecuteTimeout,
    AutoApprove,
    FeeStageCheck,
    QuotaRebalance,
    PriceRefresh      // NEW
}
```

Add state variables:
```solidity
address public priceFeed;              // AdminPriceFeed address
uint256 public priceRefreshThreshold;  // Staleness trigger (default 50 min = 3000s)
```

Add interface:
```solidity
interface IAdminPriceFeed {
    function latestRoundData() external view returns (
        uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound
    );
    function refreshPrice() external;
}
```

Add PriceRefresh check to `checkUpkeep()` (after QuotaRebalance, lowest priority):
```solidity
if (_shouldRefreshPrice()) {
    return (true, abi.encode(TaskType.PriceRefresh, uint256(0)));
}
```

Add PriceRefresh handler to `performUpkeep()`:
```solidity
} else if (taskType == TaskType.PriceRefresh) {
    IAdminPriceFeed(priceFeed).refreshPrice();
}
```

Helper function:
```solidity
function _shouldRefreshPrice() internal view returns (bool) {
    if (priceFeed == address(0)) return false;
    (, , , uint256 updatedAt, ) = IAdminPriceFeed(priceFeed).latestRoundData();
    return block.timestamp > updatedAt + priceRefreshThreshold;
}
```

Admin setters:
```solidity
function setPriceFeed(address _priceFeed) external onlyRole(ADMIN_ROLE) {
    priceFeed = _priceFeed;
    emit AddressConfigUpdated("priceFeed", _priceFeed);
}

function setPriceRefreshThreshold(uint256 _threshold) external onlyRole(ADMIN_ROLE) {
    require(_threshold > 0, "Threshold zero");
    priceRefreshThreshold = _threshold;
    emit ConfigUpdated("priceRefreshThreshold", _threshold);
}
```

Update constructor to accept `_priceFeed`:
```solidity
constructor(address _escrow, address _registry, address _priceFeed) {
    // ... existing requires ...
    priceFeed = _priceFeed;      // address(0) allowed — can set later
    priceRefreshThreshold = 50 minutes;
    // ... rest unchanged ...
}
```

---

## Fix 2: TavernEscrow Emergency Settlement Pause + Deposit Cap

### 2-A. Quest Deposit Cap

```solidity
// Add to TavernEscrow.sol

uint256 public maxQuestDeposit = 100 ether; // Initial ETH cap

event MaxQuestDepositUpdated(uint256 newMax);

function setMaxQuestDeposit(uint256 newMax) external onlyRole(ADMIN_ROLE) {
    require(newMax > 0, "Max zero");
    maxQuestDeposit = newMax;
    emit MaxQuestDepositUpdated(newMax);
}
```

Add validation to `createQuest()`:
```solidity
// After "require(depositAmount > 0)" add:
require(depositAmount <= maxQuestDeposit, "Exceeds max deposit");
```

**Note on USDC:** Since USDC uses 6 decimals, `100 ether = 100e18` is effectively unlimited for USDC. If separate USDC cap is desired:
```solidity
uint256 public maxQuestDepositUsdc = 100_000 * 1e6; // $100k USDC

// In createQuest:
if (currency == address(0)) {
    require(depositAmount <= maxQuestDeposit, "Exceeds ETH max");
} else {
    require(depositAmount <= maxQuestDepositUsdc, "Exceeds USDC max");
}
```

Choose either approach and apply consistently.

### 2-B. Settlement Emergency Pause

```solidity
// Add to TavernEscrow.sol

bool public settlementPaused;

event SettlementPauseToggled(bool paused);

modifier whenSettlementActive() {
    require(!settlementPaused, "Settlements paused");
    _;
}

function setSettlementPaused(bool paused) external onlyRole(ADMIN_ROLE) {
    settlementPaused = paused;
    emit SettlementPauseToggled(paused);
}
```

Apply `whenSettlementActive` modifier to these functions (append after existing modifiers):
```
evaluateQuest()      → add whenSettlementActive
executeAutoApprove() → add whenSettlementActive
executeTimeout()     → add whenSettlementActive
```

Example:
```solidity
function evaluateQuest(...) external ... whenSettlementActive {
```

---

## Fix 3: Governance GOVERNANCE_ROLE Wiring

### 3-A. TavernEscrow — GOVERNANCE_ROLE + Fee Stage Downgrade

```solidity
// Add to TavernEscrow.sol

bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

event FeeStageDowngraded(uint256 indexed stage, uint256 feeBps);

function governanceDowngradeFeeStage(uint256 newStage) external onlyRole(GOVERNANCE_ROLE) {
    require(newStage < currentFeeStage, "Not a downgrade");
    currentFeeStage = newStage;
    emit FeeStageDowngraded(newStage, feeRateBps[newStage]);
}
```

### 3-B. Deploy Script — Grant Governance Roles

Add to deploy script (or create a dedicated setup script) after all contracts are deployed:

```typescript
// Governance wiring
const GOVERNANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_ROLE"));

// Grant GOVERNANCE_ROLE on TavernToken to TavernGovernance
await tavernToken.grantRole(GOVERNANCE_ROLE, tavernGovernance.target);

// Grant GOVERNANCE_ROLE on TavernEscrow to TavernGovernance
await tavernEscrow.grantRole(GOVERNANCE_ROLE, tavernGovernance.target);

// Register AutomationRouter as refresher on AdminPriceFeed
await adminPriceFeed.setRefresher(tavernAutomationRouter.target, true);
```

**IMPORTANT:** TavernGovernance's `execute()` calls `proposal.target.call(proposal.callData)`, so `msg.sender` will be the TavernGovernance contract address. The TavernGovernance address itself must hold GOVERNANCE_ROLE on target contracts.

### 3-C. TavernAutomationRouter Constructor Change

Before:
```solidity
constructor(address _escrow, address _registry)
```

After:
```solidity
constructor(address _escrow, address _registry, address _priceFeed)
```

Update all deploy scripts that create TavernAutomationRouter to pass the additional argument.

---

## Fix 4: USDC/ETH Decimal Precision Boundary Tests

### test/TavernEscrow.precision.test.ts (NEW)

```
Test cases:

1. "micro USDC settlement precision"
   - 1 USDC (1e6) quest → 87% × 70% = 0.609 USDC → rounding error ≤ 1 wei(USDC)
   - agent payout + planning + verification + attendance + fee + remainder = depositAmount

2. "large USDC settlement sum"
   - 1,000,000 USDC (1e12) quest
   - all distribution amounts sum = depositAmount (within 1 wei)

3. "small ETH settlement"
   - 0.001 ETH (1e15 wei) quest → distribution sum = depositAmount

4. "large ETH settlement"
   - 100 ETH (100e18 wei) quest → distribution sum = depositAmount

5. "compensation 3-path consistency"
   - Timeout: tvrnAmount + creditAmountUsd18 + operatorAmount → verify against depositAmount ratios
   - UnviewedOneStar: same verification
   - LowScore: same verification

6. "boundary: depositAmount = 1 (minimum)"
   - does not revert, settles normally (zero payouts acceptable)

7. "boundary: depositAmount = type(uint128).max"
   - no overflow, settles correctly (Math.mulDiv should handle safely)

8. "unassigned planning/verification agents → surplus to servicePool"
   - planningAgent=address(0), verificationAgent=address(0)
   - 5% + 5% = 10% additional goes to servicePool
```

---

## Checklist

### AdminPriceFeed.sol (Fix 1-A) — VERIFY ONLY
- [ ] `isRefresher` mapping exists
- [ ] `setRefresher(address, bool)` onlyOwner exists
- [ ] `RefresherUpdated` event exists
- [ ] `refreshPrice()` uses `owner() || isRefresher[msg.sender]` guard
- [ ] `updatePrice()` remains onlyOwner (unchanged)

### TavernAutomationRouter.sol (Fix 1-B)
- [ ] `PriceRefresh` added to TaskType enum (5th entry)
- [ ] `priceFeed` state variable + `setPriceFeed()` added
- [ ] `priceRefreshThreshold` state variable (default 50 min) + `setPriceRefreshThreshold()` added
- [ ] Constructor accepts `_priceFeed` parameter
- [ ] `IAdminPriceFeed` interface added
- [ ] `checkUpkeep()` includes `_shouldRefreshPrice()` check
- [ ] `performUpkeep()` includes `PriceRefresh` handler
- [ ] `_shouldRefreshPrice()` helper implemented

### TavernEscrow.sol Security (Fix 2)
- [ ] `maxQuestDeposit` state variable + `setMaxQuestDeposit()` added
- [ ] `createQuest()` enforces `require(depositAmount <= maxQuestDeposit)`
- [ ] `settlementPaused` state variable + `setSettlementPaused()` added
- [ ] `whenSettlementActive` modifier implemented
- [ ] Modifier applied to `evaluateQuest()`, `executeAutoApprove()`, `executeTimeout()`
- [ ] `MaxQuestDepositUpdated`, `SettlementPauseToggled` events emitted

### TavernEscrow.sol Governance (Fix 3-A)
- [ ] `GOVERNANCE_ROLE` constant added
- [ ] `governanceDowngradeFeeStage()` implemented
- [ ] `FeeStageDowngraded` event emitted

### Deploy Scripts (Fix 3-B, 3-C)
- [ ] TavernAutomationRouter constructor updated with `_priceFeed` arg
- [ ] `TavernToken.grantRole(GOVERNANCE_ROLE, governance)` added
- [ ] `TavernEscrow.grantRole(GOVERNANCE_ROLE, governance)` added
- [ ] `AdminPriceFeed.setRefresher(automationRouter, true)` added

### Tests (Fix 4)
- [ ] test/TavernEscrow.precision.test.ts created
- [ ] Micro USDC (1e6) settlement sum verified
- [ ] Large USDC (1e12) settlement sum verified
- [ ] Small/large ETH range verified
- [ ] Compensation 3-path consistency verified
- [ ] Boundary (1, uint128.max) overflow safety verified
- [ ] Unassigned agent surplus → servicePool verified

### Existing Test Compatibility
- [ ] TavernAutomationRouter tests updated for constructor change
- [ ] `npx hardhat test` all PASS
- [ ] `node scripts/run-forge.js` fuzz PASS

### Documentation
- [ ] HANDOFF_RESUME.md updated with Task 23 entry

---

## Deferred to Phase 2 (NOT in this task)

- **7-D**: Fee stage governance downgrade → INCLUDED in Fix 3-A (governanceDowngradeFeeStage)
- **7-E**: Master agent emergency removal → Deferred until master agent system is fully implemented
- **7-G**: ETH transfer pattern → Already resolved (uses `call{value}`)
