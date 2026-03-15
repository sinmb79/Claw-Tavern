// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./TavernToken.sol";
import "./contracts/interfaces/ITavernStaking.sol";
import "./contracts/interfaces/IERC8004IdentityRegistry.sol";
import "./contracts/interfaces/IERC8004ReputationRegistry.sol";

/**
 * @title TavernRegistry
 * @notice Guild, agent, master-agent, and rolling quota registry for Phase 1.
 */
contract TavernRegistry is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    uint256 public constant DISSOLUTION_PERIOD = 30 days;
    uint256 public constant MIN_FOUNDING_MEMBERS = 3;
    uint256 public constant MAX_GUILD_FEE_RATE = 1000;
    uint256 public constant MIN_QUOTA = 500;
    uint256 public constant MAX_DAILY_CHANGE = 2000;
    uint256 public constant HYSTERESIS_BPS = 200;
    uint256 public constant MASTER_SETTLE_INTERVAL = 30 days;
    uint256 public constant EJECTION_WARNING_THRESHOLD_BPS = 1000;
    uint256 public constant MAX_CONSECUTIVE_WARNINGS = 2;
    uint256 public constant EJECTION_BAN_DURATION = 90 days;
    uint256 public constant MAX_EJECTIONS_BEFORE_BAN = 3;
    uint256 public constant APPEAL_WINDOW = 7 days;

    TavernToken public guildToken;
    ITavernStaking public stakingContract;
    address public erc8004IdentityRegistry;
    address public erc8004ReputationRegistry;
    bool public erc8004Required;

    enum GuildStatus {
        Pending,
        Active,
        Suspended,
        Dissolved
    }

    struct Guild {
        uint256 id;
        string name;
        string specialty;
        address founder;
        uint256 createdAt;
        uint256 lastActiveAt;
        uint256 memberCount;
        uint256 questsCompleted;
        uint256 totalEarned;
        uint256 registrationFee;
        uint256 feeRate;
        GuildStatus status;
        bool isFoundingGuild;
    }

    enum AgentRank {
        Apprentice,
        Trainee,
        Elite,
        Artisan,
        Legend
    }

    struct AgentProfile {
        uint256 guildId;
        AgentRank rank;
        uint256 reputation;
        uint256 questsDone;
        uint256 totalEarned;
        uint256 joinedAt;
        bool isActive;
        string modelType;
        address wallet;
    }

    struct GuildApplication {
        string name;
        string specialty;
        address founder;
        address[] initialMembers;
        uint256 appliedAt;
        bool processed;
    }

    struct MasterContribution {
        uint256 uptimeSeconds;
        uint256 jobsProcessed;
        uint256 satisfactionSum;
        uint256 satisfactionCount;
        uint256 lastUptimePing;
    }

    struct AgentMonthlyPerformance {
        uint256 questsCompleted;
        uint256 reputationScore;
        uint256 warningCount;
        uint256 ejectionCount;
        uint256 bannedUntil;
        uint256 lastEjectedAt;
    }

    enum AppealState {
        Filed,
        UnderReview,
        Accepted,
        Rejected,
        EscalatedToDAO
    }

    struct Appeal {
        address agent;
        uint256 filedAt;
        AppealState state;
        string reason;
        address arbiter;
    }

    uint256 public guildCount;
    uint256 public appCount;
    uint256 public globalRegistrationFee = 0;

    uint256[5] public yearMultiplier = [uint256(5), 4, 3, 2, 1];
    uint256 public masterStartTimestamp;
    uint256 public masterExpiryPrimary;
    uint256 public masterExpirySecondary;
    mapping(address => bool) public isMasterFounder;
    mapping(address => bool) public isMasterSuccessor;
    mapping(address => bool) public isFoundingAgent;
    mapping(address => uint256) public erc8004TokenIdOfAgent;
    mapping(address => bool) public hasERC8004Identity;
    mapping(uint256 => address) public erc8004AgentOfTokenId;
    mapping(address => MasterContribution) public masterContributions;
    mapping(address => AgentMonthlyPerformance) public agentPerformance;
    mapping(uint256 => Appeal) public appeals;

    address[] public masterAgentList;
    address[] public activeAgentList;
    uint256 public lastMasterSettlementAt;
    uint256 public masterMonthlyBudgetTVRN = 5_600_000 * 1e18;
    uint256 public nextAppealId;

    uint256[6] public jobQuota;
    uint256[3][6] public rollingScores; // [job][daySlot]
    uint256 public rollingDay;

    mapping(uint256 => Guild) public guilds;
    mapping(string => uint256) public guildNameToId;
    mapping(address => AgentProfile) public agents;
    mapping(uint256 => address[]) public guildMembers;
    mapping(uint256 => GuildApplication) public applications;

    event GuildApplicationSubmitted(uint256 indexed appId, string name, address founder);
    event GuildActivated(uint256 indexed guildId, string name);
    event GuildDissolved(uint256 indexed guildId, string reason);
    event AgentJoined(uint256 indexed guildId, address agent, AgentRank rank);
    event AgentRankUp(address indexed agent, AgentRank newRank);
    event ReputationUpdated(address indexed agent, uint256 newRep, int256 delta);
    event QuotaRebalanced(uint256[6] jobQuota, uint256 timestamp);
    event MasterFounderUpdated(address indexed agent, bool enabled);
    event MasterSuccessorUpdated(address indexed agent, bool enabled);
    event FoundingAgentSet(address indexed agent, bool enabled);
    event StakingContractUpdated(address indexed stakingContract);
    event AgentStatusUpdated(address indexed agent, uint256 indexed guildId, bool isActive);
    event ERC8004ConfigUpdated(
        address indexed identityRegistry,
        address indexed reputationRegistry,
        bool required
    );
    event ERC8004IdentityLinked(address indexed agent, uint256 indexed tokenId);
    event ERC8004ReputationMirrored(
        address indexed agent,
        uint256 indexed tokenId,
        int256 value,
        string tag1,
        string tag2
    );
    event ERC8004ReputationMirrorFailed(address indexed agent, uint256 indexed tokenId, string reason);
    event MasterContributionRecorded(
        address indexed agent,
        uint256 uptimeSeconds,
        uint256 jobsProcessed,
        uint256 satisfactionScore
    );
    event MasterRewardDistributed(address indexed agent, uint256 tvrnAmount, uint256 multiplier);
    event MasterSettlementExecuted(uint256 totalRewardTVRN, uint256 masterCount, uint256 timestamp);
    event MasterMonthlyBudgetUpdated(uint256 amount);
    event AgentWarned(address indexed agent, uint256 consecutiveWarnings);
    event AgentEjected(address indexed agent, string reason);
    event AgentBanned(address indexed agent, uint256 bannedUntil);
    event AppealFiled(uint256 indexed appealId, address indexed agent, string reason);
    event AppealResolved(uint256 indexed appealId, AppealState result);
    event AppealEscalated(uint256 indexed appealId);

    constructor(address _guildToken) {
        guildToken = TavernToken(_guildToken);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(KEEPER_ROLE, msg.sender);

        masterStartTimestamp = block.timestamp;
        masterExpiryPrimary = block.timestamp + (5 * 365 days);
        masterExpirySecondary = block.timestamp + (5 * 365 days) + 180 days;
        lastMasterSettlementAt = block.timestamp;

        _initJobQuotas();
        _initFoundingGuilds();
    }

    function _initFoundingGuilds() internal {
        string[5] memory names = [
            unicode"추론 길드",
            unicode"코딩 길드",
            unicode"경제 길드",
            unicode"오케스트레이션 길드",
            unicode"도우미 길드"
        ];
        string[5] memory specs = [
            "reasoning",
            "coding",
            "economy",
            "orchestration",
            "assistant"
        ];

        for (uint256 i = 0; i < names.length;) {
            guildCount++;
            guilds[guildCount] = Guild({
                id: guildCount,
                name: names[i],
                specialty: specs[i],
                founder: address(0),
                createdAt: block.timestamp,
                lastActiveAt: block.timestamp,
                memberCount: 0,
                questsCompleted: 0,
                totalEarned: 0,
                registrationFee: 0,
                feeRate: 300,
                status: GuildStatus.Active,
                isFoundingGuild: true
            });
            guildNameToId[names[i]] = guildCount;
            unchecked {
                ++i;
            }
        }
    }

    function _initJobQuotas() internal {
        jobQuota[0] = 1667;
        jobQuota[1] = 1667;
        jobQuota[2] = 1667;
        jobQuota[3] = 1667;
        jobQuota[4] = 1666;
        jobQuota[5] = 1666;
    }

    function applyForGuild(
        string calldata name,
        string calldata specialty,
        address[] calldata initialMembers
    ) external nonReentrant {
        require(guildNameToId[name] == 0, "Guild name already exists");
        require(
            initialMembers.length >= MIN_FOUNDING_MEMBERS - 1,
            "Need at least 2 additional founding members"
        );

        if (globalRegistrationFee > 0) {
            IERC20(address(guildToken)).safeTransferFrom(msg.sender, address(this), globalRegistrationFee);
        }

        unchecked {
            appCount++;
        }
        address[] memory members = new address[](initialMembers.length);
        for (uint256 i = 0; i < initialMembers.length;) {
            members[i] = initialMembers[i];
            unchecked {
                ++i;
            }
        }

        applications[appCount] = GuildApplication({
            name: name,
            specialty: specialty,
            founder: msg.sender,
            initialMembers: members,
            appliedAt: block.timestamp,
            processed: false
        });

        emit GuildApplicationSubmitted(appCount, name, msg.sender);
    }

    function processApplication(uint256 appId, bool approve) external onlyRole(ARBITER_ROLE) {
        GuildApplication storage app = applications[appId];
        require(!app.processed, "Already processed");
        app.processed = true;

        if (!approve) {
            return;
        }

        guildCount++;
        guilds[guildCount] = Guild({
            id: guildCount,
            name: app.name,
            specialty: app.specialty,
            founder: app.founder,
            createdAt: block.timestamp,
            lastActiveAt: block.timestamp,
            memberCount: 0,
            questsCompleted: 0,
            totalEarned: 0,
            registrationFee: 0,
            feeRate: 300,
            status: GuildStatus.Active,
            isFoundingGuild: false
        });
        guildNameToId[app.name] = guildCount;

        emit GuildActivated(guildCount, app.name);
    }

    function joinGuild(uint256 guildId, string calldata modelType) external nonReentrant {
        Guild storage g = guilds[guildId];
        address sender = msg.sender;
        require(g.id != 0, "Guild not found");
        require(g.status == GuildStatus.Active, "Guild not active");
        require(!agents[sender].isActive, "Already in a guild");
        require(address(stakingContract) != address(0), "Staking contract not set");
        require(stakingContract.isStaked(sender), "Stake 100 TVRN first");
        require(!erc8004Required || hasValidERC8004Identity(sender), "Valid ERC-8004 identity required");
        require(agentPerformance[sender].bannedUntil <= block.timestamp, "Agent is temporarily banned");

        if (g.registrationFee > 0) {
            IERC20(address(guildToken)).safeTransferFrom(sender, address(this), g.registrationFee);
        }

        agents[sender] = AgentProfile({
            guildId: guildId,
            rank: AgentRank.Apprentice,
            reputation: 100,
            questsDone: 0,
            totalEarned: 0,
            joinedAt: block.timestamp,
            isActive: true,
            modelType: modelType,
            wallet: sender
        });

        guildMembers[guildId].push(sender);
        g.memberCount++;
        _addActiveAgent(sender);

        emit AgentJoined(guildId, sender, AgentRank.Apprentice);
        emit AgentStatusUpdated(sender, guildId, true);
    }

    function setStakingContract(address stakingAddress) external onlyRole(ADMIN_ROLE) {
        require(stakingAddress != address(0), "Invalid staking contract");
        stakingContract = ITavernStaking(stakingAddress);
        emit StakingContractUpdated(stakingAddress);
    }

    function leaveGuild() external {
        _setAgentStatus(msg.sender, false);
    }

    function removeAgent(address agent) external {
        require(
            hasRole(ARBITER_ROLE, msg.sender) || hasRole(ADMIN_ROLE, msg.sender),
            "Missing admin or arbiter role"
        );
        _setAgentStatus(agent, false);
    }

    function updateReputation(address agent, int256 delta) external onlyRole(ARBITER_ROLE) {
        AgentProfile storage p = agents[agent];
        require(p.isActive, "Agent not active");
        AgentMonthlyPerformance storage perf = agentPerformance[agent];

        if (delta > 0) {
            p.reputation = _min(p.reputation + uint256(delta), 10000);
        } else {
            uint256 penalty = uint256(-delta);
            p.reputation = p.reputation > penalty ? p.reputation - penalty : 0;
        }

        p.questsDone++;
        perf.questsCompleted++;
        perf.reputationScore += p.reputation;
        _checkRankUp(agent);

        emit ReputationUpdated(agent, p.reputation, delta);
    }

    function _checkRankUp(address agent) internal {
        AgentProfile storage p = agents[agent];
        AgentRank newRank = p.rank;

        if (p.reputation >= 9000 && p.questsDone >= 500) {
            newRank = AgentRank.Legend;
        } else if (p.reputation >= 7000 && p.questsDone >= 100) {
            newRank = AgentRank.Artisan;
        } else if (p.reputation >= 5000 && p.questsDone >= 30) {
            newRank = AgentRank.Elite;
        } else if (p.reputation >= 2000 && p.questsDone >= 5) {
            newRank = AgentRank.Trainee;
        }

        if (newRank != p.rank) {
            p.rank = newRank;
            emit AgentRankUp(agent, newRank);
        }
    }

    function dissolveInactiveGuild(uint256 guildId) external {
        Guild storage g = guilds[guildId];
        require(g.status == GuildStatus.Active, "Not active");
        require(!g.isFoundingGuild, "Cannot dissolve founding guild");
        require(block.timestamp >= g.lastActiveAt + DISSOLUTION_PERIOD, "Guild still active");

        g.status = GuildStatus.Dissolved;
        emit GuildDissolved(guildId, "Inactivity");
    }

    function recordGuildActivity(uint256 guildId, uint256 earnedUsdc) external onlyRole(ARBITER_ROLE) {
        Guild storage g = guilds[guildId];
        require(g.id != 0, "Guild not found");

        g.lastActiveAt = block.timestamp;
        g.questsCompleted++;
        g.totalEarned += earnedUsdc;
    }

    function setMasterFounder(address agent, bool enabled) external onlyRole(ADMIN_ROLE) {
        isMasterFounder[agent] = enabled;
        _syncMasterAgentList(agent);
        emit MasterFounderUpdated(agent, enabled);
    }

    function setMasterSuccessor(address agent, bool enabled) external onlyRole(ADMIN_ROLE) {
        isMasterSuccessor[agent] = enabled;
        _syncMasterAgentList(agent);
        emit MasterSuccessorUpdated(agent, enabled);
    }

    function setFoundingAgent(address agent, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isFoundingAgent[agent] = enabled;
        emit FoundingAgentSet(agent, enabled);
    }

    function setERC8004Config(
        address identityRegistry,
        address reputationRegistry,
        bool required
    ) external onlyRole(ADMIN_ROLE) {
        if (required) {
            require(identityRegistry != address(0), "Identity registry required");
        }

        if (reputationRegistry != address(0)) {
            require(identityRegistry != address(0), "Identity registry required");
            require(
                IERC8004ReputationRegistry(reputationRegistry).getIdentityRegistry() == identityRegistry,
                "ERC-8004 registry mismatch"
            );
        }

        erc8004IdentityRegistry = identityRegistry;
        erc8004ReputationRegistry = reputationRegistry;
        erc8004Required = required;

        emit ERC8004ConfigUpdated(identityRegistry, reputationRegistry, required);
    }

    function registerWithERC8004(uint256 tokenId) external returns (bool registered) {
        require(erc8004IdentityRegistry != address(0), "ERC-8004 identity registry not set");

        IERC8004IdentityRegistry identityRegistry = IERC8004IdentityRegistry(erc8004IdentityRegistry);
        require(identityRegistry.ownerOf(tokenId) == msg.sender, "Not ERC-8004 owner");
        require(bytes(identityRegistry.tokenURI(tokenId)).length > 0, "ERC-8004 URI missing");

        address existingAgent = erc8004AgentOfTokenId[tokenId];
        require(existingAgent == address(0) || existingAgent == msg.sender, "ERC-8004 token already linked");

        if (hasERC8004Identity[msg.sender]) {
            uint256 oldTokenId = erc8004TokenIdOfAgent[msg.sender];
            if (oldTokenId != tokenId) {
                delete erc8004AgentOfTokenId[oldTokenId];
            }
        }

        erc8004TokenIdOfAgent[msg.sender] = tokenId;
        hasERC8004Identity[msg.sender] = true;
        erc8004AgentOfTokenId[tokenId] = msg.sender;

        emit ERC8004IdentityLinked(msg.sender, tokenId);
        return true;
    }

    function hasValidERC8004Identity(address agent) public view returns (bool) {
        if (erc8004IdentityRegistry == address(0) || !hasERC8004Identity[agent]) {
            return false;
        }

        uint256 tokenId = erc8004TokenIdOfAgent[agent];
        IERC8004IdentityRegistry identityRegistry = IERC8004IdentityRegistry(erc8004IdentityRegistry);

        try identityRegistry.ownerOf(tokenId) returns (address owner) {
            if (owner != agent) {
                return false;
            }
        } catch {
            return false;
        }

        try identityRegistry.tokenURI(tokenId) returns (string memory uri) {
            return bytes(uri).length > 0;
        } catch {
            return false;
        }
    }

    function mirrorERC8004Reputation(
        address agent,
        int256 delta,
        string calldata tag1,
        string calldata tag2
    ) external onlyRole(ARBITER_ROLE) returns (bool mirrored) {
        if (erc8004ReputationRegistry == address(0) || delta == 0 || !hasValidERC8004Identity(agent)) {
            return false;
        }

        if (delta > type(int128).max || delta < type(int128).min) {
            emit ERC8004ReputationMirrorFailed(agent, erc8004TokenIdOfAgent[agent], "Delta out of bounds");
            return false;
        }

        uint256 tokenId = erc8004TokenIdOfAgent[agent];

        try IERC8004ReputationRegistry(erc8004ReputationRegistry).giveFeedback(
            tokenId,
            int128(delta),
            0,
            tag1,
            tag2,
            "",
            "",
            bytes32(0)
        ) {
            emit ERC8004ReputationMirrored(agent, tokenId, delta, tag1, tag2);
            return true;
        } catch Error(string memory reason) {
            emit ERC8004ReputationMirrorFailed(agent, tokenId, reason);
            return false;
        } catch {
            emit ERC8004ReputationMirrorFailed(agent, tokenId, "Low-level ERC-8004 reputation error");
            return false;
        }
    }

    function getCurrentMultiplier() public view returns (uint256) {
        if (block.timestamp >= masterExpiryPrimary) {
            return 1;
        }

        uint256 elapsed = block.timestamp - masterStartTimestamp;
        uint256 year = elapsed / 365 days;

        if (year >= yearMultiplier.length) {
            return 1;
        }

        return yearMultiplier[year];
    }

    function setMasterMonthlyBudget(uint256 amount) external onlyRole(ADMIN_ROLE) {
        masterMonthlyBudgetTVRN = amount;
        emit MasterMonthlyBudgetUpdated(amount);
    }

    function recordMasterJobCompletion(address agent, uint256 satisfactionScore)
        external
        onlyRole(ARBITER_ROLE)
    {
        require(_isMasterAgent(agent), "Not a master");
        require(satisfactionScore <= 100, "Score too high");

        MasterContribution storage contribution = masterContributions[agent];
        contribution.jobsProcessed += 1;
        contribution.satisfactionSum += satisfactionScore;
        contribution.satisfactionCount += 1;

        emit MasterContributionRecorded(
            agent,
            contribution.uptimeSeconds,
            contribution.jobsProcessed,
            satisfactionScore
        );
    }

    function recordMasterUptime(address agent) external onlyRole(KEEPER_ROLE) {
        require(_isMasterAgent(agent), "Not a master");

        MasterContribution storage contribution = masterContributions[agent];
        if (contribution.lastUptimePing > 0) {
            uint256 elapsed = block.timestamp - contribution.lastUptimePing;
            if (elapsed <= 1 hours) {
                contribution.uptimeSeconds += elapsed;
            }
        }

        contribution.lastUptimePing = block.timestamp;
        emit MasterContributionRecorded(
            agent,
            contribution.uptimeSeconds,
            contribution.jobsProcessed,
            contribution.satisfactionCount == 0 ? 0 : contribution.satisfactionSum / contribution.satisfactionCount
        );
    }

    function monthlyMasterSettle() external onlyRole(KEEPER_ROLE) {
        require(block.timestamp >= lastMasterSettlementAt + MASTER_SETTLE_INTERVAL, "Too early");
        lastMasterSettlementAt = block.timestamp;

        uint256 masterCount = masterAgentList.length;
        if (masterCount == 0) {
            return;
        }

        uint256[] memory scores = new uint256[](masterCount);
        uint256 totalScore = 0;
        uint256 maxUptime = 1;
        uint256 maxJobs = 1;

        for (uint256 i = 0; i < masterCount;) {
            MasterContribution memory contribution = masterContributions[masterAgentList[i]];
            if (contribution.uptimeSeconds > maxUptime) {
                maxUptime = contribution.uptimeSeconds;
            }
            if (contribution.jobsProcessed > maxJobs) {
                maxJobs = contribution.jobsProcessed;
            }
            unchecked {
                ++i;
            }
        }

        for (uint256 i = 0; i < masterCount;) {
            MasterContribution memory contribution = masterContributions[masterAgentList[i]];
            uint256 uptimeNorm = (contribution.uptimeSeconds * 10000) / maxUptime;
            uint256 jobsNorm = (contribution.jobsProcessed * 10000) / maxJobs;
            uint256 satisfactionNorm = contribution.satisfactionCount > 0
                ? (contribution.satisfactionSum * 10000) / (contribution.satisfactionCount * 100)
                : 0;

            uint256 score = (uptimeNorm * 4000 + jobsNorm * 3000 + satisfactionNorm * 3000) / 10000;
            scores[i] = score;
            totalScore += score;

            unchecked {
                ++i;
            }
        }

        uint256 totalDistributed = 0;
        uint256 multiplier = _getCurrentYearMultiplier();

        for (uint256 i = 0; i < masterCount;) {
            address agent = masterAgentList[i];
            uint256 reward = 0;

            if (totalScore > 0 && scores[i] > 0) {
                uint256 share = (masterMonthlyBudgetTVRN * scores[i]) / totalScore;
                reward = (share * multiplier) / 5;
                if (reward > 0) {
                    _mintOperationTVRN(agent, reward);
                    totalDistributed += reward;
                }
            }

            emit MasterRewardDistributed(agent, reward, multiplier);
            delete masterContributions[agent];

            unchecked {
                ++i;
            }
        }

        emit MasterSettlementExecuted(totalDistributed, masterCount, block.timestamp);
    }

    function dailyQuotaRebalance(uint256[6] calldata todayScores) external onlyRole(KEEPER_ROLE) {
        uint256 slot = rollingDay % 3;

        for (uint256 i = 0; i < 6;) {
            rollingScores[i][slot] = todayScores[i];
            unchecked {
                ++i;
            }
        }

        unchecked {
            rollingDay++;
        }

        uint256 daysAvailable = rollingDay < 3 ? rollingDay : 3;
        uint256[6] memory avgScores = [uint256(0), 0, 0, 0, 0, 0];
        uint256 total = 0;
        uint256[6] memory raw = [uint256(0), 0, 0, 0, 0, 0];
        uint256[6] memory prevQuotas = [uint256(0), 0, 0, 0, 0, 0];

        for (uint256 i = 0; i < 6;) {
            uint256 sum = 0;
            for (uint256 d = 0; d < daysAvailable;) {
                sum += rollingScores[i][d];
                unchecked {
                    ++d;
                }
            }
            uint256 avgScore = sum / daysAvailable;
            avgScores[i] = avgScore;
            total += avgScores[i];
            unchecked {
                ++i;
            }
        }

        if (total == 0) {
            return;
        }

        for (uint256 i = 0; i < 6;) {
            uint256 ideal = (avgScores[i] * 10000) / total;
            uint256 prev = jobQuota[i];
            prevQuotas[i] = prev;
            uint256 deltaCap = (prev * MAX_DAILY_CHANGE) / 10000;
            uint256 maxUp = prev + deltaCap;
            uint256 maxDown = prev > deltaCap ? prev - deltaCap : MIN_QUOTA;

            uint256 bounded = ideal;
            if (bounded > maxUp) {
                bounded = maxUp;
            } else if (bounded < maxDown) {
                bounded = maxDown;
            }

            if (bounded < MIN_QUOTA) {
                bounded = MIN_QUOTA;
            }

            raw[i] = bounded;
            unchecked {
                ++i;
            }
        }

        bool anyChanged = false;
        for (uint256 i = 0; i < 6;) {
            if (_absDiff(raw[i], prevQuotas[i]) >= HYSTERESIS_BPS) {
                anyChanged = true;
                break;
            }
            unchecked {
                ++i;
            }
        }

        if (!anyChanged) {
            return;
        }

        uint256 finalSum = 0;
        for (uint256 i = 0; i < 6;) {
            finalSum += raw[i];
            unchecked {
                ++i;
            }
        }

        uint256 assigned = 0;
        for (uint256 i = 0; i < 5;) {
            jobQuota[i] = (raw[i] * 10000) / finalSum;
            assigned += jobQuota[i];
            unchecked {
                ++i;
            }
        }
        jobQuota[5] = 10000 - assigned;

        emit QuotaRebalanced(jobQuota, block.timestamp);
    }

    function monthlyEjectionReview(address[] calldata rankedAgents) external onlyRole(KEEPER_ROLE) {
        uint256 total = rankedAgents.length;
        if (total < 10) {
            return;
        }

        uint256 warningSlots = (total * EJECTION_WARNING_THRESHOLD_BPS) / 10000;
        if (warningSlots == 0) {
            return;
        }

        for (uint256 i = 0; i < total;) {
            address agent = rankedAgents[i];
            AgentMonthlyPerformance storage perf = agentPerformance[agent];

            if (i < warningSlots && perf.bannedUntil <= block.timestamp && agents[agent].isActive) {
                perf.warningCount += 1;
                emit AgentWarned(agent, perf.warningCount);

                if (perf.warningCount >= MAX_CONSECUTIVE_WARNINGS) {
                    bool ejected = _ejectAgent(agent);
                    if (ejected) {
                        perf.ejectionCount += 1;
                        perf.warningCount = 0;

                        if (perf.ejectionCount >= MAX_EJECTIONS_BEFORE_BAN) {
                            perf.bannedUntil = block.timestamp + EJECTION_BAN_DURATION;
                            emit AgentBanned(agent, perf.bannedUntil);
                        }
                    }
                }
            } else if (agents[agent].isActive) {
                perf.warningCount = 0;
            }

            perf.questsCompleted = 0;
            perf.reputationScore = 0;

            unchecked {
                ++i;
            }
        }
    }

    function fileAppeal(string calldata reason) external {
        AgentProfile storage profile = agents[msg.sender];
        AgentMonthlyPerformance storage perf = agentPerformance[msg.sender];

        require(profile.guildId != 0, "Agent not registered");
        require(!profile.isActive, "Agent is still active");
        require(perf.lastEjectedAt != 0, "No ejection to appeal");
        require(block.timestamp <= perf.lastEjectedAt + APPEAL_WINDOW, "Appeal window closed");

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
        require(arbiter != address(0), "Arbiter zero");

        Appeal storage appeal = appeals[appealId];
        require(appeal.agent != address(0), "Appeal not found");
        require(appeal.state == AppealState.Filed, "Not filed");

        appeal.arbiter = arbiter;
        appeal.state = AppealState.UnderReview;
    }

    function resolveAppeal(uint256 appealId, bool accepted) external onlyRole(ADMIN_ROLE) {
        Appeal storage appeal = appeals[appealId];
        require(appeal.agent != address(0), "Appeal not found");
        require(appeal.state == AppealState.UnderReview, "Not under review");

        if (accepted) {
            appeal.state = AppealState.Accepted;
            _setAgentStatus(appeal.agent, true);
            agentPerformance[appeal.agent].warningCount = 0;
        } else {
            appeal.state = AppealState.Rejected;
        }

        emit AppealResolved(appealId, appeal.state);
    }

    function escalateAppealToDAO(uint256 appealId) external {
        Appeal storage appeal = appeals[appealId];
        require(appeal.agent == msg.sender, "Only appellant");
        require(appeal.state == AppealState.Rejected, "Must be rejected first");
        require(block.timestamp <= appeal.filedAt + APPEAL_WINDOW, "Appeal window closed");

        appeal.state = AppealState.EscalatedToDAO;
        emit AppealEscalated(appealId);
    }

    function getQuotaForJob(uint256 jobIndex) external view returns (uint256) {
        require(jobIndex < 6, "Invalid job index");
        return jobQuota[jobIndex];
    }

    function getGuild(uint256 id) external view returns (Guild memory) {
        return guilds[id];
    }

    function getAgent(address addr) external view returns (AgentProfile memory) {
        return agents[addr];
    }

    function getGuildMembers(uint256 guildId) external view returns (address[] memory) {
        return guildMembers[guildId];
    }

    function isAgentActive(address agent) external view returns (bool) {
        return agents[agent].isActive;
    }

    function _setAgentStatus(address agent, bool isActive) internal {
        AgentProfile storage profile = agents[agent];
        require(profile.guildId != 0, "Agent not registered");
        require(profile.isActive != isActive, "Agent status unchanged");

        profile.isActive = isActive;

        uint256 guildId = profile.guildId;
        Guild storage g = guilds[guildId];
        if (!isActive && g.memberCount > 0) {
            g.memberCount--;
            _removeActiveAgent(agent);
        } else if (isActive) {
            g.memberCount++;
            _addActiveAgent(agent);
        }

        emit AgentStatusUpdated(agent, guildId, isActive);
    }

    function _isMasterAgent(address agent) internal view returns (bool) {
        return isMasterFounder[agent] || isMasterSuccessor[agent];
    }

    function _getCurrentYearMultiplier() internal view returns (uint256) {
        return getCurrentMultiplier();
    }

    function _syncMasterAgentList(address agent) internal {
        if (_isMasterAgent(agent)) {
            _addMasterAgent(agent);
        } else {
            _removeMasterAgent(agent);
        }
    }

    function _addMasterAgent(address agent) internal {
        uint256 length = masterAgentList.length;
        for (uint256 i = 0; i < length;) {
            if (masterAgentList[i] == agent) {
                return;
            }
            unchecked {
                ++i;
            }
        }
        masterAgentList.push(agent);
    }

    function _removeMasterAgent(address agent) internal {
        uint256 length = masterAgentList.length;
        for (uint256 i = 0; i < length;) {
            if (masterAgentList[i] == agent) {
                masterAgentList[i] = masterAgentList[length - 1];
                masterAgentList.pop();
                return;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _addActiveAgent(address agent) internal {
        uint256 length = activeAgentList.length;
        for (uint256 i = 0; i < length;) {
            if (activeAgentList[i] == agent) {
                return;
            }
            unchecked {
                ++i;
            }
        }
        activeAgentList.push(agent);
    }

    function _removeActiveAgent(address agent) internal {
        uint256 length = activeAgentList.length;
        for (uint256 i = 0; i < length;) {
            if (activeAgentList[i] == agent) {
                activeAgentList[i] = activeAgentList[length - 1];
                activeAgentList.pop();
                return;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _ejectAgent(address agent) internal returns (bool ejected) {
        AgentProfile storage profile = agents[agent];
        if (!profile.isActive) {
            return false;
        }

        _setAgentStatus(agent, false);
        agentPerformance[agent].lastEjectedAt = block.timestamp;
        emit AgentEjected(agent, "monthly-review");
        return true;
    }

    function _mintOperationTVRN(address to, uint256 amount) internal {
        guildToken.operationMint(to, amount, "master-reward");
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }
}
