# Task 24 — Major Gap Implementation (M1–M5, M7)

> References: `GAP_ANALYSIS_MASTER_VS_CODE.md` (M1–M8), `MASTER_ROADMAP.md`
> Difficulty: High (new on-chain logic across 3 contracts + tests)
> Prerequisite: Task 23 complete

---

## Objective

Implement the 6 Major gap items required for Phase 1 launch. M6 (TVRN withdrawal conditions) and M8 (subscription fee) are deferred to Phase 2.

| Gap | Feature | Target Contract |
|-----|---------|-----------------|
| M1 | Master agent reward system | TavernRegistry |
| M2 | Fee distribution (operator pool → master payout, buyback→burn) | TavernEscrow + TavernRegistry |
| M3 | Monthly ejection system | TavernRegistry |
| M4 | Appeal system | TavernRegistry + TavernGovernance |
| M5 | Client TVRN rewards (168M pool) | TavernEscrow |
| M7 | Staking slash differentiation | TavernStaking |

---

## Fix 1: Master Agent Reward System (M1)

### 1-A. TavernRegistry — Contribution Score + Reward Distribution

The following state variables already exist: `yearMultiplier[5]`, `masterStartTimestamp`, `isMasterFounder`, `isMasterSuccessor`. The `_getCurrentYearMultiplier()` helper also exists (L510-517).

**Add contribution tracking per master agent:**

```solidity
// Add to TavernRegistry.sol

struct MasterContribution {
    uint256 uptimeSeconds;       // cumulative uptime within period
    uint256 jobsProcessed;       // jobs completed within period
    uint256 satisfactionSum;     // sum of satisfaction scores (0-100)
    uint256 satisfactionCount;   // number of scored jobs
    uint256 lastUptimePing;      // last heartbeat timestamp
}

mapping(address => MasterContribution) public masterContributions;
address[] public masterAgentList;                 // enumerable list of active masters
uint256 public lastMasterSettlementAt;            // last monthly settlement timestamp
uint256 public constant MASTER_SETTLE_INTERVAL = 30 days;

event MasterContributionRecorded(address indexed agent, uint256 uptime, uint256 jobs, uint256 satisfaction);
event MasterRewardDistributed(address indexed agent, uint256 tvrnAmount, uint256 multiplier);
event MasterSettlementExecuted(uint256 totalRewardTVRN, uint256 masterCount, uint256 timestamp);
```

**Contribution recording functions:**

```solidity
// Called by Keeper/Escrow when a master-operated quest completes
function recordMasterJobCompletion(address agent, uint256 satisfactionScore)
    external
    onlyRole(ARBITER_ROLE)
{
    require(isMasterFounder[agent] || isMasterSuccessor[agent], "Not a master");
    MasterContribution storage c = masterContributions[agent];
    c.jobsProcessed += 1;
    c.satisfactionSum += satisfactionScore;
    c.satisfactionCount += 1;
    emit MasterContributionRecorded(agent, c.uptimeSeconds, c.jobsProcessed, satisfactionScore);
}

// Called by Keeper at regular intervals for uptime tracking
function recordMasterUptime(address agent) external onlyRole(KEEPER_ROLE) {
    require(isMasterFounder[agent] || isMasterSuccessor[agent], "Not a master");
    MasterContribution storage c = masterContributions[agent];
    if (c.lastUptimePing > 0) {
        uint256 elapsed = block.timestamp - c.lastUptimePing;
        if (elapsed <= 1 hours) {   // only count if ping within 1h window
            c.uptimeSeconds += elapsed;
        }
    }
    c.lastUptimePing = block.timestamp;
}
```

### 1-B. Monthly Master Settlement

MASTER_ROADMAP contribution formula:
- Contribution = uptime(40%) + jobs(30%) + satisfaction(30%)
- Reward = operationPoolShare × (contribution / totalContribution) × yearMultiplier

```solidity
// Called by Keeper monthly (or via TavernAutomationRouter)
function monthlyMasterSettle() external onlyRole(KEEPER_ROLE) {
    require(block.timestamp >= lastMasterSettlementAt + MASTER_SETTLE_INTERVAL, "Too early");
    lastMasterSettlementAt = block.timestamp;

    uint256 masterCount = masterAgentList.length;
    if (masterCount == 0) return;

    // Step 1: Calculate each master's contribution score
    uint256[] memory scores = new uint256[](masterCount);
    uint256 totalScore = 0;

    // Find max values for normalization
    uint256 maxUptime = 1;
    uint256 maxJobs = 1;
    for (uint256 i = 0; i < masterCount; i++) {
        MasterContribution memory c = masterContributions[masterAgentList[i]];
        if (c.uptimeSeconds > maxUptime) maxUptime = c.uptimeSeconds;
        if (c.jobsProcessed > maxJobs) maxJobs = c.jobsProcessed;
    }

    for (uint256 i = 0; i < masterCount; i++) {
        MasterContribution memory c = masterContributions[masterAgentList[i]];
        uint256 uptimeNorm = (c.uptimeSeconds * 10000) / maxUptime;           // 0-10000
        uint256 jobsNorm = (c.jobsProcessed * 10000) / maxJobs;              // 0-10000
        uint256 satNorm = c.satisfactionCount > 0
            ? (c.satisfactionSum * 10000) / (c.satisfactionCount * 100)       // 0-10000
            : 0;

        // Weighted: uptime 40% + jobs 30% + satisfaction 30%
        scores[i] = (uptimeNorm * 4000 + jobsNorm * 3000 + satNorm * 3000) / 10000;
        totalScore += scores[i];
    }

    if (totalScore == 0) return;

    // Step 2: Get monthly TVRN budget from operation pool
    // Use a configurable monthly budget (admin-set, or derive from pool remaining)
    uint256 monthlyBudget = masterMonthlyBudgetTVRN;
    uint256 yearMulti = _getCurrentYearMultiplier();

    // Step 3: Distribute
    uint256 totalDistributed = 0;
    for (uint256 i = 0; i < masterCount; i++) {
        if (scores[i] == 0) continue;
        address agent = masterAgentList[i];
        uint256 share = (monthlyBudget * scores[i]) / totalScore;
        uint256 reward = (share * yearMulti) / 5; // normalize: max multiplier = 5

        if (reward > 0) {
            _mintOperationTVRN(agent, reward);
            totalDistributed += reward;
        }
        emit MasterRewardDistributed(agent, reward, yearMulti);

        // Reset contribution counters
        delete masterContributions[agent];
    }

    emit MasterSettlementExecuted(totalDistributed, masterCount, block.timestamp);
}
```

**Supporting state:**

```solidity
uint256 public masterMonthlyBudgetTVRN = 5_600_000 * 1e18; // 672M / 120 months ≈ 5.6M/month

function setMasterMonthlyBudget(uint256 amount) external onlyRole(ADMIN_ROLE) {
    masterMonthlyBudgetTVRN = amount;
}
```

### 1-C. Master Agent List Management

```solidity
function addMasterAgent(address agent) internal {
    for (uint256 i = 0; i < masterAgentList.length; i++) {
        if (masterAgentList[i] == agent) return; // already listed
    }
    masterAgentList.push(agent);
}

function removeMasterAgent(address agent) internal {
    for (uint256 i = 0; i < masterAgentList.length; i++) {
        if (masterAgentList[i] == agent) {
            masterAgentList[i] = masterAgentList[masterAgentList.length - 1];
            masterAgentList.pop();
            return;
        }
    }
}
```

Update `setMasterFounder()` and `setMasterSuccessor()` to call `addMasterAgent()`/`removeMasterAgent()`.

### 1-D. TavernRegistry — _mintOperationTVRN

```solidity
function _mintOperationTVRN(address to, uint256 amount) internal {
    (bool success, ) = address(guildToken).call(
        abi.encodeWithSignature("operationMint(address,uint256,string)", to, amount, "master-reward")
    );
    require(success, "Operation mint failed");
}
```

Grant MINTER_ROLE on TavernToken to TavernRegistry in deploy script.

---

## Fix 2: Fee Distribution System (M2)

### 2-A. TavernEscrow — Pool Withdrawal Functions

`_routeFeeAmount()` already splits fees into `operatorPoolBalance`, `buybackReserveBalance`, `treasuryReserveBalance`. What's missing is the **withdrawal/distribution** mechanism.

```solidity
// Add to TavernEscrow.sol

event OperatorPoolWithdrawn(address indexed to, address currency, uint256 amount);
event BuybackExecuted(address currency, uint256 amount);
event TreasuryWithdrawn(address indexed to, address currency, uint256 amount);

// Admin withdraws operator pool → sends to TavernRegistry for master distribution
function withdrawOperatorPool(address currency, address to, uint256 amount)
    external
    onlyRole(ADMIN_ROLE)
{
    require(operatorPoolBalance[currency] >= amount, "Insufficient operator pool");
    operatorPoolBalance[currency] -= amount;
    _transferCurrency(currency, to, amount);
    emit OperatorPoolWithdrawn(to, currency, amount);
}

// Admin withdraws treasury reserve → DAO treasury multisig
function withdrawTreasuryReserve(address currency, address to, uint256 amount)
    external
    onlyRole(ADMIN_ROLE)
{
    require(treasuryReserveBalance[currency] >= amount, "Insufficient treasury");
    treasuryReserveBalance[currency] -= amount;
    _transferCurrency(currency, to, amount);
    emit TreasuryWithdrawn(to, currency, amount);
}

// Buyback: withdraw buyback reserve to buy TVRN → burn
// Phase 1: manual admin execution. Phase 2: automated DEX integration.
function executeBuybackBurn(address currency, uint256 amount)
    external
    onlyRole(ADMIN_ROLE)
{
    require(buybackReserveBalance[currency] >= amount, "Insufficient buyback reserve");
    buybackReserveBalance[currency] -= amount;

    // Phase 1: Transfer to admin for off-chain buyback+burn
    // Phase 2: Replace with Uniswap router swap + TVRN burn
    _transferCurrency(currency, msg.sender, amount);
    emit BuybackExecuted(currency, amount);
}
```

---

## Fix 3: Monthly Ejection System (M3)

### 3-A. TavernRegistry — Agent Performance Tracking + Ejection

```solidity
// Add to TavernRegistry.sol

uint256 public constant EJECTION_WARNING_THRESHOLD_BPS = 1000;  // bottom 10%
uint256 public constant MAX_CONSECUTIVE_WARNINGS = 2;
uint256 public constant EJECTION_BAN_DURATION = 90 days;
uint256 public constant MAX_EJECTIONS_BEFORE_BAN = 3;

struct AgentMonthlyPerformance {
    uint256 questsCompleted;
    uint256 reputationScore;
    uint256 warningCount;      // consecutive warnings
    uint256 ejectionCount;     // lifetime ejections
    uint256 bannedUntil;
}

mapping(address => AgentMonthlyPerformance) public agentPerformance;
address[] public activeAgentList;  // enumerable for sorting

event AgentWarned(address indexed agent, uint256 consecutiveWarnings);
event AgentEjected(address indexed agent, string reason);
event AgentBanned(address indexed agent, uint256 bannedUntil);

// Called monthly by Keeper
function monthlyEjectionReview(address[] calldata rankedAgents) external onlyRole(KEEPER_ROLE) {
    uint256 total = rankedAgents.length;
    if (total < 10) return; // need minimum agents to apply 10% rule

    uint256 warningCount = total / 10; // bottom 10%

    for (uint256 i = 0; i < total; i++) {
        address agent = rankedAgents[i];
        AgentMonthlyPerformance storage perf = agentPerformance[agent];

        if (perf.bannedUntil > block.timestamp) continue; // already banned

        if (i >= total - warningCount) {
            // Bottom 10%: issue warning
            perf.warningCount += 1;
            emit AgentWarned(agent, perf.warningCount);

            if (perf.warningCount >= MAX_CONSECUTIVE_WARNINGS) {
                // Eject
                _ejectAgent(agent);
                perf.ejectionCount += 1;
                perf.warningCount = 0;

                if (perf.ejectionCount >= MAX_EJECTIONS_BEFORE_BAN) {
                    perf.bannedUntil = block.timestamp + EJECTION_BAN_DURATION;
                    emit AgentBanned(agent, perf.bannedUntil);
                }
            }
        } else {
            // Not in bottom 10%: reset consecutive warnings
            perf.warningCount = 0;
        }

        // Reset monthly counters
        perf.questsCompleted = 0;
        perf.reputationScore = 0;
    }
}

function _ejectAgent(address agent) internal {
    AgentProfile storage profile = agents[agent];
    if (profile.isActive) {
        profile.isActive = false;
        emit AgentEjected(agent, "monthly-review");
    }
}
```

**Note:** The `rankedAgents` array is supplied by the off-chain Keeper sorted by performance (ascending = worst first). This avoids expensive on-chain sorting. The contract trusts the Keeper-supplied ordering (Keeper is a permissioned role).

### 3-B. TavernAutomationRouter — Monthly Ejection Task

Add `MonthlyEjection` to the TaskType enum in TavernAutomationRouter.sol:

```solidity
enum TaskType {
    None,
    ExecuteTimeout,
    AutoApprove,
    FeeStageCheck,
    QuotaRebalance,
    PriceRefresh,
    MasterSettle,       // NEW — monthly master settlement (Fix 1)
    MonthlyEjection     // NEW — monthly ejection review (Fix 3)
}
```

Add corresponding state variables, check/perform handlers, and interval tracking similar to the existing QuotaRebalance pattern:

```solidity
uint256 public lastMasterSettleAt;
uint256 public masterSettleInterval = 30 days;
uint256 public lastEjectionReviewAt;
uint256 public ejectionReviewInterval = 30 days;
```

---

## Fix 4: Appeal System (M4)

### 4-A. TavernRegistry — Appeal Filing + Resolution

```solidity
// Add to TavernRegistry.sol

uint256 public constant APPEAL_WINDOW = 7 days;

enum AppealState { Filed, UnderReview, Accepted, Rejected, EscalatedToDAO }

struct Appeal {
    address agent;
    uint256 filedAt;
    AppealState state;
    string reason;
    address arbiter;        // assigned mediator agent
}

uint256 public nextAppealId;
mapping(uint256 => Appeal) public appeals;

event AppealFiled(uint256 indexed appealId, address indexed agent, string reason);
event AppealResolved(uint256 indexed appealId, AppealState result);
event AppealEscalated(uint256 indexed appealId);

function fileAppeal(string calldata reason) external {
    AgentMonthlyPerformance memory perf = agentPerformance[msg.sender];
    // Can only appeal if recently ejected
    require(!agents[msg.sender].isActive, "Agent is still active");

    uint256 appealId = ++nextAppealId;
    appeals[appealId] = Appeal({
        agent: msg.sender,
        filedAt: block.timestamp,
        state: AppealState.Filed,
        reason: reason,
        arbiter: address(0)
    });

    emit AppealFiled(appealId, msg.sender, reason);
}

function assignAppealArbiter(uint256 appealId, address arbiter) external onlyRole(ADMIN_ROLE) {
    Appeal storage a = appeals[appealId];
    require(a.state == AppealState.Filed, "Not filed");
    a.arbiter = arbiter;
    a.state = AppealState.UnderReview;
}

function resolveAppeal(uint256 appealId, bool accepted) external onlyRole(ADMIN_ROLE) {
    Appeal storage a = appeals[appealId];
    require(a.state == AppealState.UnderReview, "Not under review");

    if (accepted) {
        a.state = AppealState.Accepted;
        // Reinstate agent
        agents[a.agent].isActive = true;
        agentPerformance[a.agent].warningCount = 0;
    } else {
        a.state = AppealState.Rejected;
    }
    emit AppealResolved(appealId, a.state);
}

// Escalate to DAO vote (via TavernGovernance)
function escalateAppealToDAO(uint256 appealId) external {
    Appeal storage a = appeals[appealId];
    require(a.state == AppealState.Rejected, "Must be rejected first");
    require(a.agent == msg.sender, "Only appellant");
    require(block.timestamp <= a.filedAt + APPEAL_WINDOW, "Appeal window closed");

    a.state = AppealState.EscalatedToDAO;
    emit AppealEscalated(appealId);
    // Off-chain: UI creates a TavernGovernance proposal referencing this appealId
}
```

---

## Fix 5: Client TVRN Rewards (M5)

### 5-A. TavernEscrow — Client Activity Rewards

MASTER_ROADMAP client reward schedule:
- Account creation + race selection: +30 TVRN
- First quest completion: +20 TVRN
- Quest completion + evaluation: +3 TVRN
- Level-up: +10 TVRN
- Referral: +50 TVRN (max 3/month)

```solidity
// Add to TavernEscrow.sol

uint256 public constant CLIENT_SIGNUP_REWARD = 30 * 1e18;
uint256 public constant CLIENT_FIRST_QUEST_REWARD = 20 * 1e18;
uint256 public constant CLIENT_EVAL_REWARD = 3 * 1e18;
uint256 public constant CLIENT_LEVELUP_REWARD = 10 * 1e18;
uint256 public constant CLIENT_REFERRAL_REWARD = 50 * 1e18;
uint256 public constant CLIENT_REFERRAL_MONTHLY_CAP = 3;

mapping(address => bool) public clientSignupRewarded;
mapping(address => bool) public clientFirstQuestRewarded;
mapping(address => mapping(uint256 => uint256)) public clientReferralCountMonth;
// month key = block.timestamp / 30 days

event ClientRewardMinted(address indexed client, uint256 amount, string reason);

// Called by Keeper when a new client registers (off-chain trigger)
function rewardClientSignup(address client) external onlyRole(KEEPER_ROLE) {
    require(!clientSignupRewarded[client], "Already rewarded");
    clientSignupRewarded[client] = true;
    _mintClientRewardTVRN(client, CLIENT_SIGNUP_REWARD, "signup-reward");
    emit ClientRewardMinted(client, CLIENT_SIGNUP_REWARD, "signup");
}

// Internal: called after first quest auto-approve/evaluate
function _rewardClientFirstQuest(address client) internal {
    if (clientFirstQuestRewarded[client]) return;
    clientFirstQuestRewarded[client] = true;
    _mintClientRewardTVRN(client, CLIENT_FIRST_QUEST_REWARD, "first-quest-reward");
    emit ClientRewardMinted(client, CLIENT_FIRST_QUEST_REWARD, "first-quest");
}

// Called within submitEvaluation — already hooks into _settleQuest
// Add a call to _rewardClientEval(q.client) in submitEvaluation after settlement
function _rewardClientEval(address client) internal {
    _mintClientRewardTVRN(client, CLIENT_EVAL_REWARD, "eval-reward");
    emit ClientRewardMinted(client, CLIENT_EVAL_REWARD, "eval");
}

// Called by Keeper for referral rewards
function rewardClientReferral(address referrer) external onlyRole(KEEPER_ROLE) {
    uint256 monthKey = block.timestamp / 30 days;
    require(clientReferralCountMonth[referrer][monthKey] < CLIENT_REFERRAL_MONTHLY_CAP, "Monthly cap reached");
    clientReferralCountMonth[referrer][monthKey] += 1;
    _mintClientRewardTVRN(referrer, CLIENT_REFERRAL_REWARD, "referral-reward");
    emit ClientRewardMinted(referrer, CLIENT_REFERRAL_REWARD, "referral");
}
```

**Integration points:**
- In `submitEvaluation()`: after `_settleQuest()`, call `_rewardClientEval(q.client)`
- In `executeAutoApprove()`: after `_settleQuest()`, call `_rewardClientFirstQuest(q.client)` (check internally)
- In `submitEvaluation()`: after settlement, call `_rewardClientFirstQuest(q.client)`

---

## Fix 6: Staking Slash Differentiation (M7)

### 6-A. TavernStaking — Three Slash Paths

Current: single `slash()` with 50% burn.
MASTER_ROADMAP:
- Ejection: 50% burn + 50% return (current behavior)
- Voluntary resignation: 100% return after 30-day cooldown (current `requestUnstake→withdraw`)
- Challenge failure: 10% burn + 90% return

```solidity
// Modify TavernStaking.sol

uint256 public constant SLASH_EJECTION_BPS = 5000;     // 50%
uint256 public constant SLASH_CHALLENGE_BPS = 1000;     // 10%

// Replace single slash() with two variants
function slashEjection(address agent) external onlyRole(SLASHER_ROLE) nonReentrant {
    _slash(agent, SLASH_EJECTION_BPS);
}

function slashChallenge(address agent) external onlyRole(SLASHER_ROLE) nonReentrant {
    _slash(agent, SLASH_CHALLENGE_BPS);
}

function _slash(address agent, uint256 slashBps) internal {
    StakeInfo storage info = stakes[agent];
    require(info.amount > 0, "No active stake");
    require(!info.slashed, "Already slashed");

    uint256 stakedAmount = info.amount;
    uint256 slashAmount = (stakedAmount * slashBps) / 10000;
    uint256 remaining = stakedAmount - slashAmount;

    info.amount = remaining;
    info.slashed = true;
    info.unstakeRequestAt = block.timestamp;

    tvrnToken.burn(address(this), slashAmount);

    emit Slashed(agent, slashAmount, remaining);
}
```

Remove the old `slash(address agent)` function. If external contracts call `slash()`, add a backward-compatible wrapper:
```solidity
function slash(address agent) external onlyRole(SLASHER_ROLE) nonReentrant {
    _slash(agent, SLASH_EJECTION_BPS);
}
```

---

## Checklist

### TavernRegistry.sol — Master Reward (Fix 1)
- [ ] `MasterContribution` struct added
- [ ] `masterContributions` mapping added
- [ ] `masterAgentList` array + add/remove helpers
- [ ] `recordMasterJobCompletion()` — ARBITER_ROLE
- [ ] `recordMasterUptime()` — KEEPER_ROLE
- [ ] `monthlyMasterSettle()` — KEEPER_ROLE, contribution formula (40/30/30), yearMultiplier
- [ ] `masterMonthlyBudgetTVRN` configurable
- [ ] `_mintOperationTVRN()` internal helper
- [ ] Events: `MasterContributionRecorded`, `MasterRewardDistributed`, `MasterSettlementExecuted`

### TavernRegistry.sol — Ejection (Fix 3)
- [ ] `AgentMonthlyPerformance` struct
- [ ] `monthlyEjectionReview(address[])` — KEEPER_ROLE
- [ ] Warning (bottom 10%) + 2-consecutive ejection + 3-lifetime ban(90d)
- [ ] `_ejectAgent()` internal
- [ ] Events: `AgentWarned`, `AgentEjected`, `AgentBanned`

### TavernRegistry.sol — Appeal (Fix 4)
- [ ] `Appeal` struct + `AppealState` enum
- [ ] `fileAppeal()`, `assignAppealArbiter()`, `resolveAppeal()`, `escalateAppealToDAO()`
- [ ] 7-day appeal window
- [ ] Events: `AppealFiled`, `AppealResolved`, `AppealEscalated`

### TavernEscrow.sol — Fee Withdrawal (Fix 2)
- [ ] `withdrawOperatorPool()` — ADMIN_ROLE
- [ ] `withdrawTreasuryReserve()` — ADMIN_ROLE
- [ ] `executeBuybackBurn()` — ADMIN_ROLE
- [ ] Events: `OperatorPoolWithdrawn`, `BuybackExecuted`, `TreasuryWithdrawn`

### TavernEscrow.sol — Client Rewards (Fix 5)
- [ ] Client reward constants (30, 20, 3, 10, 50 TVRN)
- [ ] `rewardClientSignup()` — KEEPER_ROLE
- [ ] `_rewardClientFirstQuest()` — internal, called on first settlement
- [ ] `_rewardClientEval()` — internal, called on each evaluation
- [ ] `rewardClientReferral()` — KEEPER_ROLE, 3/month cap
- [ ] Integration in `submitEvaluation()` and `executeAutoApprove()`
- [ ] Events: `ClientRewardMinted`

### TavernStaking.sol — Slash Differentiation (Fix 6)
- [ ] `SLASH_EJECTION_BPS = 5000` and `SLASH_CHALLENGE_BPS = 1000`
- [ ] `slashEjection()` and `slashChallenge()` public functions
- [ ] `_slash(address, uint256)` internal helper
- [ ] Backward-compatible `slash()` wrapper
- [ ] Update `Slashed` event or add differentiated events

### TavernAutomationRouter.sol
- [ ] `MasterSettle` and `MonthlyEjection` TaskTypes added
- [ ] Interval state variables + check/perform handlers
- [ ] Setters for intervals

### Deploy Scripts
- [ ] TavernToken `grantRole(MINTER_ROLE, registry)` for operation mints
- [ ] TavernAutomationRouter updated for new constructor/TaskTypes

### Tests
- [ ] test/TavernRegistry.master.test.ts — contribution recording, monthly settlement, year multiplier
- [ ] test/TavernRegistry.ejection.test.ts — warning, ejection, ban flow
- [ ] test/TavernRegistry.appeal.test.ts — file, resolve, escalate
- [ ] test/TavernEscrow.clientReward.test.ts — signup, first quest, eval, referral cap
- [ ] test/TavernEscrow.feeWithdrawal.test.ts — operator/buyback/treasury withdraw
- [ ] test/TavernStaking.slash.test.ts — ejection 50%, challenge 10%, backward compat
- [ ] `npx hardhat test` all PASS
- [ ] `node scripts/run-forge.js` fuzz PASS

### Documentation
- [ ] HANDOFF_RESUME.md updated with Task 24 entry
- [ ] GAP_ANALYSIS_MASTER_VS_CODE.md — mark M1, M2, M3, M4, M5, M7 as RESOLVED

---

## Deferred to Phase 2

- **M6**: TVRN withdrawal conditions (Lv.2+, 5 quests, verified, 30d age, 100 TVRN/month cap) — requires RPG system
- **M8**: Exclusive subscription 5% fee — requires subscription concept on-chain
