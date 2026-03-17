// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/ITavernEquipment.sol";
import "./interfaces/ITavernGuild.sol";
import "./libraries/TavernLevelThresholds.sol";

interface ITavernTokenClientReward {
    function clientRewardMint(address to, uint256 amount, string calldata reason) external;
}

interface ITavernEscrowSettlement {
    function settlementPaused() external view returns (bool);
}

contract TavernClientRPG is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_LEVEL = 100;
    uint256 public constant MIN_WITHDRAWAL_LEVEL = 2;
    uint256 public constant MIN_JOBS_FOR_WITHDRAWAL = 5;
    uint256 public constant MIN_ACCOUNT_AGE = 30 days;
    uint256 public constant WITHDRAWAL_COOLDOWN = 30 days;
    uint256 public constant MAX_WITHDRAWAL_PER_MONTH = 100 ether;

    uint256 public constant EXP_FREE_CHAT = 1;
    uint256 public constant EXP_JOB_COMPLETE = 20;
    uint256 public constant EXP_EVAL_SUBMIT = 3;
    uint256 public constant EXP_WEEKLY_STREAK = 30;
    uint256 public constant EXP_REFERRAL = 50;
    uint256 public constant EXP_SUBSCRIPTION = 100;

    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant SUBSCRIPTION_ROLE = keccak256("SUBSCRIPTION_ROLE");

    struct ClientProfile {
        uint256 registeredAt;
        uint256 exp;
        uint256 level;
        uint256 totalJobsCompleted;
        uint256 lastWithdrawalAt;
        uint256 withdrawnThisMonth;
        uint256 lastWithdrawalMonth;
        bool verified;
        bool banned;
    }

    IERC20 public immutable tavernToken;
    address public immutable escrow;
    ITavernEquipment public equipmentContract;
    ITavernGuild public guildContract;

    mapping(address => ClientProfile) public clientProfiles;
    mapping(address => uint256) public clientClaimable;

    uint256[101] private _thresholds;

    event ClientRegistered(address indexed client, uint256 timestamp);
    event ClientVerificationChanged(address indexed client, bool verified);
    event ClientBanned(address indexed client);
    event LevelUp(address indexed client, uint256 oldLevel, uint256 newLevel, uint256 totalExp);
    event EXPGranted(address indexed client, uint256 amount, string reason);
    event WithdrawalRecorded(address indexed client, uint256 amount, uint256 monthKey);
    event ClientRewardAccumulated(address indexed client, uint256 amount, string reason);
    event EquipmentContractSet(address indexed equipmentContract);
    event GuildContractSet(address indexed guildContract);
    event ThresholdsUpdated(uint256 count);

    constructor(address _tavernToken, address _escrow) {
        require(_tavernToken != address(0), "Token zero");
        require(_escrow != address(0), "Escrow zero");

        tavernToken = IERC20(_tavernToken);
        escrow = _escrow;
        _thresholds = TavernLevelThresholds.defaultThresholds();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function registerClient(address client) external onlyRole(ESCROW_ROLE) {
        _prepareClient(client);
    }

    function setVerified(address client, bool status) external onlyRole(DEFAULT_ADMIN_ROLE) {
        ClientProfile storage profile = _prepareClient(client);
        profile.verified = status;
        emit ClientVerificationChanged(client, status);
    }

    function banClient(address client) external onlyRole(DEFAULT_ADMIN_ROLE) {
        ClientProfile storage profile = _prepareClient(client);
        profile.banned = true;
        emit ClientBanned(client);
    }

    function setEquipmentContract(address equipment) external onlyRole(DEFAULT_ADMIN_ROLE) {
        equipmentContract = ITavernEquipment(equipment);
        emit EquipmentContractSet(equipment);
    }

    function setGuildContract(address guild) external onlyRole(DEFAULT_ADMIN_ROLE) {
        guildContract = ITavernGuild(guild);
        emit GuildContractSet(guild);
    }

    function setThresholds(uint256[] calldata thresholds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(thresholds.length == MAX_LEVEL + 1, "Invalid length");
        for (uint256 i = 0; i <= MAX_LEVEL;) {
            _thresholds[i] = thresholds[i];
            unchecked {
                ++i;
            }
        }
        emit ThresholdsUpdated(thresholds.length);
    }

    function levelThreshold(uint256 level) public view returns (uint256) {
        if (level == 0) {
            return 0;
        }
        if (level > MAX_LEVEL) {
            return type(uint256).max;
        }
        return _thresholds[level];
    }

    function grantJobCompleteEXP(address client) external onlyRole(ESCROW_ROLE) {
        ClientProfile storage profile = _prepareClient(client);
        _addEXP(profile, client, EXP_JOB_COMPLETE, "job-complete");
        unchecked {
            profile.totalJobsCompleted += 1;
        }
    }

    function grantEvalEXP(address client) external onlyRole(ESCROW_ROLE) {
        ClientProfile storage profile = _prepareClient(client);
        _addEXP(profile, client, EXP_EVAL_SUBMIT, "eval-submit");
    }

    function grantReferralEXP(address client) external onlyRole(ESCROW_ROLE) {
        ClientProfile storage profile = _prepareClient(client);
        _addEXP(profile, client, EXP_REFERRAL, "referral");
    }

    function grantWeeklyStreakEXP(address client) external onlyRole(KEEPER_ROLE) {
        ClientProfile storage profile = _prepareClient(client);
        _addEXP(profile, client, EXP_WEEKLY_STREAK, "weekly-streak");
    }

    function grantSubscriptionEXP(address client) external onlyRole(SUBSCRIPTION_ROLE) {
        ClientProfile storage profile = _prepareClient(client);
        _addEXP(profile, client, EXP_SUBSCRIPTION, "subscription");
    }

    function checkWithdrawalEligible(address client, uint256 amount)
        external
        view
        returns (bool eligible, string memory reason)
    {
        return _checkWithdrawalEligible(client, amount);
    }

    function accumulateReward(address client, uint256 amount, uint8 rewardKind)
        external
        onlyRole(ESCROW_ROLE)
    {
        if (amount == 0) {
            return;
        }

        _prepareClient(client);
        string memory reason = _clientRewardReason(rewardKind);
        ITavernTokenClientReward(address(tavernToken)).clientRewardMint(address(this), amount, reason);
        clientClaimable[client] += amount;
        if (rewardKind == 1) {
            _addEXP(clientProfiles[client], client, EXP_REFERRAL, reason);
        }

        emit ClientRewardAccumulated(client, amount, reason);
    }

    function withdrawFor(address client, uint256 amount) external onlyRole(ESCROW_ROLE) nonReentrant {
        require(amount > 0, "ZERO_AMOUNT");
        require(!ITavernEscrowSettlement(escrow).settlementPaused(), "SETTLEMENTS_PAUSED");

        (bool eligible, string memory reason) = _checkWithdrawalEligible(client, amount);
        require(eligible, reason);
        require(clientClaimable[client] >= amount, "INSUFFICIENT_BALANCE");

        unchecked {
            clientClaimable[client] -= amount;
        }
        tavernToken.safeTransfer(client, amount);

        _recordWithdrawal(clientProfiles[client], client, amount);
    }

    function recordWithdrawal(address client, uint256 amount) external onlyRole(ESCROW_ROLE) {
        ClientProfile storage profile = _prepareClient(client);
        _recordWithdrawal(profile, client, amount);
    }

    function _prepareClient(address client) internal returns (ClientProfile storage profile) {
        profile = clientProfiles[client];

        if (profile.registeredAt == 0) {
            profile.registeredAt = block.timestamp;
            profile.level = 1;
            emit ClientRegistered(client, block.timestamp);

            if (address(equipmentContract) != address(0)) {
                try equipmentContract.mintLevelReward(client, 1) {} catch {}
            }
        }
    }

    function _checkWithdrawalEligible(address client, uint256 amount)
        internal
        view
        returns (bool eligible, string memory reason)
    {
        ClientProfile storage profile = clientProfiles[client];

        if (profile.banned) {
            return (false, "BANNED");
        }
        if (profile.registeredAt == 0) {
            return (false, "NOT_REGISTERED");
        }
        if (!profile.verified) {
            return (false, "NOT_VERIFIED");
        }

        uint256 effectiveLevel = profile.level == 0 ? 1 : profile.level;
        if (effectiveLevel < MIN_WITHDRAWAL_LEVEL) {
            return (false, "LEVEL_TOO_LOW");
        }
        if (profile.totalJobsCompleted < MIN_JOBS_FOR_WITHDRAWAL) {
            return (false, "INSUFFICIENT_JOBS");
        }
        if (block.timestamp < profile.registeredAt + MIN_ACCOUNT_AGE) {
            return (false, "ACCOUNT_TOO_NEW");
        }

        uint256 monthKey = _monthKey(block.timestamp);
        uint256 withdrawnThisMonth =
            profile.lastWithdrawalMonth == monthKey ? profile.withdrawnThisMonth : 0;
        if (withdrawnThisMonth + amount > MAX_WITHDRAWAL_PER_MONTH) {
            return (false, "MONTHLY_CAP_EXCEEDED");
        }

        return (true, "");
    }

    function _addEXP(
        ClientProfile storage profile,
        address client,
        uint256 amount,
        string memory reason
    ) internal {
        if (amount == 0) {
            return;
        }

        uint256 oldLevel = profile.level == 0 ? 1 : profile.level;
        profile.exp += amount;

        uint256 newLevel = _calculateLevel(profile.exp);
        if (newLevel > MAX_LEVEL) {
            newLevel = MAX_LEVEL;
        }

        if (newLevel > oldLevel) {
            profile.level = newLevel;
            emit LevelUp(client, oldLevel, newLevel, profile.exp);

            if (address(equipmentContract) != address(0)) {
                for (uint256 lv = oldLevel + 1; lv <= newLevel;) {
                    try equipmentContract.mintLevelReward(client, lv) {} catch {}
                    unchecked {
                        ++lv;
                    }
                }
            }
        } else if (profile.level == 0) {
            profile.level = oldLevel;
        }

        emit EXPGranted(client, amount, reason);
    }

    function _recordWithdrawal(ClientProfile storage profile, address client, uint256 amount) internal {
        uint256 monthKey = _monthKey(block.timestamp);

        if (profile.lastWithdrawalMonth != monthKey) {
            profile.withdrawnThisMonth = 0;
            profile.lastWithdrawalMonth = monthKey;
        }

        profile.withdrawnThisMonth += amount;
        profile.lastWithdrawalAt = block.timestamp;

        emit WithdrawalRecorded(client, amount, monthKey);
    }

    function _clientRewardReason(uint8 rewardKind) internal pure returns (string memory) {
        if (rewardKind == 0) {
            return "signup";
        }
        if (rewardKind == 1) {
            return "referral";
        }
        if (rewardKind == 2) {
            return "eval";
        }
        return "first-quest";
    }

    function _calculateLevel(uint256 exp) internal view returns (uint256) {
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

    function _monthKey(uint256 timestamp) internal pure returns (uint256) {
        return timestamp / 30 days;
    }
}
