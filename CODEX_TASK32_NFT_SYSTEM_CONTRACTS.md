# CODEX TASK 32 — NFT System: TavernEquipment + TavernGuild + TavernClientRPG Refactor

**Objective**: Implement the NFT reward system described in `NFT_SYSTEM_DESIGN.md`. This adds 2 new contracts (`TavernEquipment`, `TavernGuild`), refactors `TavernClientRPG` (remove seasons, add Lv.100 cap + NFT auto-mint), and updates `TavernAutomationRouter` (remove `SeasonReset` task type).

**Priority**: This is a code-only task. Do NOT deploy. Deployment will be a separate task after testing.

**Reference**: Read `NFT_SYSTEM_DESIGN.md` for full item catalog (145 items), rarity system, level formula, guild model, and architecture details.

---

## Part 1 — New Contract: `TavernEquipment.sol` (ERC-1155)

### 1-A. Base Setup

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
```

Inherit: `ERC1155`, `AccessControl`, `ReentrancyGuard`

### 1-B. Item Registry

Define an on-chain registry for all 145 items:

```solidity
enum Category { EQUIPMENT, TITLE, GUILD_DECORATION, SPECIAL, CONTRIBUTOR }
enum Rarity { COMMON, UNCOMMON, RARE, EPIC, LEGENDARY, MYTHIC }
enum Slot { NONE, HEAD, BODY, WEAPON, SHIELD, CLOAK, ACCESSORY }

struct ItemDef {
    Category category;
    Rarity rarity;
    Slot slot;             // NONE for non-equipment
    uint256 maxSupply;     // 0 = unlimited
    bool soulbound;        // true = non-transferable
    bool active;           // admin can deactivate
    string name;
}

mapping(uint256 => ItemDef) public items;      // tokenId => definition
mapping(uint256 => uint256) public totalMinted; // tokenId => minted count
uint256 public itemCount;                       // total registered items
```

### 1-C. Admin Functions

```solidity
bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");   // granted to TavernClientRPG
bytes32 public constant GUILD_ROLE = keccak256("GUILD_ROLE");     // granted to TavernGuild

function registerItem(
    uint256 tokenId,
    Category category,
    Rarity rarity,
    Slot slot,
    uint256 maxSupply,
    bool soulbound,
    string calldata name
) external onlyRole(ADMIN_ROLE);

function setItemActive(uint256 tokenId, bool active) external onlyRole(ADMIN_ROLE);
function setURI(string calldata newUri) external onlyRole(ADMIN_ROLE);
```

Batch registration function for gas efficiency:
```solidity
function registerItemBatch(
    uint256[] calldata tokenIds,
    Category[] calldata categories,
    Rarity[] calldata rarities,
    Slot[] calldata slots,
    uint256[] calldata maxSupplies,
    bool[] calldata soulbounds,
    string[] calldata names
) external onlyRole(ADMIN_ROLE);
```

### 1-D. Minting

```solidity
// Called by TavernClientRPG on level-up
function mintLevelReward(address to, uint256 newLevel) external onlyRole(MINTER_ROLE) {
    // Look up which items are unlocked at this level
    // Mint all eligible unclaimed items
    // Check maxSupply before minting
    // Emit events
}

// Called by TavernGuild for guild achievements
function mintGuildReward(address to, uint256 tokenId) external onlyRole(GUILD_ROLE) {
    _mintItem(to, tokenId);
}

// Admin manual mint (for operations track, special events)
function adminMint(address to, uint256 tokenId) external onlyRole(ADMIN_ROLE) {
    _mintItem(to, tokenId);
}

function _mintItem(address to, uint256 tokenId) internal {
    ItemDef storage item = items[tokenId];
    require(item.active, "Item not active");
    require(item.maxSupply == 0 || totalMinted[tokenId] < item.maxSupply, "Max supply reached");
    require(balanceOf(to, tokenId) == 0, "Already owns item");

    totalMinted[tokenId] += 1;
    _mint(to, tokenId, 1, "");
}
```

### 1-E. Level-to-Item Mapping

Store which items are auto-granted at each level:

```solidity
// level => array of token IDs to auto-mint
mapping(uint256 => uint256[]) public levelRewards;

function setLevelRewards(uint256 level, uint256[] calldata tokenIds) external onlyRole(ADMIN_ROLE);
```

Based on NFT_SYSTEM_DESIGN.md, the level rewards are:

| Level | Items Unlocked (token IDs) |
|-------|---------------------------|
| 1 | 1, 11, 21, 31, 41, 51 (Common starter set: 6 equipment pieces) + 61 (Wanderer title) |
| 2 | 3, 13, 23, 33, 53 (Uncommon equipment) + 63 (Pathfinder title) |
| 3 | 5, 25, 43 (Rare equipment) + 65 (Trailblazer title) |
| 4 | 15, 35, 45, 55 (Rare equipment) |
| 5 | 7, 27 (Epic equipment) + 67 (Warden title) |
| 6 | 17, 37 (Epic equipment) |
| 7 | 47, 57 (Epic equipment) |
| 8 | 9, 29 (Legendary equipment) + 69 (Dragonslayer title) |
| 9 | 19, 39 (Legendary equipment) |
| 10 | 50 (Mythic Wings of Ascension) + 70 (The Eternal mythic title) |

### 1-F. Equipment Slots

```solidity
struct EquipmentLoadout {
    uint256 head;
    uint256 body;
    uint256 weapon;
    uint256 shield;
    uint256 cloak;
    uint256 accessory;
}

mapping(address => EquipmentLoadout) public loadouts;
mapping(address => uint256) public activeTitle;

function equip(uint256 tokenId) external {
    require(balanceOf(msg.sender, tokenId) > 0, "Not owned");
    ItemDef storage item = items[tokenId];
    require(item.category == Category.EQUIPMENT, "Not equipment");

    if (item.slot == Slot.HEAD) loadouts[msg.sender].head = tokenId;
    else if (item.slot == Slot.BODY) loadouts[msg.sender].body = tokenId;
    else if (item.slot == Slot.WEAPON) loadouts[msg.sender].weapon = tokenId;
    else if (item.slot == Slot.SHIELD) loadouts[msg.sender].shield = tokenId;
    else if (item.slot == Slot.CLOAK) loadouts[msg.sender].cloak = tokenId;
    else if (item.slot == Slot.ACCESSORY) loadouts[msg.sender].accessory = tokenId;
}

function unequip(Slot slot) external {
    if (slot == Slot.HEAD) loadouts[msg.sender].head = 0;
    // ... etc for each slot
}

function equipTitle(uint256 tokenId) external {
    require(balanceOf(msg.sender, tokenId) > 0, "Not owned");
    require(items[tokenId].category == Category.TITLE, "Not a title");
    activeTitle[msg.sender] = tokenId;
}
```

### 1-G. Soulbound Transfer Override

```solidity
function _update(
    address from,
    address to,
    uint256[] memory ids,
    uint256[] memory values
) internal override {
    for (uint256 i = 0; i < ids.length; i++) {
        if (from != address(0) && to != address(0)) {
            // This is a transfer (not mint or burn)
            require(!items[ids[i]].soulbound, "Soulbound: non-transferable");
        }
    }
    super._update(from, to, ids, values);
}
```

### 1-H. View Functions

```solidity
function getItem(uint256 tokenId) external view returns (ItemDef memory);
function getLevelRewards(uint256 level) external view returns (uint256[] memory);
function getLoadout(address user) external view returns (EquipmentLoadout memory);
function getActiveTitle(address user) external view returns (uint256 tokenId, string memory name);
function getRemainingSupply(uint256 tokenId) external view returns (uint256);
```

---

## Part 2 — New Contract: `TavernGuild.sol`

### 2-A. Base Setup

```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ITavernEquipment {
    function mintGuildReward(address to, uint256 tokenId) external;
}

interface ITavernClientRPG {
    function clientProfiles(address) external view returns (
        uint256 registeredAt, uint256 exp, uint256 level,
        uint256 totalJobsCompleted, uint256 lastWithdrawalAt,
        uint256 withdrawnThisMonth, uint256 lastWithdrawalMonth,
        bool verified, bool banned
    );
}
```

### 2-B. Data Structures

```solidity
struct Guild {
    string name;
    address master;          // guild creator/owner
    uint256 createdAt;
    uint256 totalQuests;     // cumulative quests by members
    uint256 guildExp;        // collective EXP (same formula as user levels)
    uint256 guildLevel;
    uint256 memberCount;
    bool active;
}

struct GuildMember {
    uint256 guildId;
    uint256 joinedAt;
    uint256 questsInGuild;   // quests completed while in guild
}

uint256 public guildCount;
mapping(uint256 => Guild) public guilds;
mapping(address => GuildMember) public members;    // user => membership
mapping(uint256 => address[]) public guildMembers; // guildId => member list

uint256 public constant MAX_LEVEL = 100;
uint256 public constant MIN_STAKE_TO_CREATE = 1000 ether; // 1,000 TVRN
```

### 2-C. Guild Management

```solidity
function createGuild(string calldata name) external;
// Requirements: caller registered in RPG, not already in a guild, stakes MIN_STAKE_TO_CREATE

function joinGuild(uint256 guildId) external;
// Requirements: not already in a guild, guild is active

function leaveGuild() external;
// Requirements: must be in a guild, cannot leave if guild master (must transfer first)

function transferMastership(uint256 guildId, address newMaster) external;
// Requirements: caller must be current master, newMaster must be guild member

function dissolveGuild(uint256 guildId) external;
// Requirements: caller must be master, returns staked TVRN
```

### 2-D. Guild EXP & Levels

Use the same formula as user levels: `threshold = 20 * level^2.2`

Guild EXP accrues when members complete quests:

```solidity
bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");

function recordMemberQuest(address member) external onlyRole(ESCROW_ROLE) {
    GuildMember storage gm = members[member];
    if (gm.guildId == 0) return; // not in a guild

    Guild storage guild = guilds[gm.guildId];
    guild.totalQuests += 1;
    gm.questsInGuild += 1;

    // Guild earns EXP per member quest
    uint256 guildExpGain = 20; // same as user EXP_JOB_COMPLETE
    guild.guildExp += guildExpGain;

    // Check guild level up
    uint256 newLevel = _calculateGuildLevel(guild.guildExp);
    if (newLevel > guild.guildLevel) {
        uint256 oldLevel = guild.guildLevel;
        guild.guildLevel = newLevel;
        _checkGuildAchievements(gm.guildId, guild);
        emit GuildLevelUp(gm.guildId, oldLevel, newLevel);
    }
}
```

### 2-E. Guild Level Thresholds

```solidity
// Precomputed table: 20 * level^2.2 (same as user levels)
// Use the same _thresholds lookup from TavernClientRPG
function guildLevelThreshold(uint256 level) public pure returns (uint256) {
    if (level == 0) return 0;
    if (level > MAX_LEVEL) return type(uint256).max;
    return _thresholds[level];
}
```

### 2-F. Guild Achievement → NFT Rewards

When guild milestones are reached, call `TavernEquipment.mintGuildReward()`:

```solidity
function _checkGuildAchievements(uint256 guildId, Guild storage guild) internal {
    // Check member count milestones → mint guild decoration NFTs to master
    // Check quest volume milestones → mint guild decoration NFTs
    // Check anniversary milestones → mint banner NFTs
    // See NFT_SYSTEM_DESIGN.md Category C for full mapping
}
```

Guild decoration NFT mapping (token IDs from design doc):

| Condition | Token ID |
|-----------|----------|
| Create guild | 81 |
| 3 members | 82 |
| 5 members | 83 |
| 10 quests | 84 |
| 10 members | 85 |
| 50 quests | 86 |
| 5 members at Lv.3+ | 87 |
| 25 members | 88 |
| 200 quests | 89 |
| Lv.7+ member | 90 |
| 50 members | 91 |
| Avg level ≥ 5 | 92 |
| Top 50 guilds | 93 (manual/keeper) |
| Top 10 guilds | 94 (manual/keeper) |
| 1,000 quests | 95 |

### 2-G. View Functions

```solidity
function getGuild(uint256 guildId) external view returns (Guild memory);
function getGuildMembers(uint256 guildId) external view returns (address[] memory);
function getMembership(address user) external view returns (GuildMember memory);
function getGuildLevel(uint256 guildId) external view returns (uint256);
```

### 2-H. Events

```solidity
event GuildCreated(uint256 indexed guildId, address indexed master, string name);
event GuildMemberJoined(uint256 indexed guildId, address indexed member);
event GuildMemberLeft(uint256 indexed guildId, address indexed member);
event GuildLevelUp(uint256 indexed guildId, uint256 oldLevel, uint256 newLevel);
event GuildDissolved(uint256 indexed guildId);
event MastershipTransferred(uint256 indexed guildId, address indexed oldMaster, address indexed newMaster);
```

---

## Part 3 — Refactor `TavernClientRPG.sol`

### 3-A. Remove Season System

Delete the following:
- `SEASON_DURATION` constant
- `currentSeasonStart` state variable
- `currentSeasonNumber` state variable
- `SeasonSnapshot` struct
- `seasonSnapshots` mapping
- `clientLastActiveSeason` mapping
- `startNewSeason()` function
- `_migrateSeasonIfNeeded()` function
- `_effectiveSeasonStats()` function
- `_legacyBonusForLevel()` function
- `LEGACY_EXP_BONUS` array
- `LEGACY_EXP_LV6` constant
- `SeasonStarted` event
- `SeasonMigrated` event

### 3-B. Replace Level System

Remove:
- `LEVEL_COUNT = 6` constant
- `LEVEL_THRESHOLDS[6]` storage array
- `_calculateLevel()` function that iterates the array

Add:
```solidity
uint256 public constant MAX_LEVEL = 100;

// Precomputed thresholds: 20 * level^2.2
// Generate this table with a script (see Part 3-H)
uint256[101] private _thresholds;

function levelThreshold(uint256 level) public view returns (uint256) {
    if (level == 0) return 0;
    if (level > MAX_LEVEL) return type(uint256).max;
    return _thresholds[level];
}

function _calculateLevel(uint256 exp) internal view returns (uint256) {
    // Binary search for gas efficiency on 100-element array
    uint256 low = 1;
    uint256 high = MAX_LEVEL;
    uint256 result = 0;

    while (low <= high) {
        uint256 mid = (low + high) / 2;
        if (_thresholds[mid] <= exp) {
            result = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return result;
}
```

Initialize thresholds in constructor or via admin setter:
```solidity
function setThresholds(uint256[] calldata thresholds) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(thresholds.length == MAX_LEVEL + 1, "Invalid length");
    for (uint256 i = 0; i <= MAX_LEVEL; i++) {
        _thresholds[i] = thresholds[i];
    }
}
```

### 3-C. Add NFT Equipment Integration

```solidity
address public equipmentContract; // TavernEquipment address

function setEquipmentContract(address _equipment) external onlyRole(DEFAULT_ADMIN_ROLE) {
    equipmentContract = _equipment;
}
```

Modify `_addEXP()` to trigger NFT minting on level-up:

```solidity
function _addEXP(
    ClientProfile storage profile,
    address client,
    uint256 amount,
    string memory reason
) internal {
    if (amount == 0) return;

    uint256 oldLevel = profile.level == 0 ? 1 : profile.level;
    profile.exp += amount;

    uint256 newLevel = _calculateLevel(profile.exp);
    if (newLevel > MAX_LEVEL) newLevel = MAX_LEVEL; // enforce cap

    if (newLevel > oldLevel) {
        profile.level = newLevel;
        emit LevelUp(client, oldLevel, newLevel, profile.exp);

        // Auto-mint NFT rewards for each level gained
        if (equipmentContract != address(0)) {
            for (uint256 lv = oldLevel + 1; lv <= newLevel; lv++) {
                try ITavernEquipment(equipmentContract).mintLevelReward(client, lv) {} catch {}
            }
        }
    } else if (profile.level == 0) {
        profile.level = oldLevel;
    }

    emit EXPGranted(client, amount, reason);
}
```

### 3-D. Add Guild Integration

```solidity
address public guildContract; // TavernGuild address

function setGuildContract(address _guild) external onlyRole(DEFAULT_ADMIN_ROLE) {
    guildContract = _guild;
}
```

### 3-E. Simplify `_prepareClient()`

Remove season migration call:

```solidity
function _prepareClient(address client) internal returns (ClientProfile storage profile) {
    profile = clientProfiles[client];

    if (profile.registeredAt == 0) {
        profile.registeredAt = block.timestamp;
        profile.level = 1;
        emit ClientRegistered(client, block.timestamp);
    }
}
```

### 3-F. Simplify `_checkWithdrawalEligible()`

Remove `_effectiveSeasonStats()` call — use profile.level directly:

```solidity
function _checkWithdrawalEligible(address client, uint256 amount)
    internal view returns (bool eligible, string memory reason)
{
    ClientProfile storage profile = clientProfiles[client];

    if (profile.banned) return (false, "BANNED");
    if (profile.registeredAt == 0) return (false, "NOT_REGISTERED");
    if (!profile.verified) return (false, "NOT_VERIFIED");

    uint256 effectiveLevel = profile.level == 0 ? 1 : profile.level;
    if (effectiveLevel < MIN_WITHDRAWAL_LEVEL) return (false, "LEVEL_TOO_LOW");
    if (profile.totalJobsCompleted < MIN_JOBS_FOR_WITHDRAWAL) return (false, "INSUFFICIENT_JOBS");
    if (block.timestamp < profile.registeredAt + MIN_ACCOUNT_AGE) return (false, "ACCOUNT_TOO_NEW");

    uint256 monthKey = _monthKey(block.timestamp);
    uint256 withdrawnThisMonth = profile.lastWithdrawalMonth == monthKey ? profile.withdrawnThisMonth : 0;
    if (withdrawnThisMonth + amount > MAX_WITHDRAWAL_PER_MONTH) return (false, "MONTHLY_CAP_EXCEEDED");

    return (true, "");
}
```

### 3-G. New Interface

Add interface for TavernEquipment:

```solidity
interface ITavernEquipment {
    function mintLevelReward(address to, uint256 newLevel) external;
}
```

### 3-H. Threshold Generation Script

Create `scripts/generate-thresholds.ts`:

```typescript
// Generates the 101-element threshold array for 20 * level^2.2
const thresholds: bigint[] = [0n]; // level 0 = 0
for (let lv = 1; lv <= 100; lv++) {
    const threshold = Math.floor(20 * Math.pow(lv, 2.2));
    thresholds.push(BigInt(threshold));
}
console.log("Thresholds:", thresholds.map(t => t.toString()));
// Output for use in deploy script or setThresholds() call
```

Expected values (spot check):
- Lv.1: 20
- Lv.5: 621
- Lv.10: 2,738
- Lv.20: 12,973
- Lv.50: 89,637
- Lv.100: 502,377

### 3-I. Constructor Update

Remove season initialization from constructor:

```solidity
constructor(address _tavernToken, address _escrow) {
    require(_tavernToken != address(0), "Token zero");
    require(_escrow != address(0), "Escrow zero");

    tavernToken = IERC20(_tavernToken);
    escrow = _escrow;
    // REMOVED: currentSeasonStart = block.timestamp;
    // REMOVED: currentSeasonNumber = 1;

    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
}
```

---

## Part 4 — Update `TavernAutomationRouter.sol`

### 4-A. Remove SeasonReset Task Type

In the `TaskType` enum, remove `SeasonReset`:

Before:
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
    SeasonReset,       // ← REMOVE
    SubscriptionExpiry
}
```

After:
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
    GuildMaintenance,  // ← REPLACE SeasonReset with guild upkeep
    SubscriptionExpiry
}
```

**Important**: Keep the same enum index (8) but repurpose it as `GuildMaintenance` to avoid breaking the enum ordering. This new task type will handle periodic guild achievement checks.

### 4-B. Update `checkUpkeep()` and `performUpkeep()`

Replace the `SeasonReset` check/perform blocks:

In `checkUpkeep()`:
```solidity
// Replace SeasonReset check with GuildMaintenance
if (/* guild maintenance needed — e.g., weekly check */) {
    return (true, abi.encode(TaskType.GuildMaintenance, uint256(0)));
}
```

In `performUpkeep()`:
```solidity
} else if (taskType == TaskType.GuildMaintenance) {
    // Call TavernGuild periodic maintenance
    // (e.g., check anniversary milestones, top guild rankings)
}
```

### 4-C. Add Guild Contract Reference

```solidity
address public guildContract;

function setGuildContract(address _guild) external onlyRole(DEFAULT_ADMIN_ROLE) {
    guildContract = _guild;
}
```

---

## Part 5 — Tests

### 5-A. TavernEquipment Tests

Create `test/TavernEquipment.test.ts`:

1. **Item Registration**: Register items, verify metadata
2. **Minting**: Mint items, verify balances, verify maxSupply enforcement
3. **Level Rewards**: Call `mintLevelReward()`, verify correct items minted per level
4. **Equipment**: Equip/unequip items, verify loadout
5. **Title**: Equip title, verify activeTitle
6. **Soulbound**: Verify soulbound items cannot be transferred
7. **Supply Cap**: Verify minting fails when maxSupply reached
8. **Duplicate Prevention**: Verify same item cannot be minted twice to same user

### 5-B. TavernGuild Tests

Create `test/TavernGuild.test.ts`:

1. **Guild Creation**: Create guild, verify state
2. **Membership**: Join, leave, verify member list
3. **Guild EXP**: Record member quests, verify guild EXP accrual
4. **Guild Level Up**: Verify level calculation with `20 * level^2.2`
5. **Achievement NFTs**: Verify NFT minting on milestone achievement
6. **Mastership Transfer**: Transfer master role, verify access
7. **Dissolution**: Dissolve guild, verify TVRN return

### 5-C. TavernClientRPG Refactored Tests

Update `test/TavernClientRPG.test.ts`:

1. **Remove all season tests** (season migration, season reset, legacy bonus)
2. **Level Cap**: Verify level cannot exceed 100
3. **Formula Accuracy**: Verify `levelThreshold()` matches `20 * level^2.2` for all 100 levels
4. **Binary Search**: Verify `_calculateLevel()` returns correct level for edge cases
5. **NFT Auto-Mint**: Verify `mintLevelReward()` called on level-up
6. **Multi-Level Jump**: If user gains enough EXP to skip levels, verify all intermediate level rewards minted
7. **Withdrawal**: Verify withdrawal works without season check

### 5-D. Integration Tests

Create `test/NFTIntegration.test.ts`:

1. **Full Flow**: Register → complete quests → gain EXP → level up → NFT auto-minted → equip → verify loadout
2. **Guild Flow**: Create guild → members join → complete quests → guild levels up → guild NFT minted
3. **Cross-Contract**: Verify TavernEscrow → TavernClientRPG → TavernEquipment chain works

---

## Part 6 — Deploy Script Preparation

Create `deploy/09_nft_system.ts` (DO NOT EXECUTE — just write the script):

```typescript
// Deployment order:
// 1. Deploy TavernEquipment (with metadata URI)
// 2. Deploy TavernGuild (with references to Equipment, RPG, Staking)
// 3. Upgrade/redeploy TavernClientRPG (with Equipment + Guild references)
// 4. Update TavernAutomationRouter (set guild contract)
// 5. Grant roles:
//    - TavernEquipment.MINTER_ROLE → TavernClientRPG
//    - TavernEquipment.GUILD_ROLE → TavernGuild
//    - TavernGuild.ESCROW_ROLE → TavernEscrow
// 6. Register all 145 items via registerItemBatch()
// 7. Set level rewards via setLevelRewards() for levels 1-10
// 8. Set thresholds via setThresholds() (101 values)
// 9. Update frontend addresses
```

---

## Part 7 — Threshold Table Script

Create `scripts/generate-thresholds.ts`:

```typescript
import { ethers } from "hardhat";

async function main() {
    const thresholds: string[] = [];
    for (let lv = 0; lv <= 100; lv++) {
        if (lv === 0) {
            thresholds.push("0");
        } else {
            const t = Math.floor(20 * Math.pow(lv, 2.2));
            thresholds.push(t.toString());
        }
    }

    console.log("Level thresholds (20 * level^2.2):");
    console.log(JSON.stringify(thresholds));

    // Spot checks
    console.log(`Lv.1: ${thresholds[1]} (expected: 20)`);
    console.log(`Lv.5: ${thresholds[5]} (expected: ~621)`);
    console.log(`Lv.10: ${thresholds[10]} (expected: ~2738)`);
    console.log(`Lv.50: ${thresholds[50]} (expected: ~89637)`);
    console.log(`Lv.100: ${thresholds[100]} (expected: ~502377)`);
}

main().catch(console.error);
```

---

## Part 8 — Item Registration Script

Create `scripts/register-nft-items.ts`:

This script should encode the `registerItemBatch()` call for all 145 items defined in `NFT_SYSTEM_DESIGN.md`. Split into batches of 30 items to stay within gas limits.

Include all items from:
- Category A: Equipment #1-60
- Category B: Titles #61-80
- Category C: Guild Decorations #81-100
- Category D: Special/Event #101-120
- Category E: Contributor Tracks #121-145

---

## File Output

```
contracts/
├── TavernEquipment.sol       ← NEW: ERC-1155 NFT system
├── TavernGuild.sol           ← NEW: Guild system
├── TavernClientRPG.sol       ← MODIFIED: Season removed, Lv.100 cap, NFT integration
├── TavernAutomationRouter.sol ← MODIFIED: SeasonReset → GuildMaintenance

test/
├── TavernEquipment.test.ts   ← NEW
├── TavernGuild.test.ts       ← NEW
├── TavernClientRPG.test.ts   ← MODIFIED (remove season tests, add NFT/level tests)
├── NFTIntegration.test.ts    ← NEW

scripts/
├── generate-thresholds.ts    ← NEW
├── register-nft-items.ts     ← NEW

deploy/
├── 09_nft_system.ts          ← NEW (script only, DO NOT execute)
```

---

## Acceptance Checklist

### TavernEquipment.sol
- [ ] ERC-1155 compliant
- [ ] 145-item registry with Category, Rarity, Slot, maxSupply, soulbound flag
- [ ] `mintLevelReward(address, uint256)` mints correct items per level
- [ ] `mintGuildReward(address, uint256)` callable by GUILD_ROLE
- [ ] `adminMint(address, uint256)` callable by ADMIN_ROLE
- [ ] Equipment loadout (6 slots) equip/unequip
- [ ] Title system (equipTitle, activeTitle)
- [ ] Soulbound transfer restriction via `_update()` override
- [ ] Max supply enforcement
- [ ] Duplicate prevention (user can't own 2 of same item)
- [ ] `registerItemBatch()` for gas-efficient setup
- [ ] `setLevelRewards()` for level→item mapping

### TavernGuild.sol
- [ ] Guild creation with TVRN stake
- [ ] Join/leave guild
- [ ] Guild EXP accrual from member quests
- [ ] Guild level system (`20 * level^2.2`, capped at 100)
- [ ] Achievement checking → NFT minting for guild decorations
- [ ] Mastership transfer
- [ ] Guild dissolution with TVRN return
- [ ] Events for all state changes

### TavernClientRPG.sol (Refactored)
- [ ] All season-related code removed
- [ ] `MAX_LEVEL = 100` enforced
- [ ] Precomputed threshold table (101 values)
- [ ] Binary search `_calculateLevel()` for gas efficiency
- [ ] `equipmentContract` setter + NFT auto-mint on level-up
- [ ] `guildContract` setter
- [ ] Simplified `_prepareClient()` (no season migration)
- [ ] Simplified `_checkWithdrawalEligible()` (no season stats)
- [ ] Backward-compatible: existing ClientProfile struct unchanged
- [ ] All existing EXP grant functions still work

### TavernAutomationRouter.sol
- [ ] `SeasonReset` replaced with `GuildMaintenance` (same enum index 8)
- [ ] `guildContract` address added
- [ ] `checkUpkeep()` / `performUpkeep()` updated for guild maintenance

### Tests
- [ ] TavernEquipment: item registration, minting, equipment, soulbound, supply cap
- [ ] TavernGuild: creation, membership, EXP, leveling, achievements
- [ ] TavernClientRPG: no season tests, new level cap tests, NFT integration tests
- [ ] Integration: full quest→EXP→level→NFT flow
- [ ] `npx hardhat test` — all pass
- [ ] `npx tsc --noEmit` — passes

### Scripts
- [ ] `generate-thresholds.ts` outputs 101 correct values
- [ ] `register-nft-items.ts` encodes all 145 items
- [ ] `09_nft_system.ts` deploy script structure (not executed)
