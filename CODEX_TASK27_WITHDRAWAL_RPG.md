# Task 27 — Phase 2: TVRN Withdrawal Conditions + Client RPG System

> References: `MASTER_ROADMAP.md` lines 541–681, `GAP_ANALYSIS_MASTER_VS_CODE.md` (M6)
> Difficulty: HIGH — new contract + state machine + cross-contract integration
> Prerequisite: Task 26 complete (mainnet deployed), all tests passing

---

## Objective

Implement the **Client RPG system** (EXP, Levels, Seasons) and **TVRN withdrawal gating** as defined in the MASTER_ROADMAP. This resolves the **M6 deferred gap** — "TVRN withdrawal conditions (requires RPG / level system)".

The system has two parts:

1. **TavernClientRPG.sol** — new contract managing client EXP, levels, seasons, and withdrawal eligibility
2. **TavernEscrow integration** — withdrawal gating that checks RPG eligibility before allowing TVRN transfers to clients

---

## Part 1: New Contract — `TavernClientRPG.sol`

Create `contracts/TavernClientRPG.sol` with OpenZeppelin 5.x (AccessControl, ReentrancyGuard).

### 1-A. State & Constants

```solidity
// --- Levels ---
uint256 public constant LEVEL_COUNT = 6;
// EXP thresholds: Lv1=0, Lv2=100, Lv3=500, Lv4=2000, Lv5=8000, Lv6=20000
uint256[6] public LEVEL_THRESHOLDS = [0, 100, 500, 2000, 8000, 20000];

// --- Withdrawal conditions ---
uint256 public constant MIN_WITHDRAWAL_LEVEL = 2;           // Lv.2+
uint256 public constant MIN_JOBS_FOR_WITHDRAWAL = 5;         // 5 completed quests
uint256 public constant MIN_ACCOUNT_AGE = 30 days;           // 30 days since registration
uint256 public constant WITHDRAWAL_COOLDOWN = 30 days;       // once per month
uint256 public constant MAX_WITHDRAWAL_PER_MONTH = 100 ether; // 100 TVRN per month

// --- Season ---
uint256 public constant SEASON_DURATION = 180 days;          // 6 months

// --- EXP values ---
uint256 public constant EXP_FREE_CHAT = 1;
uint256 public constant EXP_JOB_COMPLETE = 20;
uint256 public constant EXP_EVAL_SUBMIT = 3;
uint256 public constant EXP_WEEKLY_STREAK = 30;   // 7-day consecutive login
uint256 public constant EXP_REFERRAL = 50;
uint256 public constant EXP_SUBSCRIPTION = 100;   // Phase 2 exclusive subscription

// --- Roles ---
bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
```

### 1-B. Client Profile Struct

```solidity
struct ClientProfile {
    uint256 registeredAt;       // block.timestamp of first registration
    uint256 exp;                // current season EXP
    uint256 level;              // derived from EXP, cached for gas
    uint256 totalJobsCompleted; // lifetime count (not reset per season)
    uint256 lastWithdrawalAt;   // timestamp of last TVRN withdrawal
    uint256 withdrawnThisMonth; // TVRN withdrawn in current month
    uint256 lastWithdrawalMonth;// month key for reset tracking
    bool    verified;           // wallet or email OTP verified
    bool    banned;             // permanent ban for abuse
}

mapping(address => ClientProfile) public clientProfiles;
```

### 1-C. Season Management

```solidity
uint256 public currentSeasonStart;
uint256 public currentSeasonNumber;

// Legacy EXP bonus from previous season (roadmap: Lv2=50, Lv3=120, Lv4=300, Lv5=800, Lv6=2000)
uint256[6] public LEGACY_EXP_BONUS = [0, 0, 50, 120, 300, 800];
// Index maps to PREVIOUS level achieved: [Lv1, Lv2, Lv3, Lv4, Lv5, Lv6]
// Note: Lv6 legacy bonus = 2000 (add manually since array is 6 elements)
uint256 public constant LEGACY_EXP_LV6 = 2000;

struct SeasonSnapshot {
    uint256 finalLevel;
    uint256 finalExp;
}

// seasonNumber => client => snapshot
mapping(uint256 => mapping(address => SeasonSnapshot)) public seasonSnapshots;

function startNewSeason() external onlyRole(KEEPER_ROLE) {
    require(block.timestamp >= currentSeasonStart + SEASON_DURATION, "Season not over");
    // Increment season
    currentSeasonNumber += 1;
    currentSeasonStart = block.timestamp;
    emit SeasonStarted(currentSeasonNumber, block.timestamp);
}

// Called per-client lazily when they first interact in new season
function _migrateSeasonIfNeeded(address client) internal {
    ClientProfile storage p = clientProfiles[client];
    if (p.registeredAt == 0) return; // not registered

    // Check if client's EXP belongs to a previous season
    // Use a separate mapping to track last active season per client
    // If lastActiveSeason < currentSeasonNumber → snapshot + reset + apply legacy bonus
}
```

### 1-D. EXP Granting Functions

```solidity
// Called by Escrow when quest completes
function grantJobCompleteEXP(address client) external onlyRole(ESCROW_ROLE) {
    _migrateSeasonIfNeeded(client);
    _addEXP(client, EXP_JOB_COMPLETE);
    clientProfiles[client].totalJobsCompleted += 1;
}

// Called by Escrow when evaluation submitted
function grantEvalEXP(address client) external onlyRole(ESCROW_ROLE) {
    _migrateSeasonIfNeeded(client);
    _addEXP(client, EXP_EVAL_SUBMIT);
}

// Called by Escrow/frontend for referral
function grantReferralEXP(address client) external onlyRole(ESCROW_ROLE) {
    _migrateSeasonIfNeeded(client);
    _addEXP(client, EXP_REFERRAL);
}

// Called by Keeper/Automation for weekly streak
function grantWeeklyStreakEXP(address client) external onlyRole(KEEPER_ROLE) {
    _migrateSeasonIfNeeded(client);
    _addEXP(client, EXP_WEEKLY_STREAK);
}

function _addEXP(address client, uint256 amount) internal {
    ClientProfile storage p = clientProfiles[client];
    p.exp += amount;
    uint256 newLevel = _calculateLevel(p.exp);
    if (newLevel > p.level) {
        uint256 oldLevel = p.level;
        p.level = newLevel;
        emit LevelUp(client, oldLevel, newLevel, p.exp);
    }
}

function _calculateLevel(uint256 exp) internal view returns (uint256) {
    for (uint256 i = LEVEL_COUNT - 1; i > 0; i--) {
        if (exp >= LEVEL_THRESHOLDS[i]) return i + 1; // Lv1-based
    }
    return 1;
}
```

### 1-E. Registration & Verification

```solidity
function registerClient(address client) external onlyRole(ESCROW_ROLE) {
    require(clientProfiles[client].registeredAt == 0, "Already registered");
    clientProfiles[client].registeredAt = block.timestamp;
    clientProfiles[client].level = 1;
    emit ClientRegistered(client, block.timestamp);
}

function setVerified(address client, bool status) external onlyRole(DEFAULT_ADMIN_ROLE) {
    clientProfiles[client].verified = status;
    emit ClientVerificationChanged(client, status);
}

function banClient(address client) external onlyRole(DEFAULT_ADMIN_ROLE) {
    clientProfiles[client].banned = true;
    emit ClientBanned(client);
}
```

### 1-F. Withdrawal Eligibility Check

This is the core M6 function — called by TavernEscrow before any TVRN transfer to client:

```solidity
function checkWithdrawalEligible(address client, uint256 amount) external view returns (bool eligible, string memory reason) {
    ClientProfile storage p = clientProfiles[client];

    if (p.banned) return (false, "BANNED");
    if (p.registeredAt == 0) return (false, "NOT_REGISTERED");
    if (!p.verified) return (false, "NOT_VERIFIED");
    if (p.level < MIN_WITHDRAWAL_LEVEL) return (false, "LEVEL_TOO_LOW");
    if (p.totalJobsCompleted < MIN_JOBS_FOR_WITHDRAWAL) return (false, "INSUFFICIENT_JOBS");
    if (block.timestamp < p.registeredAt + MIN_ACCOUNT_AGE) return (false, "ACCOUNT_TOO_NEW");

    // Monthly cooldown + cap
    uint256 monthKey = block.timestamp / 30 days;
    uint256 withdrawnThisMonth = p.lastWithdrawalMonth == monthKey ? p.withdrawnThisMonth : 0;
    if (withdrawnThisMonth + amount > MAX_WITHDRAWAL_PER_MONTH) return (false, "MONTHLY_CAP_EXCEEDED");

    return (true, "");
}

// Called by Escrow after successful withdrawal to update tracking
function recordWithdrawal(address client, uint256 amount) external onlyRole(ESCROW_ROLE) {
    ClientProfile storage p = clientProfiles[client];
    uint256 monthKey = block.timestamp / 30 days;
    if (p.lastWithdrawalMonth != monthKey) {
        p.withdrawnThisMonth = 0;
        p.lastWithdrawalMonth = monthKey;
    }
    p.withdrawnThisMonth += amount;
    p.lastWithdrawalAt = block.timestamp;
    emit WithdrawalRecorded(client, amount, monthKey);
}
```

### 1-G. Events

```solidity
event ClientRegistered(address indexed client, uint256 timestamp);
event ClientVerificationChanged(address indexed client, bool verified);
event ClientBanned(address indexed client);
event LevelUp(address indexed client, uint256 oldLevel, uint256 newLevel, uint256 totalExp);
event EXPGranted(address indexed client, uint256 amount, string reason);
event SeasonStarted(uint256 indexed seasonNumber, uint256 startTimestamp);
event SeasonMigrated(address indexed client, uint256 fromSeason, uint256 toSeason, uint256 legacyBonus);
event WithdrawalRecorded(address indexed client, uint256 amount, uint256 monthKey);
```

### 1-H. Constructor

```solidity
constructor(address _tavernToken, address _escrow) {
    // Store references for potential future use
    tavernToken = IERC20(_tavernToken);
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
}
```

---

## Part 2: TavernEscrow Integration

### 2-A. Add RPG Contract Reference

In `TavernEscrow.sol`:

```solidity
import "./interfaces/ITavernClientRPG.sol";

ITavernClientRPG public clientRPG;

function setClientRPG(address _rpg) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(_rpg != address(0), "Zero address");
    clientRPG = ITavernClientRPG(_rpg);
    emit ClientRPGSet(_rpg);
}
```

### 2-B. Client TVRN Withdrawal Function

Add a new function for clients to withdraw their accumulated TVRN rewards:

```solidity
function clientWithdrawTVRN(uint256 amount) external nonReentrant whenSettlementActive {
    require(address(clientRPG) != address(0), "RPG not set");

    (bool eligible, string memory reason) = clientRPG.checkWithdrawalEligible(msg.sender, amount);
    require(eligible, string.concat("Withdrawal blocked: ", reason));

    // Check client has sufficient claimable balance
    require(clientClaimable[msg.sender] >= amount, "Insufficient balance");

    clientClaimable[msg.sender] -= amount;
    IERC20(tavernToken).safeTransfer(msg.sender, amount);

    clientRPG.recordWithdrawal(msg.sender, amount);
    emit ClientTVRNWithdrawn(msg.sender, amount);
}
```

### 2-C. Client Claimable Balance Tracking

Currently client rewards are minted directly via `_mintClientRewardTVRN()`. Change this to accumulate in a claimable balance instead of direct transfer:

```solidity
mapping(address => uint256) public clientClaimable;

// Modify _mintClientRewardTVRN to accumulate instead of direct transfer:
function _mintClientRewardTVRN(address to, uint256 amount, string memory reason) internal {
    // Mint to THIS contract (Escrow), not directly to client
    (bool ok, ) = address(tavernToken).call(
        abi.encodeWithSignature("clientRewardMint(address,uint256,string)", address(this), amount, reason)
    );
    require(ok, "Client reward mint failed");
    clientClaimable[to] += amount;
    emit ClientRewardAccumulated(to, amount, reason);
}
```

### 2-D. EXP Grant Hooks

Add RPG EXP calls in existing Escrow flows:

In `_settleQuest()` or equivalent completion path:
```solidity
if (address(clientRPG) != address(0)) {
    clientRPG.grantJobCompleteEXP(quest.client);
}
```

In `submitEvaluation()`:
```solidity
if (address(clientRPG) != address(0)) {
    clientRPG.grantEvalEXP(quest.client);
}
```

In `claimSignupReward()`:
```solidity
if (address(clientRPG) != address(0)) {
    clientRPG.registerClient(msg.sender);
}
```

In `claimReferralReward()`:
```solidity
if (address(clientRPG) != address(0)) {
    clientRPG.grantReferralEXP(referrer);
}
```

### 2-E. New Events

```solidity
event ClientRPGSet(address indexed rpg);
event ClientTVRNWithdrawn(address indexed client, uint256 amount);
event ClientRewardAccumulated(address indexed client, uint256 amount, string reason);
```

---

## Part 3: Interface

Create `contracts/interfaces/ITavernClientRPG.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITavernClientRPG {
    function checkWithdrawalEligible(address client, uint256 amount) external view returns (bool eligible, string memory reason);
    function recordWithdrawal(address client, uint256 amount) external;
    function registerClient(address client) external;
    function grantJobCompleteEXP(address client) external;
    function grantEvalEXP(address client) external;
    function grantReferralEXP(address client) external;
}
```

---

## Part 4: Automation Integration

### 4-A. TavernAutomationRouter Updates

Add `TaskType.SeasonReset` to the enum:

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
    SeasonReset       // NEW
}
```

Add season check in `checkUpkeep()`:
```solidity
ITavernClientRPG public clientRPG;

// In checkUpkeep:
if (address(clientRPG) != address(0)) {
    if (block.timestamp >= clientRPG.currentSeasonStart() + clientRPG.SEASON_DURATION()) {
        return (true, abi.encode(TaskType.SeasonReset));
    }
}
```

In `performUpkeep()`:
```solidity
if (taskType == TaskType.SeasonReset) {
    clientRPG.startNewSeason();
}
```

### 4-B. Router Constructor Update

Add `clientRPG` as optional 4th parameter or add a setter:

```solidity
function setClientRPG(address _rpg) external onlyRole(DEFAULT_ADMIN_ROLE) {
    clientRPG = ITavernClientRPG(_rpg);
}
```

---

## Part 5: Deploy Script

### 5-A. Create `deploy/09_deploy_client_rpg.ts`

Deploy order:
1. Deploy `TavernClientRPG(tavernToken, escrow)`
2. Grant `ESCROW_ROLE` on TavernClientRPG to TavernEscrow
3. Grant `KEEPER_ROLE` on TavernClientRPG to TavernAutomationRouter
4. Call `escrow.setClientRPG(clientRPG.address)`
5. Call `router.setClientRPG(clientRPG.address)`
6. Verify on BaseScan

### 5-B. Update Deployment Manifests

Add `tavernClientRPG` address to both `baseSepolia.json` and `base.json`.

---

## Part 6: Tests

### 6-A. `test/TavernClientRPG.test.ts`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Register client + verify profile defaults | registeredAt set, level=1, exp=0 |
| 2 | Grant EXP → level up from Lv1 to Lv2 at 100 EXP | LevelUp event, level=2 |
| 3 | Grant EXP → level up through multiple levels | Correct level at each threshold |
| 4 | Withdrawal eligible: all conditions met | returns (true, "") |
| 5 | Withdrawal blocked: level too low | returns (false, "LEVEL_TOO_LOW") |
| 6 | Withdrawal blocked: insufficient jobs | returns (false, "INSUFFICIENT_JOBS") |
| 7 | Withdrawal blocked: account too new | returns (false, "ACCOUNT_TOO_NEW") |
| 8 | Withdrawal blocked: not verified | returns (false, "NOT_VERIFIED") |
| 9 | Withdrawal blocked: monthly cap exceeded | returns (false, "MONTHLY_CAP_EXCEEDED") |
| 10 | Withdrawal blocked: banned | returns (false, "BANNED") |
| 11 | Record withdrawal updates tracking state | withdrawnThisMonth incremented |
| 12 | Season migration: EXP resets, legacy bonus applied | exp = legacyBonus for previous level |
| 13 | Season migration: totalJobsCompleted NOT reset | lifetime count preserved |

### 6-B. `test/TavernEscrow.clientWithdraw.test.ts`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Client reward accumulates in claimable balance | clientClaimable[client] increases |
| 2 | clientWithdrawTVRN succeeds when eligible | TVRN transferred, balance reduced |
| 3 | clientWithdrawTVRN reverts when RPG not set | "RPG not set" |
| 4 | clientWithdrawTVRN reverts when not eligible | "Withdrawal blocked: LEVEL_TOO_LOW" etc. |
| 5 | clientWithdrawTVRN reverts when insufficient balance | "Insufficient balance" |
| 6 | Quest completion grants job EXP via RPG | grantJobCompleteEXP called |
| 7 | Eval submission grants eval EXP via RPG | grantEvalEXP called |
| 8 | Signup registration calls RPG registerClient | ClientRegistered event |

---

## Part 7: Documentation Updates

1. `GAP_ANALYSIS_MASTER_VS_CODE.md` — Change M6 status from DEFERRED to RESOLVED
2. `HANDOFF_RESUME.md` — Add Task 27 entry
3. `DEPLOY_GUIDE.md` — Add TavernClientRPG deployment section

---

## Completion Checklist

```
[ ] contracts/TavernClientRPG.sol created with all sections (1-A through 1-H)
[ ] contracts/interfaces/ITavernClientRPG.sol created
[ ] TavernEscrow.sol: clientClaimable mapping + clientWithdrawTVRN() + setClientRPG()
[ ] TavernEscrow.sol: _mintClientRewardTVRN() changed to accumulate pattern
[ ] TavernEscrow.sol: EXP grant hooks in settlement, eval, signup, referral
[ ] TavernAutomationRouter.sol: TaskType.SeasonReset + setClientRPG()
[ ] deploy/09_deploy_client_rpg.ts created
[ ] test/TavernClientRPG.test.ts — 13 tests passing
[ ] test/TavernEscrow.clientWithdraw.test.ts — 8 tests passing
[ ] All existing tests still pass (59+)
[ ] Foundry fuzz tests still pass (29)
[ ] npx tsc --noEmit clean
[ ] npx hardhat compile clean
[ ] GAP_ANALYSIS updated (M6 → RESOLVED)
[ ] HANDOFF_RESUME.md updated
```

---

## Security Notes

1. **clientWithdrawTVRN** must use `nonReentrant` + `whenSettlementActive`
2. **Season migration** must be lazy (per-client on interaction) — do NOT loop all clients on-chain
3. **checkWithdrawalEligible** is `view` — no state changes, safe for external calls
4. **_mintClientRewardTVRN** change is breaking — ensure all existing test expectations are updated to check `clientClaimable` instead of direct balance
5. **Client banning** should be admin-only, not automatable — prevents abuse of ban power
