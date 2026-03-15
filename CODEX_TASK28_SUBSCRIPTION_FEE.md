# Task 28 — M8: Exclusive Subscription Fee (5%)

> References: `MASTER_ROADMAP.md` lines 264, 399–421, 648, 1239, 1930
> Difficulty: MEDIUM — new contract + Escrow integration
> Prerequisite: Task 27 complete, 81 tests + 29 fuzz passing

---

## Objective

Implement the **Exclusive Subscription** system — clients can subscribe to a dedicated agent on a monthly basis. The subscription costs USDC (or ETH), and a **5% fee** is deducted from each subscription payment and routed to the **operator pool** (same pool as quest fees). This resolves **M8** from the gap analysis.

**Key MASTER_ROADMAP requirements:**
- Subscription fee: **5%** (constant, all fee stages)
- Fee destination: **operator pool (USDC)**
- Subscribers get: unlimited help-desk access, EXP +100/month, subscription discount eligibility
- Subscription is **monthly**, auto-renewable or manually renewed

---

## Part 1: New Contract — `contracts/TavernSubscription.sol`

Create `contracts/TavernSubscription.sol` with OpenZeppelin 5.x (AccessControl, ReentrancyGuard).

### 1-A. Constants & State

```solidity
// --- Fee ---
uint256 public constant SUBSCRIPTION_FEE_BPS = 500; // 5%
uint256 public constant BPS_DENOMINATOR = 10000;

// --- Duration ---
uint256 public constant SUBSCRIPTION_PERIOD = 30 days;

// --- Roles ---
bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

// --- External refs ---
IERC20 public immutable usdc;
address public immutable escrow;        // fee forwarding target
ITavernClientRPG public clientRPG;      // EXP grant on renewal
ITavernRegistry public registry;        // agent status check

// --- Subscription state ---
struct Subscription {
    address client;
    address agent;
    uint256 monthlyRateUsdc;     // USDC amount per month (set by agent)
    uint256 currentPeriodStart;
    uint256 currentPeriodEnd;
    bool    active;
    bool    cancelledByClient;
}

uint256 public nextSubscriptionId;
mapping(uint256 => Subscription) public subscriptions;

// client => agent => subscriptionId (latest)
mapping(address => mapping(address => uint256)) public clientAgentSub;

// agent => monthly rate (agent sets their own price)
mapping(address => uint256) public agentMonthlyRate;
uint256 public constant MIN_MONTHLY_RATE = 10 * 1e6;   // min 10 USDC
uint256 public constant MAX_MONTHLY_RATE = 10000 * 1e6; // max 10,000 USDC

// Fee accounting
uint256 public accumulatedFees;  // USDC fees pending withdrawal
```

### 1-B. Agent Rate Setting

```solidity
function setAgentMonthlyRate(uint256 rateUsdc) external {
    require(registry.isActiveAgent(msg.sender), "Not active agent");
    require(rateUsdc >= MIN_MONTHLY_RATE && rateUsdc <= MAX_MONTHLY_RATE, "Rate out of range");
    agentMonthlyRate[msg.sender] = rateUsdc;
    emit AgentRateSet(msg.sender, rateUsdc);
}
```

### 1-C. Subscribe

```solidity
function subscribe(address agent) external nonReentrant {
    uint256 rate = agentMonthlyRate[agent];
    require(rate > 0, "Agent has no rate");
    require(registry.isActiveAgent(agent), "Agent not active");

    // Calculate fee
    uint256 fee = (rate * SUBSCRIPTION_FEE_BPS) / BPS_DENOMINATOR;
    uint256 agentPayment = rate - fee;

    // Transfer USDC from client
    usdc.safeTransferFrom(msg.sender, address(this), rate);

    // Pay agent
    usdc.safeTransfer(agent, agentPayment);

    // Accumulate fee for operator pool
    accumulatedFees += fee;

    // Create or renew subscription
    uint256 subId = clientAgentSub[msg.sender][agent];
    if (subId == 0 || !subscriptions[subId].active) {
        // New subscription
        nextSubscriptionId++;
        subId = nextSubscriptionId;
        subscriptions[subId] = Subscription({
            client: msg.sender,
            agent: agent,
            monthlyRateUsdc: rate,
            currentPeriodStart: block.timestamp,
            currentPeriodEnd: block.timestamp + SUBSCRIPTION_PERIOD,
            active: true,
            cancelledByClient: false
        });
        clientAgentSub[msg.sender][agent] = subId;
        emit Subscribed(subId, msg.sender, agent, rate);
    } else {
        // Renew existing
        Subscription storage sub = subscriptions[subId];
        sub.monthlyRateUsdc = rate;
        sub.currentPeriodStart = block.timestamp;
        sub.currentPeriodEnd = block.timestamp + SUBSCRIPTION_PERIOD;
        sub.cancelledByClient = false;
        emit SubscriptionRenewed(subId, msg.sender, agent, rate);
    }

    // Grant EXP via RPG (subscription maintenance = +100 EXP)
    if (address(clientRPG) != address(0)) {
        clientRPG.grantSubscriptionEXP(msg.sender);
    }
}
```

### 1-D. Cancel

```solidity
function cancelSubscription(uint256 subId) external {
    Subscription storage sub = subscriptions[subId];
    require(sub.client == msg.sender, "Not your subscription");
    require(sub.active, "Already inactive");

    sub.cancelledByClient = true;
    // Subscription remains active until currentPeriodEnd
    // It simply won't auto-renew
    emit SubscriptionCancelled(subId, msg.sender, sub.agent);
}
```

### 1-E. Expiry Check (Automation)

```solidity
function isSubscriptionActive(address client, address agent) external view returns (bool) {
    uint256 subId = clientAgentSub[client][agent];
    if (subId == 0) return false;
    Subscription storage sub = subscriptions[subId];
    return sub.active && block.timestamp <= sub.currentPeriodEnd;
}

// Called by automation to mark expired subscriptions
function expireSubscription(uint256 subId) external onlyRole(KEEPER_ROLE) {
    Subscription storage sub = subscriptions[subId];
    require(sub.active, "Already inactive");
    require(block.timestamp > sub.currentPeriodEnd, "Not expired yet");

    sub.active = false;
    emit SubscriptionExpired(subId, sub.client, sub.agent);
}
```

### 1-F. Fee Withdrawal (to Escrow operator pool)

```solidity
function flushFeesToEscrow() external onlyRole(KEEPER_ROLE) {
    uint256 amount = accumulatedFees;
    require(amount > 0, "No fees to flush");
    accumulatedFees = 0;

    usdc.safeTransfer(escrow, amount);
    // Escrow should have a function to receive and attribute to operator pool
    emit FeeFlushed(amount, escrow);
}
```

### 1-G. Events

```solidity
event AgentRateSet(address indexed agent, uint256 rateUsdc);
event Subscribed(uint256 indexed subId, address indexed client, address indexed agent, uint256 rateUsdc);
event SubscriptionRenewed(uint256 indexed subId, address indexed client, address indexed agent, uint256 rateUsdc);
event SubscriptionCancelled(uint256 indexed subId, address indexed client, address indexed agent);
event SubscriptionExpired(uint256 indexed subId, address indexed client, address indexed agent);
event FeeFlushed(uint256 amount, address indexed escrow);
```

### 1-H. Constructor

```solidity
constructor(address _usdc, address _escrow, address _registry) {
    usdc = IERC20(_usdc);
    escrow = _escrow;
    registry = ITavernRegistry(_registry);
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
}

function setClientRPG(address _rpg) external onlyRole(DEFAULT_ADMIN_ROLE) {
    clientRPG = ITavernClientRPG(_rpg);
}
```

---

## Part 2: TavernClientRPG Integration

### 2-A. Add Subscription EXP Function

In `TavernClientRPG.sol`, add:

```solidity
bytes32 public constant SUBSCRIPTION_ROLE = keccak256("SUBSCRIPTION_ROLE");

function grantSubscriptionEXP(address client) external onlyRole(SUBSCRIPTION_ROLE) {
    _migrateSeasonIfNeeded(client);
    _addEXP(client, EXP_SUBSCRIPTION);
}
```

Grant `SUBSCRIPTION_ROLE` to TavernSubscription contract during deployment.

---

## Part 3: TavernEscrow Integration

### 3-A. Receive Subscription Fees

Add a function for TavernSubscription to flush fees into the operator pool:

```solidity
function receiveSubscriptionFees(uint256 amount) external nonReentrant {
    require(msg.sender == address(subscriptionContract), "Only subscription");
    // The USDC is already transferred to this contract by the caller
    operatorPoolUsdc += amount;
    emit SubscriptionFeesReceived(amount);
}

ITavernSubscription public subscriptionContract;

function setSubscriptionContract(address _sub) external onlyRole(DEFAULT_ADMIN_ROLE) {
    subscriptionContract = ITavernSubscription(_sub);
    emit SubscriptionContractSet(_sub);
}
```

**Alternative (simpler):** If Escrow code size is still a concern, the Subscription contract can hold fees and the admin withdraws them to the operator wallet directly. In that case, `flushFeesToEscrow()` sends USDC to a configurable `operatorWallet` address instead of Escrow. Choose whichever approach avoids Escrow code size issues.

---

## Part 4: TavernAutomationRouter Integration

### 4-A. Add Subscription Expiry Task

Add `TaskType.SubscriptionExpiry` to the enum:

```solidity
enum TaskType {
    None,
    ExecuteTimeout,
    AutoApprove,
    FeeStageCheck,
    QuotaRebalance,
    PriceRefresh,
    MasterSettle,
    MonthlyEjection,
    SeasonReset,
    SubscriptionExpiry    // NEW
}
```

### 4-B. Expiry Check in `checkUpkeep()`

```solidity
ITavernSubscription public subscriptionContract;

// Check for expired subscriptions (batch approach)
// The router can maintain a list of active subscription IDs to check,
// or the Subscription contract can expose a `getExpiredSubscriptions()` view
```

**Recommended approach:** Keep subscription expiry checking simple. The Subscription contract can expose `pendingExpiries()` that returns up to N subscription IDs past their `currentPeriodEnd`. The router calls `expireSubscription()` on each.

### 4-C. Fee Flush in Automation

Add periodic fee flushing (e.g., weekly):

```solidity
uint256 public lastFeeFlushAt;
uint256 public constant FEE_FLUSH_INTERVAL = 7 days;

// In checkUpkeep:
if (address(subscriptionContract) != address(0) &&
    block.timestamp >= lastFeeFlushAt + FEE_FLUSH_INTERVAL &&
    subscriptionContract.accumulatedFees() > 0) {
    return (true, abi.encode(TaskType.SubscriptionExpiry));
}

// In performUpkeep:
if (taskType == TaskType.SubscriptionExpiry) {
    subscriptionContract.flushFeesToEscrow();
    lastFeeFlushAt = block.timestamp;
    // Also expire any pending subscriptions
}
```

---

## Part 5: Interface

Create `contracts/interfaces/ITavernSubscription.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITavernSubscription {
    function isSubscriptionActive(address client, address agent) external view returns (bool);
    function accumulatedFees() external view returns (uint256);
    function flushFeesToEscrow() external;
    function expireSubscription(uint256 subId) external;
}
```

---

## Part 6: Deploy Script

### 6-A. Create `deploy/10_deploy_subscription.ts`

Deploy order:
1. Deploy `TavernSubscription(usdc, escrow, registry)`
2. Call `subscription.setClientRPG(rpg.address)`
3. Grant `KEEPER_ROLE` on TavernSubscription to AutomationRouter
4. Grant `SUBSCRIPTION_ROLE` on TavernClientRPG to TavernSubscription
5. Call `escrow.setSubscriptionContract(subscription.address)` (if using Escrow integration)
6. Call `router.setSubscriptionContract(subscription.address)`
7. Verify on BaseScan

---

## Part 7: Tests

### 7-A. `test/TavernSubscription.test.ts`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Agent sets monthly rate | agentMonthlyRate stored, event emitted |
| 2 | Agent rate below MIN reverts | "Rate out of range" |
| 3 | Agent rate above MAX reverts | "Rate out of range" |
| 4 | Non-active agent cannot set rate | "Not active agent" |
| 5 | Client subscribes successfully | USDC transferred, sub created, 5% fee deducted |
| 6 | Subscription fee calculation: 100 USDC → 5 fee, 95 to agent | Exact amounts |
| 7 | Client renews existing subscription | currentPeriodEnd extended |
| 8 | Client cancels subscription | cancelledByClient = true, still active until period end |
| 9 | Expired subscription: isSubscriptionActive returns false | block.timestamp > periodEnd |
| 10 | Keeper expires subscription | active = false, event emitted |
| 11 | Keeper cannot expire non-expired subscription | "Not expired yet" |
| 12 | flushFeesToEscrow transfers accumulated fees | accumulatedFees → 0, USDC transferred |
| 13 | Subscription grants +100 EXP via RPG | grantSubscriptionEXP called |
| 14 | Multiple subscriptions to different agents | Each tracked independently |

### 7-B. Integration with Existing Tests

Ensure all existing 81 tests still pass after Escrow/Router changes.

---

## Part 8: Documentation

1. `GAP_ANALYSIS_MASTER_VS_CODE.md` — Change M8 from DEFERRED to RESOLVED
2. `HANDOFF_RESUME.md` — Add Task 28 entry
3. `DEPLOY_GUIDE.md` — Add TavernSubscription deployment section

---

## Completion Checklist

```
[ ] contracts/TavernSubscription.sol created (1-A through 1-H)
[ ] contracts/interfaces/ITavernSubscription.sol created
[ ] TavernClientRPG.sol: SUBSCRIPTION_ROLE + grantSubscriptionEXP()
[ ] TavernEscrow.sol: receiveSubscriptionFees() + setSubscriptionContract() (or simpler operator wallet approach)
[ ] TavernAutomationRouter.sol: TaskType.SubscriptionExpiry + setSubscriptionContract()
[ ] deploy/10_deploy_subscription.ts created
[ ] test/TavernSubscription.test.ts — 14 tests passing
[ ] All existing tests still pass (81+)
[ ] Foundry fuzz still pass (29)
[ ] npx tsc --noEmit clean
[ ] npx hardhat compile clean
[ ] GAP_ANALYSIS updated (M8 → RESOLVED)
[ ] HANDOFF_RESUME.md updated
```

---

## Security Notes

1. **USDC approval**: Clients must `approve()` the Subscription contract before calling `subscribe()`. Frontend must handle this.
2. **Rate manipulation**: Agent can change rate between client's approval and subscription tx. Consider adding a `maxRate` parameter to `subscribe()` for slippage protection.
3. **Fee accounting**: `accumulatedFees` must be exact — no rounding errors. Use SafeMath patterns.
4. **Reentrancy**: All external USDC transfers wrapped in `nonReentrant`.
5. **No refunds**: Cancellation does not refund remaining period. This is by design (monthly granularity).
