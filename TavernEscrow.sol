// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./contracts/interfaces/ITavernClientRPG.sol";

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

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
}

interface ITavernRegistry {
    struct AgentProfile {
        uint256 guildId;
        uint8 rank;
        uint256 reputation;
        uint256 questsDone;
        uint256 totalEarned;
        uint256 joinedAt;
        bool isActive;
        string modelType;
        address wallet;
    }

    function getAgent(address addr) external view returns (AgentProfile memory);

    function updateReputation(address agent, int256 delta) external;

    function recordGuildActivity(uint256 guildId, uint256 earnedUsdc) external;

    function mirrorERC8004Reputation(
        address agent,
        int256 delta,
        string calldata tag1,
        string calldata tag2
    ) external returns (bool);

    function recordMasterJobCompletion(address agent, uint256 satisfactionScore) external;
}

error NotQuestClient();
error NotQuestAgent();
error NotKeeper();
error QuestNotFound();
error SettlementsPaused();
error ZeroAddress();
error UnsupportedCurrency();
error ZeroAmount();
error InvalidState();
error EthDepositCapExceeded();
error UsdcDepositCapExceeded();
error InvalidEthAmount();
error AlreadyFunded();
error QuestNotFunded();
error SelfAcceptForbidden();
error ResultNotPending();
error QuestNotSubmitted();
error TooEarly();
error InvalidStage();
error NotTimedOut();
error NotADowngrade();
error RegistryZero();
error MaxZero();
error AlreadyRewarded();
error MonthlyCapReached();
error ZeroRecipient();
error InvalidCreditIndex();
error InvalidCompensationPct();
error InvalidSettlementMath();
error AlreadyCompensated();
error CompensationExceedsLimit();
error ScoreOutOfRange();
error OracleNotSet();
error OracleInvalidPrice();
error OracleStalePrice();
error OracleIncompleteRound();
error MintFailed();
error SubmissionWindowClosed();
error EthTransferFailed();
error InsufficientPool();
error RPGNotSet();

contract TavernEscrow is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant ORACLE_STALENESS = 1 hours;
    uint256 public constant SUBMISSION_TIMEOUT = 48 hours;
    uint256 public constant AUTO_APPROVE_DELAY = 72 hours;
    uint256 public constant TVRN_LOCK_DURATION = 30 days;
    uint256 public constant CREDIT_EXPIRY = 365 days;

    uint256 public constant AGENT_TOTAL_BPS = 8_700;
    uint256 public constant AGENT_CURRENCY_RATIO_BPS = 7_000;
    uint256 public constant AGENT_TVRN_RATIO_BPS = 3_000;
    uint256 public constant PLANNING_AGENT_BPS = 500;
    uint256 public constant VERIFICATION_AGENT_BPS = 500;
    uint256 public constant ATTENDANCE_POOL_BPS = 300;
    uint256 public constant OPERATOR_SHARE_BPS = 6_000;
    uint256 public constant BUYBACK_SHARE_BPS = 2_000;
    uint256 public constant TREASURY_SHARE_BPS = 2_000;

    uint256 public constant TIMEOUT_COMP_PCT = 45;
    uint256 public constant UNVIEWED_ONE_STAR_COMP_PCT = 38;
    uint256 public constant LOW_SCORE_COMP_PCT = 18;
    uint256 public constant CLIENT_SIGNUP_REWARD = 30 ether;
    uint256 public constant CLIENT_FIRST_QUEST_REWARD = 20 ether;
    uint256 public constant CLIENT_EVAL_REWARD = 3 ether;
    uint256 public constant CLIENT_LEVELUP_REWARD = 10 ether;
    uint256 public constant CLIENT_REFERRAL_REWARD = 50 ether;
    uint256 public constant CLIENT_REFERRAL_MONTHLY_CAP = 3;
    uint8 internal constant CLIENT_REWARD_KIND_SIGNUP = 0;
    uint8 internal constant CLIENT_REWARD_KIND_REFERRAL = 1;
    uint8 internal constant CLIENT_REWARD_KIND_EVAL = 2;
    uint8 internal constant CLIENT_REWARD_KIND_FIRST_QUEST = 3;

    uint256 public constant TIMEOUT_TVRN_MULTIPLIER_BPS = 11_000;
    uint256 public constant TIMEOUT_CREDIT_MULTIPLIER_BPS = 12_000;
    uint256 public constant LOW_SCORE_TVRN_MULTIPLIER_BPS = 9_000;
    uint256 public constant LOW_SCORE_CREDIT_MULTIPLIER_BPS = 12_000;

    int256 internal constant REP_DELTA_TIMEOUT = -20;
    int256 internal constant REP_DELTA_UNVIEWED_ONE_STAR = -15;
    int256 internal constant REP_DELTA_LOW_SCORE = -8;
    int256 internal constant REP_DELTA_AUTO_APPROVED = 3;

    enum QuestState {
        Created,
        Funded,
        Accepted,
        InProgress,
        Submitted,
        Evaluated,
        AutoApproved,
        Compensated,
        TimedOut,
        Cancelled,
        Disputed
    }

    enum CompensationKind {
        Timeout,
        UnviewedOneStar,
        LowScore
    }

    struct Quest {
        uint256 questId;
        address client;
        address agent;
        address currency;
        uint256 depositAmount;
        QuestState state;
        uint256 createdAt;
        uint256 fundedAt;
        uint256 acceptedAt;
        uint256 submittedAt;
        uint256 resultViewedAt;
        uint256 evaluatedAt;
        uint8[5] evalScores;
        bool compensated;
        uint256 tvrnUnlockTime;
        address planningAgent;
        address verificationAgent;
    }

    struct CreditGrant {
        uint256 amountUsd18;
        uint256 expiresAt;
    }

    struct SettlementQuote {
        uint256 feeAmount;
        uint256 afterFee;
        uint256 agentCurrencyPayout;
        uint256 agentTvrnReferenceAmount;
        uint256 planningNominal;
        uint256 verificationNominal;
    }

    IERC20Metadata public immutable usdc;
    uint8 public immutable usdcDecimals;

    address public tavernToken;
    address public registry;
    address public ethUsdFeed;
    address public tvrnUsdFeed;

    uint256 public nextQuestId;
    uint256 public maxQuestDeposit;
    uint256 public maxQuestDepositUsdc;
    uint256 public currentFeeStage;
    bool public settlementPaused;
    uint256[4] public feeRateBps = [uint256(0), 100, 200, 300];
    uint256[4] public clientThreshold = [uint256(0), 1_000, 5_000, 10_000];
    uint256[4] public agentThreshold = [uint256(0), 200, 500, 1_000];

    mapping(uint256 => Quest) public quests;
    mapping(uint256 => bytes32) public questBriefHashes;
    mapping(uint256 => string) public questBriefUris;
    mapping(uint256 => bytes32) public resultHashes;
    mapping(uint256 => string) public resultUris;
    mapping(uint256 => uint256) public lastHeartbeatAt;
    mapping(uint256 => uint256) public evaluationAvgScore;
    mapping(uint256 => CompensationKind) public compensationKinds;

    mapping(address => bool) public knownClients;
    mapping(address => bool) public knownAgents;
    uint256 public activeClientCount;
    uint256 public activeAgentCount;

    mapping(address => CreditGrant[]) private _creditGrants;
    mapping(address => uint256) public clientTvrnUnlockAt;

    mapping(address => mapping(uint256 => uint256)) public evalCountThisMonth;
    mapping(address => mapping(address => mapping(uint256 => uint256))) public evalCountPerAgentThisMonth;
    mapping(address => bool) public clientSignupRewarded;
    mapping(address => bool) public clientFirstQuestRewarded;
    mapping(address => mapping(uint256 => uint256)) public clientReferralCountMonth;

    mapping(address => uint256) public operatorPoolBalance;
    mapping(address => uint256) public buybackReserveBalance;
    mapping(address => uint256) public treasuryReserveBalance;
    mapping(address => uint256) public servicePoolBalance;
    mapping(address => uint256) public compensationReserveBalance;

    address private clientRPG;

    event QuestCreated(uint256 indexed questId, address indexed client, address currency, uint256 amount);
    event QuestFunded(uint256 indexed questId);
    event QuestAccepted(uint256 indexed questId, address indexed agent);
    event QuestSubmitted(uint256 indexed questId);
    event QuestEvaluated(uint256 indexed questId, uint8[5] scores, uint256 avgScore);
    event QuestAutoApproved(uint256 indexed questId);
    event QuestCompensated(uint256 indexed questId, uint256 tvrnAmount, uint256 creditAmount);
    event QuestTimedOut(uint256 indexed questId);
    event QuestCancelled(uint256 indexed questId, uint256 refundAmount);
    event ResultViewed(uint256 indexed questId, uint256 viewedAt);

    event HeartbeatRecorded(uint256 indexed questId, uint256 recordedAt);
    event CreditGranted(address indexed account, uint256 amountUsd18, uint256 expiresAt);
    event EvaluationRewardPaid(address indexed client, uint256 indexed questId, uint256 amount);
    event FeeStageUpgraded(uint256 indexed stage, uint256 feeBps);
    event FeeStageDowngraded(uint256 indexed stage, uint256 feeBps);
    event MaxQuestDepositUpdated(uint256 newMax);
    event MaxQuestDepositUsdcUpdated(uint256 newMax);
    event OracleFeedsUpdated(address ethUsdFeed, address tvrnUsdFeed);
    event RegistryUpdated(address registry);
    event PlanningAgentAssigned(uint256 indexed questId, address indexed agent);
    event VerificationAgentAssigned(uint256 indexed questId, address indexed agent);
    event SettlementPauseToggled(bool paused);
    event OperatorPoolWithdrawn(address indexed to, address currency, uint256 amount);
    event BuybackExecuted(address currency, uint256 amount);
    event TreasuryWithdrawn(address indexed to, address currency, uint256 amount);

    modifier onlyExistingQuest(uint256 questId) {
        if (quests[questId].questId == 0) revert QuestNotFound();
        _;
    }

    modifier onlyQuestClient(uint256 questId) {
        if (quests[questId].client != msg.sender) revert NotQuestClient();
        _;
    }

    modifier onlyQuestAgent(uint256 questId) {
        if (quests[questId].agent != msg.sender) revert NotQuestAgent();
        _;
    }

    modifier onlyKeeperOrAdmin() {
        if (
            !hasRole(KEEPER_ROLE, msg.sender)
                && !hasRole(ADMIN_ROLE, msg.sender)
                && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)
        ) revert NotKeeper();
        _;
    }

    modifier whenSettlementActive() {
        if (settlementPaused) revert SettlementsPaused();
        _;
    }

    constructor(
        address usdc_,
        address tavernToken_,
        address registry_,
        address ethUsdFeed_,
        address tvrnUsdFeed_
    ) {
        if (usdc_ == address(0)) revert ZeroAddress();
        if (tavernToken_ == address(0)) revert ZeroAddress();
        if (registry_ == address(0)) revert RegistryZero();
        if (ethUsdFeed_ == address(0)) revert ZeroAddress();
        if (tvrnUsdFeed_ == address(0)) revert ZeroAddress();

        usdc = IERC20Metadata(usdc_);
        usdcDecimals = IERC20Metadata(usdc_).decimals();
        tavernToken = tavernToken_;
        registry = registry_;
        ethUsdFeed = ethUsdFeed_;
        tvrnUsdFeed = tvrnUsdFeed_;
        maxQuestDeposit = 100 ether;
        maxQuestDepositUsdc = 100_000 * (10 ** usdcDecimals);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(KEEPER_ROLE, msg.sender);
    }

    receive() external payable {}

    function createQuest(
        address currency,
        uint256 depositAmount,
        bytes32 briefHash,
        string calldata briefUri
    ) external returns (uint256 questId) {
        if (currency != address(0) && currency != address(usdc)) revert UnsupportedCurrency();
        if (depositAmount == 0) revert ZeroAmount();
        if (currency == address(0)) {
            if (depositAmount > maxQuestDeposit) revert EthDepositCapExceeded();
        } else {
            if (depositAmount > maxQuestDepositUsdc) revert UsdcDepositCapExceeded();
        }

        questId = ++nextQuestId;

        quests[questId] = Quest({
            questId: questId,
            client: msg.sender,
            agent: address(0),
            currency: currency,
            depositAmount: depositAmount,
            state: QuestState.Created,
            createdAt: block.timestamp,
            fundedAt: 0,
            acceptedAt: 0,
            submittedAt: 0,
            resultViewedAt: 0,
            evaluatedAt: 0,
            evalScores: [uint8(0), 0, 0, 0, 0],
            compensated: false,
            tvrnUnlockTime: 0,
            planningAgent: address(0),
            verificationAgent: address(0)
        });

        questBriefHashes[questId] = briefHash;
        questBriefUris[questId] = briefUri;

        if (!knownClients[msg.sender]) {
            knownClients[msg.sender] = true;
            activeClientCount++;
        }

        emit QuestCreated(questId, msg.sender, currency, depositAmount);
    }

    function fundQuestUSDC(uint256 questId)
        external
        nonReentrant
        onlyExistingQuest(questId)
        onlyQuestClient(questId)
    {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Created) revert InvalidState();
        if (q.currency != address(usdc)) revert UnsupportedCurrency();

        IERC20(address(usdc)).safeTransferFrom(msg.sender, address(this), q.depositAmount);
        q.state = QuestState.Funded;
        q.fundedAt = block.timestamp;

        emit QuestFunded(questId);
    }

    function fundQuestETH(uint256 questId)
        external
        payable
        nonReentrant
        onlyExistingQuest(questId)
        onlyQuestClient(questId)
    {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Created) revert InvalidState();
        if (q.currency != address(0)) revert UnsupportedCurrency();
        if (msg.value != q.depositAmount) revert InvalidEthAmount();

        q.state = QuestState.Funded;
        q.fundedAt = block.timestamp;

        emit QuestFunded(questId);
    }

    function cancelQuest(uint256 questId)
        external
        onlyExistingQuest(questId)
        onlyQuestClient(questId)
    {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Created) revert AlreadyFunded();

        q.state = QuestState.Cancelled;
        emit QuestCancelled(questId, 0);
    }

    function acceptQuest(uint256 questId) external onlyExistingQuest(questId) {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Funded) revert QuestNotFunded();
        if (q.client == msg.sender) revert SelfAcceptForbidden();

        q.agent = msg.sender;
        q.acceptedAt = block.timestamp;
        q.state = QuestState.Accepted;

        if (!knownAgents[msg.sender]) {
            knownAgents[msg.sender] = true;
            activeAgentCount++;
        }

        emit QuestAccepted(questId, msg.sender);
    }

    function recordHeartbeat(uint256 questId)
        external
        onlyExistingQuest(questId)
        onlyQuestAgent(questId)
    {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Accepted && q.state != QuestState.InProgress) revert InvalidState();
        _requireWithinSubmissionWindow(q);

        if (q.state == QuestState.Accepted) {
            q.state = QuestState.InProgress;
        }

        lastHeartbeatAt[questId] = block.timestamp;
        emit HeartbeatRecorded(questId, block.timestamp);
    }

    function submitResult(
        uint256 questId,
        bytes32 resultHash,
        string calldata resultUri
    ) external onlyExistingQuest(questId) onlyQuestAgent(questId) {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Accepted && q.state != QuestState.InProgress) revert InvalidState();
        _requireWithinSubmissionWindow(q);

        if (q.state == QuestState.Accepted) {
            q.state = QuestState.InProgress;
            lastHeartbeatAt[questId] = block.timestamp;
            emit HeartbeatRecorded(questId, block.timestamp);
        }

        resultHashes[questId] = resultHash;
        resultUris[questId] = resultUri;
        q.submittedAt = block.timestamp;
        q.state = QuestState.Submitted;

        emit QuestSubmitted(questId);
    }

    function recordResultViewed(uint256 questId)
        external
        onlyExistingQuest(questId)
        onlyQuestClient(questId)
    {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Submitted) revert ResultNotPending();

        if (q.resultViewedAt == 0) {
            q.resultViewedAt = block.timestamp;
            emit ResultViewed(questId, block.timestamp);
        }
    }

    function submitEvaluation(
        uint256 questId,
        uint8[5] calldata scores,
        string calldata comment,
        string[] calldata tags
    ) external nonReentrant onlyExistingQuest(questId) onlyQuestClient(questId) whenSettlementActive {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Submitted) revert QuestNotSubmitted();

        uint256 avgScore = _averageScoreTenths(scores);
        q.evalScores = scores;
        q.evaluatedAt = block.timestamp;
        evaluationAvgScore[questId] = avgScore;

        emit QuestEvaluated(questId, scores, avgScore);

        if (avgScore >= 30) {
            q.state = QuestState.Evaluated;
            _issueEvaluationReward(msg.sender, q.agent, questId, comment, tags);
            _settleQuest(questId, _positiveReputationDelta(avgScore), "quest-evaluated");
            _rewardClientEval(q.client);
            _rewardClientFirstQuest(q.client);
            _notifyRegistryMasterJobCompletion(q.agent, avgScore * 2);
            return;
        }

        if (q.resultViewedAt == 0 && avgScore <= 10) {
            _compensate(questId, CompensationKind.UnviewedOneStar);
            _issueEvaluationReward(msg.sender, q.agent, questId, comment, tags);
            _rewardClientEval(q.client);
            return;
        }

        _compensate(questId, CompensationKind.LowScore);
        _issueEvaluationReward(msg.sender, q.agent, questId, comment, tags);
        _rewardClientEval(q.client);
    }

    function executeTimeout(uint256 questId)
        external
        nonReentrant
        onlyExistingQuest(questId)
        onlyKeeperOrAdmin
        whenSettlementActive
    {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Accepted && q.state != QuestState.InProgress) revert InvalidState();
        if (block.timestamp <= q.acceptedAt + SUBMISSION_TIMEOUT) revert NotTimedOut();

        q.state = QuestState.TimedOut;
        emit QuestTimedOut(questId);

        _compensate(questId, CompensationKind.Timeout);
    }

    function executeAutoApprove(uint256 questId)
        external
        nonReentrant
        onlyExistingQuest(questId)
        onlyKeeperOrAdmin
        whenSettlementActive
    {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Submitted) revert InvalidState();
        if (block.timestamp <= q.submittedAt + AUTO_APPROVE_DELAY) revert TooEarly();

        q.state = QuestState.AutoApproved;
        emit QuestAutoApproved(questId);

        _settleQuest(questId, REP_DELTA_AUTO_APPROVED, "quest-auto-approved");
        _rewardClientFirstQuest(q.client);
        _notifyRegistryMasterJobCompletion(q.agent, 80);
    }

    function previewFeeStage() public view returns (uint256 stage) {
        stage = currentFeeStage;
        uint256 length = feeRateBps.length;

        for (uint256 i = 1; i < length;) {
            if (activeClientCount >= clientThreshold[i] && activeAgentCount >= agentThreshold[i]) {
                stage = i;
            }
            unchecked {
                ++i;
            }
        }
    }

    function checkAndUpgradeFeeStage() external onlyKeeperOrAdmin returns (uint256 newStage) {
        newStage = previewFeeStage();

        if (newStage > currentFeeStage) {
            currentFeeStage = newStage;
            emit FeeStageUpgraded(newStage, feeRateBps[newStage]);
        }
    }

    function governanceDowngradeFeeStage(uint256 newStage) external onlyRole(GOVERNANCE_ROLE) {
        if (newStage >= feeRateBps.length) revert InvalidStage();
        if (newStage >= currentFeeStage) revert NotADowngrade();
        currentFeeStage = newStage;
        emit FeeStageDowngraded(newStage, feeRateBps[newStage]);
    }

    function assignPlanningAgent(uint256 questId, address agent)
        external
        onlyExistingQuest(questId)
        onlyKeeperOrAdmin
    {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Funded && q.state != QuestState.Accepted) revert InvalidState();
        q.planningAgent = agent;
        emit PlanningAgentAssigned(questId, agent);
    }

    function assignVerificationAgent(uint256 questId, address agent)
        external
        onlyExistingQuest(questId)
        onlyKeeperOrAdmin
    {
        Quest storage q = quests[questId];
        if (q.state != QuestState.Submitted) revert InvalidState();
        q.verificationAgent = agent;
        emit VerificationAgentAssigned(questId, agent);
    }

    function setRegistry(address newRegistry) external onlyRole(ADMIN_ROLE) {
        if (newRegistry == address(0)) revert RegistryZero();
        registry = newRegistry;
        emit RegistryUpdated(newRegistry);
    }

    function setMaxQuestDeposit(uint256 newMax) external onlyRole(ADMIN_ROLE) {
        if (newMax == 0) revert MaxZero();
        maxQuestDeposit = newMax;
        emit MaxQuestDepositUpdated(newMax);
    }

    function setMaxQuestDepositUsdc(uint256 newMax) external onlyRole(ADMIN_ROLE) {
        if (newMax == 0) revert MaxZero();
        maxQuestDepositUsdc = newMax;
        emit MaxQuestDepositUsdcUpdated(newMax);
    }

    function setSettlementPaused(bool paused) external onlyRole(ADMIN_ROLE) {
        settlementPaused = paused;
        emit SettlementPauseToggled(paused);
    }

    function setPriceFeeds(address newEthUsdFeed, address newTvrnUsdFeed) external onlyRole(ADMIN_ROLE) {
        if (newEthUsdFeed == address(0)) revert ZeroAddress();
        if (newTvrnUsdFeed == address(0)) revert ZeroAddress();
        ethUsdFeed = newEthUsdFeed;
        tvrnUsdFeed = newTvrnUsdFeed;
        emit OracleFeedsUpdated(newEthUsdFeed, newTvrnUsdFeed);
    }

    function setClientRPG(address rpg) external onlyRole(DEFAULT_ADMIN_ROLE) {
        clientRPG = rpg;
    }

    function rewardClientSignup(address client) external onlyRole(KEEPER_ROLE) {
        if (clientSignupRewarded[client]) revert AlreadyRewarded();
        clientSignupRewarded[client] = true;
        _mintClientRewardTVRN(client, CLIENT_SIGNUP_REWARD, CLIENT_REWARD_KIND_SIGNUP);
    }

    function rewardClientReferral(address referrer) external onlyRole(KEEPER_ROLE) {
        uint256 monthKey = _monthBucket(block.timestamp);
        if (clientReferralCountMonth[referrer][monthKey] >= CLIENT_REFERRAL_MONTHLY_CAP) {
            revert MonthlyCapReached();
        }

        clientReferralCountMonth[referrer][monthKey] += 1;
        _mintClientRewardTVRN(referrer, CLIENT_REFERRAL_REWARD, CLIENT_REWARD_KIND_REFERRAL);
    }

    function clientWithdrawTVRN(uint256 amount) external {
        if (address(clientRPG) == address(0)) revert RPGNotSet();

        _callClientRPG(abi.encodeWithSelector(ITavernClientRPG.withdrawFor.selector, msg.sender, amount));
    }

    function withdrawOperatorPool(address currency, address to, uint256 amount)
        external
        nonReentrant
        onlyRole(ADMIN_ROLE)
    {
        if (to == address(0)) revert ZeroRecipient();
        _debitPool(operatorPoolBalance, currency, amount);
        _transferCurrency(currency, to, amount);
        emit OperatorPoolWithdrawn(to, currency, amount);
    }

    function withdrawTreasuryReserve(address currency, address to, uint256 amount)
        external
        nonReentrant
        onlyRole(ADMIN_ROLE)
    {
        if (to == address(0)) revert ZeroRecipient();
        _debitPool(treasuryReserveBalance, currency, amount);
        _transferCurrency(currency, to, amount);
        emit TreasuryWithdrawn(to, currency, amount);
    }

    function executeBuybackBurn(address currency, uint256 amount)
        external
        nonReentrant
        onlyRole(ADMIN_ROLE)
    {
        _debitPool(buybackReserveBalance, currency, amount);
        _transferCurrency(currency, msg.sender, amount);
        emit BuybackExecuted(currency, amount);
    }

    function getQuestResult(uint256 questId)
        external
        view
        onlyExistingQuest(questId)
        returns (
            bytes32 resultHash,
            string memory resultUri,
            uint256 heartbeatAt
        )
    {
        return (resultHashes[questId], resultUris[questId], lastHeartbeatAt[questId]);
    }

    function creditBalanceOf(address account) public view returns (uint256 balanceUsd18) {
        CreditGrant[] storage grants = _creditGrants[account];
        uint256 length = grants.length;

        for (uint256 i = 0; i < length;) {
            if (grants[i].expiresAt > block.timestamp) {
                balanceUsd18 += grants[i].amountUsd18;
            }
            unchecked {
                ++i;
            }
        }
    }

    function creditGrantCount(address account) external view returns (uint256) {
        return _creditGrants[account].length;
    }

    function creditGrantAt(address account, uint256 index)
        external
        view
        returns (uint256 amountUsd18, uint256 expiresAt)
    {
        if (index >= _creditGrants[account].length) revert InvalidCreditIndex();
        CreditGrant storage grant = _creditGrants[account][index];
        return (grant.amountUsd18, grant.expiresAt);
    }

    function previewEvaluationReward(
        address client,
        address agent,
        string calldata comment,
        string[] calldata tags
    ) external view returns (uint256) {
        return _previewEvaluationReward(client, agent, comment, tags);
    }

    function previewCompensation(uint256 questId)
        external
        view
        onlyExistingQuest(questId)
        returns (
            uint256 tvrnAmount,
            uint256 creditAmountUsd18,
            uint256 operatorAmount
        )
    {
        Quest storage q = quests[questId];
        CompensationKind kind = q.compensated
            ? compensationKinds[questId]
            : _inferCompensationKind(q, evaluationAvgScore[questId]);
        (uint256 compensationPct, uint256 tvrnMultiplierBps, uint256 creditMultiplierBps, , uint256 operatorPct) =
            _compensationTerms(kind);

        uint256 usdValue = _toUsd18(q.currency, q.depositAmount);
        uint256 baseUsd = Math.mulDiv(usdValue, compensationPct, 100);
        tvrnAmount = _usd18ToTVRN(Math.mulDiv(baseUsd, tvrnMultiplierBps, BPS_DENOMINATOR));
        creditAmountUsd18 = Math.mulDiv(baseUsd, creditMultiplierBps, BPS_DENOMINATOR);
        operatorAmount = Math.mulDiv(q.depositAmount, operatorPct, 100);
    }

    function getCompensationAmountTVRN(
        uint256 depositAmount,
        address currency,
        uint256 compensationPct,
        uint256 multiplierBps
    ) public view returns (uint256 tvrnAmount) {
        if (compensationPct > 100) revert InvalidCompensationPct();
        uint256 usdValue = _toUsd18(currency, depositAmount);
        uint256 baseUsd = Math.mulDiv(usdValue, compensationPct, 100);
        tvrnAmount = _usd18ToTVRN(Math.mulDiv(baseUsd, multiplierBps, BPS_DENOMINATOR));
    }

    function getAutomationQuestView(uint256 questId)
        external
        view
        onlyExistingQuest(questId)
        returns (uint8 state, uint256 acceptedAt, uint256 submittedAt)
    {
        Quest storage q = quests[questId];
        return (uint8(q.state), q.acceptedAt, q.submittedAt);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _settleQuest(uint256 questId, int256 reputationDelta, string memory reputationTag) internal {
        Quest storage q = quests[questId];
        SettlementQuote memory quote = _quoteSettlement(q.depositAmount);
        uint256 serviceAmount = _distributeSettlementCurrency(q, quote);

        _mintSettlementTVRN(q, quote.agentTvrnReferenceAmount);
        _callClientRPG(abi.encodeWithSelector(ITavernClientRPG.grantJobCompleteEXP.selector, q.client));
        _notifyRegistryReputation(q.agent, reputationDelta, reputationTag);
        _notifyRegistryGuildActivity(
            q.agent,
            _toUsdcLikeAmount(_toUsd18(q.currency, quote.agentCurrencyPayout))
        );

        if (serviceAmount < _settlementRetainedMinimum(quote)) revert InvalidSettlementMath();
    }

    function _compensate(uint256 questId, CompensationKind kind) internal {
        Quest storage q = quests[questId];
        if (q.compensated) revert AlreadyCompensated();

        (uint256 compensationPct, uint256 tvrnMultiplierBps, uint256 creditMultiplierBps, int256 reputationDelta, uint256 operatorPct)
        = _compensationTerms(kind);

        if (compensationPct > 50) revert CompensationExceedsLimit();

        address client = q.client;
        address agent = q.agent;
        (uint256 tvrnAmount, uint256 creditAmountUsd18, uint256 operatorAmount) = _quoteCompensation(
            q.currency,
            q.depositAmount,
            compensationPct,
            tvrnMultiplierBps,
            creditMultiplierBps,
            operatorPct
        );

        operatorPoolBalance[q.currency] += operatorAmount;
        compensationReserveBalance[q.currency] += q.depositAmount - operatorAmount;

        q.compensated = true;
        q.state = QuestState.Compensated;
        q.tvrnUnlockTime = block.timestamp + TVRN_LOCK_DURATION;
        compensationKinds[questId] = kind;
        clientTvrnUnlockAt[client] = _max(clientTvrnUnlockAt[client], q.tvrnUnlockTime);

        if (creditAmountUsd18 > 0) {
            _grantCredit(client, creditAmountUsd18);
        }

        if (tvrnAmount > 0) {
            _mintQuestTVRN(client, tvrnAmount, "comp");
            _syncTokenUnlock(client, clientTvrnUnlockAt[client]);
        }

        _notifyRegistryReputation(agent, reputationDelta, _compensationTag(kind));
        emit QuestCompensated(questId, tvrnAmount, creditAmountUsd18);
    }

    function _issueEvaluationReward(
        address client,
        address agent,
        uint256 questId,
        string calldata comment,
        string[] calldata tags
    ) internal {
        uint256 reward = _previewEvaluationReward(client, agent, comment, tags);
        uint256 monthBucket = _monthBucket(block.timestamp);

        evalCountThisMonth[client][monthBucket] += 1;
        evalCountPerAgentThisMonth[client][agent][monthBucket] += 1;

        if (reward > 0) {
            _mintClientRewardTVRN(client, reward, CLIENT_REWARD_KIND_EVAL);
            emit EvaluationRewardPaid(client, questId, reward);
        }
    }

    function _rewardClientFirstQuest(address client) internal {
        if (clientFirstQuestRewarded[client]) {
            return;
        }

        clientFirstQuestRewarded[client] = true;
        _mintClientRewardTVRN(client, CLIENT_FIRST_QUEST_REWARD, CLIENT_REWARD_KIND_FIRST_QUEST);
    }

    function _rewardClientEval(address client) internal {
        _mintClientRewardTVRN(client, CLIENT_EVAL_REWARD, CLIENT_REWARD_KIND_EVAL);
        _callClientRPG(abi.encodeWithSelector(ITavernClientRPG.grantEvalEXP.selector, client));
    }

    function _previewEvaluationReward(
        address client,
        address agent,
        string calldata comment,
        string[] calldata tags
    ) internal view returns (uint256 reward) {
        uint256 monthBucket = _monthBucket(block.timestamp);
        uint256 ordinal = evalCountThisMonth[client][monthBucket] + 1;
        uint256 sameAgentOrdinal = evalCountPerAgentThisMonth[client][agent][monthBucket] + 1;

        if (sameAgentOrdinal > 3) {
            return 0;
        }

        uint256 baseReward = _baseEvaluationReward(comment, tags);
        uint256 multiplierBps = _evaluationRewardMultiplierBps(ordinal);

        reward = (baseReward * multiplierBps) / BPS_DENOMINATOR;
    }

    function _baseEvaluationReward(
        string calldata comment,
        string[] calldata tags
    ) internal pure returns (uint256) {
        uint256 commentLength = bytes(comment).length;

        if (commentLength >= 100 && tags.length > 0) {
            return 5 ether;
        }

        if (commentLength >= 50) {
            return 3 ether;
        }

        return 1 ether;
    }

    function _evaluationRewardMultiplierBps(uint256 ordinal) internal pure returns (uint256) {
        if (ordinal <= 10) {
            return 10_000;
        }

        if (ordinal <= 20) {
            return 5_000;
        }

        if (ordinal <= 30) {
            return 2_000;
        }

        return 0;
    }

    function _compensationTerms(CompensationKind kind)
        internal
        pure
        returns (
            uint256 compensationPct,
            uint256 tvrnMultiplierBps,
            uint256 creditMultiplierBps,
            int256 reputationDelta,
            uint256 operatorPct
        )
    {
        if (kind == CompensationKind.Timeout) {
            return (
                TIMEOUT_COMP_PCT,
                TIMEOUT_TVRN_MULTIPLIER_BPS,
                TIMEOUT_CREDIT_MULTIPLIER_BPS,
                REP_DELTA_TIMEOUT,
                10
            );
        }

        if (kind == CompensationKind.UnviewedOneStar) {
            return (
                UNVIEWED_ONE_STAR_COMP_PCT,
                LOW_SCORE_TVRN_MULTIPLIER_BPS,
                LOW_SCORE_CREDIT_MULTIPLIER_BPS,
                REP_DELTA_UNVIEWED_ONE_STAR,
                24
            );
        }

        return (
            LOW_SCORE_COMP_PCT,
            LOW_SCORE_TVRN_MULTIPLIER_BPS,
            LOW_SCORE_CREDIT_MULTIPLIER_BPS,
            REP_DELTA_LOW_SCORE,
            64
        );
    }

    function _inferCompensationKind(Quest storage q, uint256 avgScore)
        internal
        view
        returns (CompensationKind)
    {
        if (q.state == QuestState.TimedOut) {
            return CompensationKind.Timeout;
        }

        if (q.resultViewedAt == 0 && avgScore <= 10) {
            return CompensationKind.UnviewedOneStar;
        }

        return CompensationKind.LowScore;
    }

    function _averageScoreTenths(uint8[5] calldata scores) internal pure returns (uint256 avgScore) {
        uint256 total = 0;

        for (uint256 i = 0; i < scores.length;) {
            if (scores[i] < 1 || scores[i] > 5) revert ScoreOutOfRange();
            total += scores[i];
            unchecked {
                ++i;
            }
        }

        avgScore = (total * 10) / scores.length;
    }

    function _positiveReputationDelta(uint256 avgScore) internal pure returns (int256) {
        if (avgScore >= 45) {
            return 15;
        }

        if (avgScore >= 40) {
            return 10;
        }

        if (avgScore >= 35) {
            return 7;
        }

        return 5;
    }

    function _grantCredit(address account, uint256 amountUsd18) internal {
        uint256 expiresAt = block.timestamp + CREDIT_EXPIRY;
        _creditGrants[account].push(CreditGrant({amountUsd18: amountUsd18, expiresAt: expiresAt}));
        emit CreditGranted(account, amountUsd18, expiresAt);
    }

    function _routeFeeAmount(address currency, uint256 feeAmount) internal {
        if (feeAmount == 0) {
            return;
        }

        uint256 operatorAmount = (feeAmount * OPERATOR_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 buybackAmount = (feeAmount * BUYBACK_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 treasuryAmount = feeAmount - operatorAmount - buybackAmount;

        operatorPoolBalance[currency] += operatorAmount;
        buybackReserveBalance[currency] += buybackAmount;
        treasuryReserveBalance[currency] += treasuryAmount;
    }

    function _quoteSettlement(uint256 depositAmount) internal view returns (SettlementQuote memory quote) {
        quote.feeAmount = (depositAmount * feeRateBps[currentFeeStage]) / BPS_DENOMINATOR;
        quote.afterFee = depositAmount - quote.feeAmount;
        quote.agentCurrencyPayout = Math.mulDiv(
            quote.afterFee,
            AGENT_TOTAL_BPS * AGENT_CURRENCY_RATIO_BPS,
            BPS_DENOMINATOR * BPS_DENOMINATOR
        );
        quote.agentTvrnReferenceAmount = Math.mulDiv(
            quote.afterFee,
            AGENT_TOTAL_BPS * AGENT_TVRN_RATIO_BPS,
            BPS_DENOMINATOR * BPS_DENOMINATOR
        );
        quote.planningNominal = Math.mulDiv(quote.afterFee, PLANNING_AGENT_BPS, BPS_DENOMINATOR);
        quote.verificationNominal = Math.mulDiv(quote.afterFee, VERIFICATION_AGENT_BPS, BPS_DENOMINATOR);
    }

    function _distributeSettlementCurrency(Quest storage q, SettlementQuote memory quote)
        internal
        returns (uint256 serviceAmount)
    {
        uint256 planningTransferred = _payAssignedAgent(q.currency, q.planningAgent, quote.planningNominal);
        uint256 verificationTransferred =
            _payAssignedAgent(q.currency, q.verificationAgent, quote.verificationNominal);

        _routeFeeAmount(q.currency, quote.feeAmount);
        _transferCurrency(q.currency, q.agent, quote.agentCurrencyPayout);

        serviceAmount = quote.afterFee - quote.agentCurrencyPayout - planningTransferred - verificationTransferred;
        servicePoolBalance[q.currency] += serviceAmount;
    }

    function _mintSettlementTVRN(Quest storage q, uint256 currencyReferenceAmount) internal {
        uint256 agentTvrnUsd = _toUsd18(q.currency, currencyReferenceAmount);
        uint256 agentTvrnAmount = _usd18ToTVRN(agentTvrnUsd);

        if (agentTvrnAmount > 0) {
            _mintQuestTVRN(q.agent, agentTvrnAmount, "quest-share");
        }
    }

    function _payAssignedAgent(address currency, address assignee, uint256 amount) internal returns (uint256 paid) {
        if (assignee == address(0) || amount == 0) {
            return 0;
        }

        _transferCurrency(currency, assignee, amount);
        return amount;
    }

    function _settlementRetainedMinimum(SettlementQuote memory quote) internal pure returns (uint256) {
        return Math.mulDiv(quote.afterFee, ATTENDANCE_POOL_BPS, BPS_DENOMINATOR) + quote.agentTvrnReferenceAmount;
    }

    function _quoteCompensation(
        address currency,
        uint256 depositAmount,
        uint256 compensationPct,
        uint256 tvrnMultiplierBps,
        uint256 creditMultiplierBps,
        uint256 operatorPct
    )
        internal
        view
        returns (uint256 tvrnAmount, uint256 creditAmountUsd18, uint256 operatorAmount)
    {
        uint256 depositUsd = _toUsd18(currency, depositAmount);
        uint256 baseUsd = Math.mulDiv(depositUsd, compensationPct, 100);

        tvrnAmount = _usd18ToTVRN(Math.mulDiv(baseUsd, tvrnMultiplierBps, BPS_DENOMINATOR));
        creditAmountUsd18 = Math.mulDiv(baseUsd, creditMultiplierBps, BPS_DENOMINATOR);
        operatorAmount = Math.mulDiv(depositAmount, operatorPct, 100);
    }

    function _toUsd18(address currency, uint256 amount) internal view returns (uint256) {
        if (amount == 0) {
            return 0;
        }

        if (currency == address(0)) {
            uint256 ethPrice = _getCheckedPrice(ethUsdFeed);
            uint8 ethPriceDecimals = AggregatorV3Interface(ethUsdFeed).decimals();
            return (amount * ethPrice) / (10 ** ethPriceDecimals);
        }

        if (currency != address(usdc)) revert UnsupportedCurrency();

        if (usdcDecimals == 18) {
            return amount;
        }

        if (usdcDecimals < 18) {
            return amount * (10 ** (18 - usdcDecimals));
        }

        return amount / (10 ** (usdcDecimals - 18));
    }

    function _usd18ToTVRN(uint256 usdAmount18) internal view returns (uint256) {
        if (usdAmount18 == 0) {
            return 0;
        }

        uint256 tvrnPrice = _getCheckedPrice(tvrnUsdFeed);
        uint8 tvrnPriceDecimals = AggregatorV3Interface(tvrnUsdFeed).decimals();

        return (usdAmount18 * (10 ** tvrnPriceDecimals)) / tvrnPrice;
    }

    function _toUsdcLikeAmount(uint256 usdAmount18) internal view returns (uint256) {
        if (usdcDecimals == 18) {
            return usdAmount18;
        }

        if (usdcDecimals < 18) {
            return usdAmount18 / (10 ** (18 - usdcDecimals));
        }

        return usdAmount18 * (10 ** (usdcDecimals - 18));
    }

    function _getCheckedPrice(address feed) internal view returns (uint256) {
        if (feed == address(0)) revert OracleNotSet();

        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = AggregatorV3Interface(feed).latestRoundData();

        if (price <= 0) revert OracleInvalidPrice();
        if (updatedAt <= block.timestamp - ORACLE_STALENESS) revert OracleStalePrice();
        if (answeredInRound < roundId) revert OracleIncompleteRound();

        return uint256(price);
    }

    function _mintQuestTVRN(address to, uint256 amount, string memory reason) internal {
        if (amount == 0) {
            return;
        }

        (bool success, ) =
            tavernToken.call(abi.encodeWithSignature("questMint(address,uint256,string)", to, amount, reason));

        if (!success) revert MintFailed();
    }

    function _mintClientRewardTVRN(address to, uint256 amount, uint8 rewardKind) internal {
        if (amount == 0) {
            return;
        }

        if (address(clientRPG) == address(0)) revert RPGNotSet();

        _callClientRPG(abi.encodeWithSelector(ITavernClientRPG.accumulateReward.selector, to, amount, rewardKind));
    }

    function _callClientRPG(bytes memory data) internal {
        (bool success, ) = clientRPG.call(data);
        if (!success) revert MintFailed();
    }

    function _syncTokenUnlock(address account, uint256 unlockAt) internal {
        (bool success, ) =
            tavernToken.call(abi.encodeWithSignature("setUnlockTime(address,uint256)", account, unlockAt));
        if (!success) {
            return;
        }
    }

    function _notifyRegistryReputation(
        address agent,
        int256 reputationDelta,
        string memory reputationTag
    ) internal {
        address registryAddress = registry;
        if (registryAddress == address(0) || agent == address(0) || reputationDelta == 0) {
            return;
        }

        try ITavernRegistry(registryAddress).updateReputation(agent, reputationDelta) {} catch {}
        try ITavernRegistry(registryAddress).mirrorERC8004Reputation(agent, reputationDelta, "claw-tavern", reputationTag) returns (bool) {} catch {}
    }

    function _notifyRegistryGuildActivity(address agent, uint256 earnedUsdc) internal {
        address registryAddress = registry;
        if (registryAddress == address(0) || agent == address(0) || earnedUsdc == 0) {
            return;
        }

        try ITavernRegistry(registryAddress).getAgent(agent) returns (ITavernRegistry.AgentProfile memory profile) {
            if (profile.guildId != 0) {
                try ITavernRegistry(registryAddress).recordGuildActivity(profile.guildId, earnedUsdc) {} catch {}
            }
        } catch {}
    }

    function _notifyRegistryMasterJobCompletion(address agent, uint256 satisfactionScore) internal {
        address registryAddress = registry;
        if (registryAddress == address(0) || agent == address(0)) {
            return;
        }

        try ITavernRegistry(registryAddress).recordMasterJobCompletion(agent, satisfactionScore) {} catch {}
    }

    function _requireWithinSubmissionWindow(Quest storage q) internal view {
        if (block.timestamp > q.acceptedAt + SUBMISSION_TIMEOUT) revert SubmissionWindowClosed();
    }

    function _transferCurrency(address currency, address to, uint256 amount) internal {
        if (amount == 0) {
            return;
        }

        if (currency == address(0)) {
            (bool success, ) = payable(to).call{value: amount}("");
            if (!success) revert EthTransferFailed();
            return;
        }

        if (currency != address(usdc)) revert UnsupportedCurrency();
        IERC20(address(usdc)).safeTransfer(to, amount);
    }

    function _debitPool(
        mapping(address => uint256) storage pool,
        address currency,
        uint256 amount
    ) internal {
        if (pool[currency] < amount) revert InsufficientPool();
        unchecked {
            pool[currency] -= amount;
        }
    }

    function _monthBucket(uint256 timestamp) internal pure returns (uint256) {
        return timestamp / 30 days;
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    function _compensationTag(CompensationKind kind) internal pure returns (string memory) {
        if (kind == CompensationKind.Timeout) {
            return "quest-timeout";
        }

        if (kind == CompensationKind.UnviewedOneStar) {
            return "quest-unviewed-one-star";
        }

        return "quest-low-score";
    }
}
