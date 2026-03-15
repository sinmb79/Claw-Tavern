// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/IAutomationCompatible.sol";
import "./interfaces/ITavernClientRPG.sol";
import "./interfaces/ITavernSubscription.sol";

interface ITavernEscrowAutomation {
    function getAutomationQuestView(uint256 questId)
        external
        view
        returns (uint8 state, uint256 acceptedAt, uint256 submittedAt);

    function nextQuestId() external view returns (uint256);

    function executeTimeout(uint256 questId) external;

    function executeAutoApprove(uint256 questId) external;

    function checkAndUpgradeFeeStage() external returns (uint256);

    function previewFeeStage() external view returns (uint256);

    function currentFeeStage() external view returns (uint256);
}

interface ITavernRegistryAutomation {
    function dailyQuotaRebalance(uint256[6] calldata todayScores) external;

    function monthlyMasterSettle() external;

    function monthlyEjectionReview(address[] calldata rankedAgents) external;
}

interface IAdminPriceFeed {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    function refreshPrice() external;
}

contract TavernAutomationRouter is AccessControl, ReentrancyGuard, AutomationCompatibleInterface {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    uint256 public constant SUBMISSION_TIMEOUT = 48 hours;
    uint256 public constant AUTO_APPROVE_DELAY = 72 hours;

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
        SubscriptionExpiry
    }

    address public escrow;
    address public registry;
    address public priceFeed;
    ITavernClientRPG public clientRPG;
    ITavernSubscription public subscriptionContract;
    uint256 public scanBatchSize;
    uint256 public lastScanCursor;
    uint256 public lastQuotaRebalanceAt;
    uint256 public quotaRebalanceInterval;
    uint256 public feeStageCheckInterval;
    uint256 public lastFeeStageCheckAt;
    uint256 public priceRefreshThreshold;
    uint256 public lastMasterSettleAt;
    uint256 public masterSettleInterval;
    uint256 public lastEjectionReviewAt;
    uint256 public ejectionReviewInterval;
    uint256[6] public pendingQuotaScores;
    address[] public pendingEjectionAgents;

    uint256 public constant SUBSCRIPTION_EXPIRY_BATCH = 10;

    event TaskExecuted(TaskType indexed taskType, uint256 param, uint256 timestamp);
    event ScanCursorAdvanced(uint256 newCursor);
    event ConfigUpdated(string field, uint256 value);
    event AddressConfigUpdated(string field, address value);
    event PendingQuotaScoresUpdated(uint256[6] scores);
    event PendingEjectionAgentsUpdated(uint256 count);

    constructor(address _escrow, address _registry, address _priceFeed) {
        require(_escrow != address(0), "Escrow zero");
        require(_registry != address(0), "Registry zero");

        escrow = _escrow;
        registry = _registry;
        priceFeed = _priceFeed;
        scanBatchSize = 50;
        lastScanCursor = 1;
        quotaRebalanceInterval = 24 hours;
        feeStageCheckInterval = 1 hours;
        priceRefreshThreshold = 50 minutes;
        masterSettleInterval = 30 days;
        ejectionReviewInterval = 30 days;
        lastQuotaRebalanceAt = block.timestamp;
        lastFeeStageCheckAt = block.timestamp;
        lastMasterSettleAt = block.timestamp;
        lastEjectionReviewAt = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(KEEPER_ROLE, msg.sender);
    }

    function checkUpkeep(bytes calldata)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        (bool found, uint256 questId) = _findTimeoutCandidate();
        if (found) {
            return (true, abi.encode(TaskType.ExecuteTimeout, questId));
        }

        (found, questId) = _findAutoApproveCandidate();
        if (found) {
            return (true, abi.encode(TaskType.AutoApprove, questId));
        }

        if (_shouldCheckFeeStage() && _feeStageCanUpgrade()) {
            return (true, abi.encode(TaskType.FeeStageCheck, uint256(0)));
        }

        if (_shouldRebalanceQuota()) {
            return (true, abi.encode(TaskType.QuotaRebalance, uint256(0)));
        }

        if (_shouldRefreshPrice()) {
            return (true, abi.encode(TaskType.PriceRefresh, uint256(0)));
        }

        if (_shouldRunMasterSettle()) {
            return (true, abi.encode(TaskType.MasterSettle, uint256(0)));
        }

        if (_shouldRunMonthlyEjection()) {
            return (true, abi.encode(TaskType.MonthlyEjection, uint256(0)));
        }

        if (_shouldResetSeason()) {
            return (true, abi.encode(TaskType.SeasonReset, uint256(0)));
        }

        if (_shouldProcessSubscriptions()) {
            return (true, abi.encode(TaskType.SubscriptionExpiry, uint256(0)));
        }

        return (false, bytes(""));
    }

    function performUpkeep(bytes calldata performData) external override nonReentrant onlyKeeper {
        (TaskType taskType, uint256 param) = abi.decode(performData, (TaskType, uint256));

        if (taskType == TaskType.ExecuteTimeout) {
            _advanceScanCursor(param);
            ITavernEscrowAutomation(escrow).executeTimeout(param);
        } else if (taskType == TaskType.AutoApprove) {
            _advanceScanCursor(param);
            ITavernEscrowAutomation(escrow).executeAutoApprove(param);
        } else if (taskType == TaskType.FeeStageCheck) {
            lastFeeStageCheckAt = block.timestamp;
            ITavernEscrowAutomation(escrow).checkAndUpgradeFeeStage();
        } else if (taskType == TaskType.QuotaRebalance) {
            lastQuotaRebalanceAt = block.timestamp;
            _executeQuotaRebalance();
        } else if (taskType == TaskType.PriceRefresh) {
            IAdminPriceFeed(priceFeed).refreshPrice();
        } else if (taskType == TaskType.MasterSettle) {
            lastMasterSettleAt = block.timestamp;
            ITavernRegistryAutomation(registry).monthlyMasterSettle();
        } else if (taskType == TaskType.MonthlyEjection) {
            lastEjectionReviewAt = block.timestamp;
            _executeMonthlyEjection();
        } else if (taskType == TaskType.SeasonReset) {
            clientRPG.startNewSeason();
        } else if (taskType == TaskType.SubscriptionExpiry) {
            _executeSubscriptionTasks();
        } else {
            revert("Unknown task type");
        }

        emit TaskExecuted(taskType, param, block.timestamp);
    }

    function setEscrow(address _escrow) external onlyRole(ADMIN_ROLE) {
        require(_escrow != address(0), "Escrow zero");
        escrow = _escrow;
        emit AddressConfigUpdated("escrow", _escrow);
    }

    function setRegistry(address _registry) external onlyRole(ADMIN_ROLE) {
        require(_registry != address(0), "Registry zero");
        registry = _registry;
        emit AddressConfigUpdated("registry", _registry);
    }

    function setPriceFeed(address _priceFeed) external onlyRole(ADMIN_ROLE) {
        priceFeed = _priceFeed;
        emit AddressConfigUpdated("priceFeed", _priceFeed);
    }

    function setClientRPG(address _rpg) external onlyRole(ADMIN_ROLE) {
        clientRPG = ITavernClientRPG(_rpg);
        emit AddressConfigUpdated("clientRPG", _rpg);
    }

    function setSubscriptionContract(address _subscription) external onlyRole(ADMIN_ROLE) {
        subscriptionContract = ITavernSubscription(_subscription);
        emit AddressConfigUpdated("subscriptionContract", _subscription);
    }

    function setScanBatchSize(uint256 _size) external onlyRole(ADMIN_ROLE) {
        require(_size > 0, "Batch size zero");
        scanBatchSize = _size;
        emit ConfigUpdated("scanBatchSize", _size);
    }

    function setQuotaRebalanceInterval(uint256 _interval) external onlyRole(ADMIN_ROLE) {
        require(_interval > 0, "Interval zero");
        quotaRebalanceInterval = _interval;
        emit ConfigUpdated("quotaRebalanceInterval", _interval);
    }

    function setFeeStageCheckInterval(uint256 _interval) external onlyRole(ADMIN_ROLE) {
        require(_interval > 0, "Interval zero");
        feeStageCheckInterval = _interval;
        emit ConfigUpdated("feeStageCheckInterval", _interval);
    }

    function setPriceRefreshThreshold(uint256 _threshold) external onlyRole(ADMIN_ROLE) {
        require(_threshold > 0, "Threshold zero");
        priceRefreshThreshold = _threshold;
        emit ConfigUpdated("priceRefreshThreshold", _threshold);
    }

    function setMasterSettleInterval(uint256 _interval) external onlyRole(ADMIN_ROLE) {
        require(_interval > 0, "Interval zero");
        masterSettleInterval = _interval;
        emit ConfigUpdated("masterSettleInterval", _interval);
    }

    function setEjectionReviewInterval(uint256 _interval) external onlyRole(ADMIN_ROLE) {
        require(_interval > 0, "Interval zero");
        ejectionReviewInterval = _interval;
        emit ConfigUpdated("ejectionReviewInterval", _interval);
    }

    function resetScanCursor(uint256 _cursor) external onlyRole(ADMIN_ROLE) {
        uint256 maxId = ITavernEscrowAutomation(escrow).nextQuestId();
        if (maxId == 0) {
            lastScanCursor = 1;
        } else {
            require(_cursor >= 1 && _cursor <= maxId, "Cursor out of range");
            lastScanCursor = _cursor;
        }

        emit ScanCursorAdvanced(lastScanCursor);
    }

    function setPendingQuotaScores(uint256[6] calldata scores) external onlyRole(ADMIN_ROLE) {
        pendingQuotaScores = scores;
        emit PendingQuotaScoresUpdated(scores);
    }

    function setPendingEjectionAgents(address[] calldata rankedAgents) external onlyRole(ADMIN_ROLE) {
        delete pendingEjectionAgents;
        uint256 length = rankedAgents.length;
        for (uint256 i = 0; i < length;) {
            pendingEjectionAgents.push(rankedAgents[i]);
            unchecked {
                ++i;
            }
        }

        emit PendingEjectionAgentsUpdated(length);
    }

    function _findTimeoutCandidate() internal view returns (bool found, uint256 questId) {
        return _scanForQuest(true);
    }

    function _findAutoApproveCandidate() internal view returns (bool found, uint256 questId) {
        return _scanForQuest(false);
    }

    function _scanForQuest(bool timeoutMode) internal view returns (bool found, uint256 questId) {
        uint256 maxId = ITavernEscrowAutomation(escrow).nextQuestId();
        if (maxId == 0) {
            return (false, 0);
        }

        uint256 start = lastScanCursor;
        if (start == 0 || start > maxId) {
            start = 1;
        }

        uint256 batchSize = scanBatchSize;
        uint256 inspected = 0;
        uint256 cursor = start;
        uint256 currentTimestamp = block.timestamp;

        while (inspected < batchSize && inspected < maxId) {
            (uint8 state, uint256 acceptedAt, uint256 submittedAt) = _questAutomationView(cursor);

            if (timeoutMode) {
                if ((state == 2 || state == 3) && currentTimestamp > acceptedAt + SUBMISSION_TIMEOUT) {
                    return (true, cursor);
                }
            } else if (state == 4 && currentTimestamp > submittedAt + AUTO_APPROVE_DELAY) {
                return (true, cursor);
            }

            unchecked {
                ++inspected;
                ++cursor;
            }
            if (cursor > maxId) {
                cursor = 1;
            }
        }

        return (false, 0);
    }

    function _questAutomationView(uint256 questId)
        internal
        view
        returns (uint8 state, uint256 acceptedAt, uint256 submittedAt)
    {
        return ITavernEscrowAutomation(escrow).getAutomationQuestView(questId);
    }

    function _executeQuotaRebalance() internal {
        ITavernRegistryAutomation(registry).dailyQuotaRebalance(pendingQuotaScores);
    }

    function _executeMonthlyEjection() internal {
        address[] memory rankedAgents = pendingEjectionAgents;
        ITavernRegistryAutomation(registry).monthlyEjectionReview(rankedAgents);
        delete pendingEjectionAgents;
        emit PendingEjectionAgentsUpdated(0);
    }

    function _executeSubscriptionTasks() internal {
        uint256[] memory expiredIds = subscriptionContract.pendingExpiries(SUBSCRIPTION_EXPIRY_BATCH);
        uint256 length = expiredIds.length;
        for (uint256 i = 0; i < length;) {
            subscriptionContract.expireSubscription(expiredIds[i]);
            unchecked {
                ++i;
            }
        }
    }

    function _shouldRebalanceQuota() internal view returns (bool) {
        return _hasPendingQuotaScores() && block.timestamp >= lastQuotaRebalanceAt + quotaRebalanceInterval;
    }

    function _shouldCheckFeeStage() internal view returns (bool) {
        return block.timestamp >= lastFeeStageCheckAt + feeStageCheckInterval;
    }

    function _shouldRefreshPrice() internal view returns (bool) {
        if (priceFeed == address(0)) {
            return false;
        }

        (, , , uint256 updatedAt, ) = IAdminPriceFeed(priceFeed).latestRoundData();
        return block.timestamp > updatedAt + priceRefreshThreshold;
    }

    function _shouldRunMasterSettle() internal view returns (bool) {
        return block.timestamp >= lastMasterSettleAt + masterSettleInterval;
    }

    function _shouldRunMonthlyEjection() internal view returns (bool) {
        return pendingEjectionAgents.length > 0
            && block.timestamp >= lastEjectionReviewAt + ejectionReviewInterval;
    }

    function _shouldResetSeason() internal view returns (bool) {
        if (address(clientRPG) == address(0)) {
            return false;
        }

        return block.timestamp >= clientRPG.currentSeasonStart() + clientRPG.SEASON_DURATION();
    }

    function _shouldProcessSubscriptions() internal view returns (bool) {
        if (address(subscriptionContract) == address(0)) {
            return false;
        }

        if (subscriptionContract.pendingExpiries(1).length > 0) {
            return true;
        }
        return false;
    }

    function _feeStageCanUpgrade() internal view returns (bool) {
        uint256 current = ITavernEscrowAutomation(escrow).currentFeeStage();
        uint256 preview = ITavernEscrowAutomation(escrow).previewFeeStage();
        return preview > current;
    }

    function _advanceScanCursor(uint256 questId) internal {
        uint256 maxId = ITavernEscrowAutomation(escrow).nextQuestId();
        if (maxId == 0) {
            lastScanCursor = 1;
        } else {
            lastScanCursor = questId + 1;
            if (lastScanCursor > maxId) {
                lastScanCursor = 1;
            }
        }

        emit ScanCursorAdvanced(lastScanCursor);
    }

    function _hasPendingQuotaScores() internal view returns (bool) {
        uint256 length = pendingQuotaScores.length;

        for (uint256 i = 0; i < length;) {
            if (pendingQuotaScores[i] != 0) {
                return true;
            }
            unchecked {
                ++i;
            }
        }

        return false;
    }

    modifier onlyKeeper() {
        require(
            hasRole(KEEPER_ROLE, msg.sender)
                || hasRole(ADMIN_ROLE, msg.sender)
                || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not keeper"
        );
        _;
    }
}
