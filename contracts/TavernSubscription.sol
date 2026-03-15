// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/ITavernClientRPG.sol";

interface ITavernRegistrySubscription {
    function isAgentActive(address agent) external view returns (bool);
}

contract TavernSubscription is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SUBSCRIPTION_FEE_BPS = 500;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SUBSCRIPTION_PERIOD = 30 days;
    uint256 public constant MIN_MONTHLY_RATE = 10 * 1e6;
    uint256 public constant MAX_MONTHLY_RATE = 10_000 * 1e6;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    struct Subscription {
        address client;
        address agent;
        uint256 monthlyRateUsdc;
        uint256 currentPeriodStart;
        uint256 currentPeriodEnd;
        bool active;
        bool cancelledByClient;
    }

    IERC20 public immutable usdc;
    address public operatorWallet;
    ITavernClientRPG public clientRPG;
    ITavernRegistrySubscription public registry;

    uint256 public nextSubscriptionId;

    mapping(uint256 => Subscription) public subscriptions;
    mapping(address => mapping(address => uint256)) public clientAgentSub;
    mapping(address => uint256) public agentMonthlyRate;

    event AgentRateSet(address indexed agent, uint256 rateUsdc);
    event Subscribed(
        uint256 indexed subId,
        address indexed client,
        address indexed agent,
        uint256 rateUsdc
    );
    event SubscriptionRenewed(
        uint256 indexed subId,
        address indexed client,
        address indexed agent,
        uint256 rateUsdc
    );
    event SubscriptionCancelled(
        uint256 indexed subId,
        address indexed client,
        address indexed agent
    );
    event SubscriptionExpired(
        uint256 indexed subId,
        address indexed client,
        address indexed agent
    );
    event SubscriptionFeeDistributed(
        address indexed client,
        address indexed agent,
        uint256 fee,
        address indexed operatorWallet
    );
    event ClientRPGSet(address indexed clientRPG);
    event OperatorWalletSet(address indexed operatorWallet);

    constructor(address _usdc, address _operatorWallet, address _registry) {
        require(_usdc != address(0), "USDC zero");
        require(_operatorWallet != address(0), "Operator wallet zero");
        require(_registry != address(0), "Registry zero");

        usdc = IERC20(_usdc);
        operatorWallet = _operatorWallet;
        registry = ITavernRegistrySubscription(_registry);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setClientRPG(address _rpg) external onlyRole(DEFAULT_ADMIN_ROLE) {
        clientRPG = ITavernClientRPG(_rpg);
        emit ClientRPGSet(_rpg);
    }

    function setOperatorWallet(address _operatorWallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_operatorWallet != address(0), "Operator wallet zero");
        operatorWallet = _operatorWallet;
        emit OperatorWalletSet(_operatorWallet);
    }

    function setAgentMonthlyRate(uint256 rateUsdc) external {
        require(registry.isAgentActive(msg.sender), "Not active agent");
        require(rateUsdc >= MIN_MONTHLY_RATE && rateUsdc <= MAX_MONTHLY_RATE, "Rate out of range");

        agentMonthlyRate[msg.sender] = rateUsdc;
        emit AgentRateSet(msg.sender, rateUsdc);
    }

    function subscribe(address agent) external nonReentrant {
        uint256 rate = agentMonthlyRate[agent];
        require(rate > 0, "Agent has no rate");
        require(registry.isAgentActive(agent), "Agent not active");
        require(operatorWallet != address(0), "Operator wallet zero");

        uint256 fee = (rate * SUBSCRIPTION_FEE_BPS) / BPS_DENOMINATOR;
        uint256 agentPayment = rate - fee;

        usdc.safeTransferFrom(msg.sender, address(this), rate);
        usdc.safeTransfer(agent, agentPayment);
        usdc.safeTransfer(operatorWallet, fee);

        uint256 subId = clientAgentSub[msg.sender][agent];
        if (subId == 0) {
            unchecked {
                nextSubscriptionId += 1;
            }
            subId = nextSubscriptionId;
            clientAgentSub[msg.sender][agent] = subId;

            subscriptions[subId] = Subscription({
                client: msg.sender,
                agent: agent,
                monthlyRateUsdc: rate,
                currentPeriodStart: block.timestamp,
                currentPeriodEnd: block.timestamp + SUBSCRIPTION_PERIOD,
                active: true,
                cancelledByClient: false
            });

            emit Subscribed(subId, msg.sender, agent, rate);
        } else {
            Subscription storage sub = subscriptions[subId];
            sub.client = msg.sender;
            sub.agent = agent;
            sub.monthlyRateUsdc = rate;
            sub.currentPeriodStart = block.timestamp;
            sub.currentPeriodEnd = block.timestamp + SUBSCRIPTION_PERIOD;
            sub.active = true;
            sub.cancelledByClient = false;

            emit SubscriptionRenewed(subId, msg.sender, agent, rate);
        }

        if (address(clientRPG) != address(0)) {
            clientRPG.grantSubscriptionEXP(msg.sender);
        }

        emit SubscriptionFeeDistributed(msg.sender, agent, fee, operatorWallet);
    }

    function cancelSubscription(uint256 subId) external {
        Subscription storage sub = subscriptions[subId];
        require(sub.client == msg.sender, "Not your subscription");
        require(sub.active, "Already inactive");

        sub.cancelledByClient = true;
        emit SubscriptionCancelled(subId, msg.sender, sub.agent);
    }

    function isSubscriptionActive(address client, address agent) external view returns (bool) {
        uint256 subId = clientAgentSub[client][agent];
        if (subId == 0) {
            return false;
        }

        Subscription storage sub = subscriptions[subId];
        return sub.active && block.timestamp <= sub.currentPeriodEnd;
    }

    function expireSubscription(uint256 subId) external onlyRole(KEEPER_ROLE) {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Already inactive");
        require(block.timestamp > sub.currentPeriodEnd, "Not expired yet");

        sub.active = false;
        emit SubscriptionExpired(subId, sub.client, sub.agent);
    }

    function pendingExpiries(uint256 limit) external view returns (uint256[] memory ids) {
        if (limit == 0 || nextSubscriptionId == 0) {
            return new uint256[](0);
        }

        ids = new uint256[](limit);
        uint256 count = 0;

        for (uint256 subId = 1; subId <= nextSubscriptionId && count < limit;) {
            Subscription storage sub = subscriptions[subId];
            if (sub.active && block.timestamp > sub.currentPeriodEnd) {
                ids[count] = subId;
                unchecked {
                    count += 1;
                }
            }

            unchecked {
                subId += 1;
            }
        }

        assembly {
            mstore(ids, count)
        }
    }
}
