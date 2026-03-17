// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

import "./interfaces/ITavernEquipment.sol";
import "./libraries/TavernLevelThresholds.sol";

contract TavernGuild is AccessControl {
    uint8 public constant GUILD_COUNT = 8;
    uint256 public constant MAX_GUILD_LEVEL = 100;
    uint256 public constant GUILD_EXP_PER_COMPLETION = 20;

    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
    bytes32 public constant SERVICE_REGISTRY_ROLE = keccak256("SERVICE_REGISTRY_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    struct GuildInfo {
        string name;
        uint256 memberCount;
        uint256 totalCompletions;
        uint256 totalVolume;
        uint256 guildExp;
        uint256 guildLevel;
        bool active;
    }

    struct GuildMember {
        uint256 completions;
        uint256 volume;
        uint256 rating;
        uint256 ratingCount;
        uint256 joinedAt;
    }

    ITavernEquipment public equipment;
    uint256 public maintenanceInterval;
    uint256 public lastMaintenanceAt;

    mapping(uint8 => GuildInfo) public guilds;
    mapping(uint8 => address[]) private _guildMembers;
    mapping(uint8 => mapping(address => GuildMember)) public guildMemberInfo;
    mapping(address => uint8[]) private _memberGuilds;
    mapping(address => mapping(uint8 => bool)) public isInGuild;
    mapping(uint8 => mapping(uint256 => bool)) public milestoneRewardMinted;

    uint256[101] private _thresholds;

    event MemberJoined(uint8 indexed guildId, address indexed member);
    event MemberLeft(uint8 indexed guildId, address indexed member);
    event GuildLevelUp(uint8 indexed guildId, uint256 oldLevel, uint256 newLevel);
    event CompletionRecorded(uint8 indexed guildId, address indexed agent, uint256 volume);
    event RatingRecorded(uint8 indexed guildId, address indexed agent, uint256 rating);
    event EquipmentSet(address indexed equipment);
    event GuildActiveSet(uint8 indexed guildId, bool active);
    event MaintenanceIntervalSet(uint256 interval);
    event MaintenancePerformed(uint256 timestamp);
    event ThresholdsUpdated(uint256 count);

    modifier onlyEscrowOrServiceRegistry() {
        require(
            hasRole(ESCROW_ROLE, msg.sender) || hasRole(SERVICE_REGISTRY_ROLE, msg.sender),
            "Missing role"
        );
        _;
    }

    constructor(address equipment_) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        if (equipment_ != address(0)) {
            equipment = ITavernEquipment(equipment_);
        }

        guilds[0] = GuildInfo("Artificers Guild", 0, 0, 0, 0, 0, true);
        guilds[1] = GuildInfo("Scribes Guild", 0, 0, 0, 0, 0, true);
        guilds[2] = GuildInfo("Forge Guild", 0, 0, 0, 0, 0, true);
        guilds[3] = GuildInfo("Oracle Guild", 0, 0, 0, 0, 0, true);
        guilds[4] = GuildInfo("Artisan Guild", 0, 0, 0, 0, 0, true);
        guilds[5] = GuildInfo("Herald Guild", 0, 0, 0, 0, 0, true);
        guilds[6] = GuildInfo("Strategist Guild", 0, 0, 0, 0, 0, true);
        guilds[7] = GuildInfo("Sentinel Guild", 0, 0, 0, 0, 0, true);

        _thresholds = TavernLevelThresholds.defaultThresholds();
        maintenanceInterval = 30 days;
        lastMaintenanceAt = block.timestamp;
    }

    function addMember(uint8 guildId, address member) external onlyRole(SERVICE_REGISTRY_ROLE) {
        require(guildId < GUILD_COUNT, "Invalid guild");
        require(member != address(0), "Member zero");
        require(!isInGuild[member][guildId], "Already in guild");
        require(guilds[guildId].active, "Guild paused");

        isInGuild[member][guildId] = true;
        _memberGuilds[member].push(guildId);
        _guildMembers[guildId].push(member);
        guilds[guildId].memberCount += 1;

        GuildMember storage membership = guildMemberInfo[guildId][member];
        if (membership.joinedAt == 0) {
            membership.joinedAt = block.timestamp;
        } else {
            membership.joinedAt = block.timestamp;
        }

        emit MemberJoined(guildId, member);
    }

    function leaveGuild(uint8 guildId) external {
        require(isInGuild[msg.sender][guildId], "Not in guild");

        isInGuild[msg.sender][guildId] = false;
        if (guilds[guildId].memberCount > 0) {
            guilds[guildId].memberCount -= 1;
        }
        _removeMemberGuild(msg.sender, guildId);

        emit MemberLeft(guildId, msg.sender);
    }

    function recordGuildCompletion(address agent, uint8 guildId, uint256 volume)
        external
        onlyEscrowOrServiceRegistry
    {
        if (guildId >= GUILD_COUNT || !isInGuild[agent][guildId]) {
            return;
        }

        GuildMember storage member = guildMemberInfo[guildId][agent];
        GuildInfo storage guild = guilds[guildId];

        member.completions += 1;
        member.volume += volume;

        guild.totalCompletions += 1;
        guild.totalVolume += volume;
        guild.guildExp += GUILD_EXP_PER_COMPLETION;

        uint256 newLevel = _calculateLevel(guild.guildExp);
        if (newLevel > guild.guildLevel) {
            uint256 oldLevel = guild.guildLevel;
            guild.guildLevel = newLevel;
            emit GuildLevelUp(guildId, oldLevel, newLevel);
        }

        _checkGuildAchievements(guildId);
        emit CompletionRecorded(guildId, agent, volume);
    }

    function recordRating(address agent, uint8 guildId, uint256 rating)
        external
        onlyEscrowOrServiceRegistry
    {
        require(rating >= 10 && rating <= 50, "Invalid rating");
        if (guildId >= GUILD_COUNT || !isInGuild[agent][guildId]) {
            return;
        }

        GuildMember storage member = guildMemberInfo[guildId][agent];
        member.rating += rating;
        member.ratingCount += 1;

        emit RatingRecorded(guildId, agent, rating);
    }

    function getGuildMembers(uint8 guildId) external view returns (address[] memory) {
        require(guildId < GUILD_COUNT, "Invalid guild");
        return _guildMembers[guildId];
    }

    function getMemberGuilds(address member) external view returns (uint8[] memory) {
        return _memberGuilds[member];
    }

    function memberGuild(address member) external view returns (uint8) {
        if (_memberGuilds[member].length == 0) {
            return type(uint8).max;
        }
        return _memberGuilds[member][0];
    }

    function getAverageRating(uint8 guildId, address member) external view returns (uint256) {
        GuildMember storage membership = guildMemberInfo[guildId][member];
        if (membership.ratingCount == 0) {
            return 0;
        }
        return membership.rating / membership.ratingCount;
    }

    function levelThreshold(uint256 level) external view returns (uint256) {
        if (level == 0) {
            return 0;
        }
        if (level > MAX_GUILD_LEVEL) {
            return type(uint256).max;
        }
        return _thresholds[level];
    }

    function setThresholds(uint256[] calldata thresholds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(thresholds.length == MAX_GUILD_LEVEL + 1, "Invalid length");
        for (uint256 i = 0; i <= MAX_GUILD_LEVEL;) {
            _thresholds[i] = thresholds[i];
            unchecked {
                ++i;
            }
        }
        emit ThresholdsUpdated(thresholds.length);
    }

    function setEquipment(address equipment_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        equipment = ITavernEquipment(equipment_);
        emit EquipmentSet(equipment_);
    }

    function setGuildActive(uint8 guildId, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(guildId < GUILD_COUNT, "Invalid guild");
        guilds[guildId].active = active;
        emit GuildActiveSet(guildId, active);
    }

    function setMaintenanceInterval(uint256 interval) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(interval > 0, "Interval zero");
        maintenanceInterval = interval;
        emit MaintenanceIntervalSet(interval);
    }

    function needsMaintenance() external view returns (bool) {
        return block.timestamp >= lastMaintenanceAt + maintenanceInterval;
    }

    function performMaintenance() external onlyRole(KEEPER_ROLE) {
        require(block.timestamp >= lastMaintenanceAt + maintenanceInterval, "Too early");
        lastMaintenanceAt = block.timestamp;
        emit MaintenancePerformed(block.timestamp);
    }

    function _calculateLevel(uint256 exp) internal view returns (uint256) {
        uint256 low = 1;
        uint256 high = MAX_GUILD_LEVEL;
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

    function _checkGuildAchievements(uint8 guildId) internal {
        GuildInfo storage guild = guilds[guildId];

        _maybeMintMilestone(guildId, guild.totalCompletions, 10, 84);
        _maybeMintMilestone(guildId, guild.totalCompletions, 50, 86);
        _maybeMintMilestone(guildId, guild.totalCompletions, 200, 89);
        _maybeMintMilestone(guildId, guild.totalCompletions, 1000, 95);
    }

    function _maybeMintMilestone(
        uint8 guildId,
        uint256 completions,
        uint256 milestone,
        uint256 tokenId
    ) internal {
        if (completions != milestone || milestoneRewardMinted[guildId][milestone]) {
            return;
        }

        milestoneRewardMinted[guildId][milestone] = true;
        address topContributor = _getTopContributor(guildId);
        if (topContributor != address(0) && address(equipment) != address(0)) {
            try equipment.mintGuildReward(topContributor, tokenId) {} catch {}
        }
    }

    function _getTopContributor(uint8 guildId) internal view returns (address topContributor) {
        address[] storage members = _guildMembers[guildId];
        uint256 highestCompletions = 0;
        uint256 highestVolume = 0;

        for (uint256 i = 0; i < members.length;) {
            address member = members[i];
            GuildMember storage membership = guildMemberInfo[guildId][member];
            if (
                membership.completions > highestCompletions
                    || (
                        membership.completions == highestCompletions
                            && membership.volume > highestVolume
                    )
            ) {
                topContributor = member;
                highestCompletions = membership.completions;
                highestVolume = membership.volume;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _removeMemberGuild(address member, uint8 guildId) internal {
        uint8[] storage guildIds = _memberGuilds[member];
        uint256 length = guildIds.length;

        for (uint256 i = 0; i < length;) {
            if (guildIds[i] == guildId) {
                guildIds[i] = guildIds[length - 1];
                guildIds.pop();
                return;
            }
            unchecked {
                ++i;
            }
        }
    }
}
