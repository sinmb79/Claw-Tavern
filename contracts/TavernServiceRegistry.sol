// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/ITavernGuild.sol";

interface ITavernEscrowServiceRegistry {
    function createQuestFromService(
        address client,
        address agent,
        uint256 amount,
        uint256 serviceId,
        uint8 tier
    ) external returns (uint256 questId);
}

interface ITavernRegistryServiceRegistry {
    function isAgentActive(address agent) external view returns (bool);
}

contract TavernServiceRegistry is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SERVICES_PER_AGENT = 10;
    uint256 public constant MAX_TAGS_PER_SERVICE = 10;
    uint256 public constant MIN_PRICE = 1_000_000;
    uint256 public constant MAX_PRICE = 1_000_000_000_000;
    uint256 public constant PLATFORM_FEE_BPS = 500;

    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");

    struct Service {
        address agent;
        uint8 guildId;
        string title;
        string description;
        uint256[3] tierPrices;
        string[] tags;
        uint256 completedCount;
        uint256 totalRating;
        uint256 ratingCount;
        bool active;
        uint256 createdAt;
        uint256 updatedAt;
    }

    ITavernGuild public guild;
    ITavernEscrowServiceRegistry public escrow;
    ITavernRegistryServiceRegistry public registry;
    IERC20 public usdc;

    uint256 public serviceCount;

    mapping(uint256 => Service) private _services;
    mapping(uint8 => uint256[]) private _guildServices;
    mapping(address => uint256[]) private _agentServices;

    event ServiceRegistered(uint256 indexed serviceId, address indexed agent, uint8 guildId, string title);
    event ServiceUpdated(uint256 indexed serviceId, string title);
    event ServiceTagsUpdated(uint256 indexed serviceId, uint256 tagCount);
    event ServiceDeactivated(uint256 indexed serviceId);
    event ServiceReactivated(uint256 indexed serviceId);
    event ServiceHired(
        uint256 indexed serviceId,
        address indexed client,
        address indexed agent,
        uint8 tier,
        uint256 price,
        uint256 questId
    );
    event ServiceCompleted(uint256 indexed serviceId, uint256 totalCompleted, uint256 rating);
    event GuildUpdated(address indexed guild);
    event EscrowUpdated(address indexed escrow);
    event RegistryUpdated(address indexed registry);

    constructor(address guild_, address escrow_, address registry_, address usdc_) {
        require(guild_ != address(0), "Guild zero");
        require(escrow_ != address(0), "Escrow zero");
        require(registry_ != address(0), "Registry zero");
        require(usdc_ != address(0), "USDC zero");

        guild = ITavernGuild(guild_);
        escrow = ITavernEscrowServiceRegistry(escrow_);
        registry = ITavernRegistryServiceRegistry(registry_);
        usdc = IERC20(usdc_);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function services(uint256 serviceId)
        external
        view
        returns (
            address agent,
            uint8 guildId,
            string memory title,
            string memory description,
            uint256[3] memory tierPrices,
            uint256 completedCount,
            uint256 totalRating,
            uint256 ratingCount,
            bool active,
            uint256 createdAt,
            uint256 updatedAt
        )
    {
        Service storage svc = _services[serviceId];
        return (
            svc.agent,
            svc.guildId,
            svc.title,
            svc.description,
            svc.tierPrices,
            svc.completedCount,
            svc.totalRating,
            svc.ratingCount,
            svc.active,
            svc.createdAt,
            svc.updatedAt
        );
    }

    function registerService(
        uint8 guildId,
        string calldata title,
        string calldata description,
        uint256[3] calldata tierPrices,
        string[] calldata tags
    ) external returns (uint256 serviceId) {
        require(guildId < guild.GUILD_COUNT(), "Invalid guild");
        require(registry.isAgentActive(msg.sender), "Not registered agent");
        require(_agentServices[msg.sender].length < MAX_SERVICES_PER_AGENT, "Max services reached");
        require(bytes(title).length > 0 && bytes(title).length <= 100, "Invalid title length");
        require(bytes(description).length > 0 && bytes(description).length <= 2000, "Invalid desc length");
        require(tags.length <= MAX_TAGS_PER_SERVICE, "Too many tags");

        _validateTierPrices(tierPrices);

        if (!guild.isInGuild(msg.sender, guildId)) {
            guild.addMember(guildId, msg.sender);
        }

        serviceId = ++serviceCount;
        Service storage svc = _services[serviceId];
        svc.agent = msg.sender;
        svc.guildId = guildId;
        svc.title = title;
        svc.description = description;
        svc.tierPrices = tierPrices;
        svc.tags = tags;
        svc.active = true;
        svc.createdAt = block.timestamp;
        svc.updatedAt = block.timestamp;

        _guildServices[guildId].push(serviceId);
        _agentServices[msg.sender].push(serviceId);

        emit ServiceRegistered(serviceId, msg.sender, guildId, title);
    }

    function updateService(
        uint256 serviceId,
        string calldata title,
        string calldata description,
        uint256[3] calldata tierPrices
    ) external {
        Service storage svc = _services[serviceId];
        require(svc.agent == msg.sender, "Not service owner");
        require(svc.active, "Service inactive");
        require(bytes(title).length > 0 && bytes(title).length <= 100, "Invalid title");
        require(bytes(description).length > 0 && bytes(description).length <= 2000, "Invalid desc");

        _validateTierPrices(tierPrices);

        svc.title = title;
        svc.description = description;
        svc.tierPrices = tierPrices;
        svc.updatedAt = block.timestamp;

        emit ServiceUpdated(serviceId, title);
    }

    function updateTags(uint256 serviceId, string[] calldata tags) external {
        Service storage svc = _services[serviceId];
        require(svc.agent == msg.sender, "Not service owner");
        require(tags.length <= MAX_TAGS_PER_SERVICE, "Too many tags");

        svc.tags = tags;
        svc.updatedAt = block.timestamp;

        emit ServiceTagsUpdated(serviceId, tags.length);
    }

    function deactivateService(uint256 serviceId) external {
        Service storage svc = _services[serviceId];
        require(svc.agent == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not authorized");
        require(svc.active, "Already inactive");
        svc.active = false;
        svc.updatedAt = block.timestamp;

        emit ServiceDeactivated(serviceId);
    }

    function reactivateService(uint256 serviceId) external {
        Service storage svc = _services[serviceId];
        require(svc.agent == msg.sender, "Not service owner");
        require(!svc.active, "Already active");
        svc.active = true;
        svc.updatedAt = block.timestamp;

        emit ServiceReactivated(serviceId);
    }

    function hireFromService(uint256 serviceId, uint8 tier) external nonReentrant returns (uint256 questId) {
        Service storage svc = _services[serviceId];
        require(svc.active, "Service inactive");
        require(tier <= 2, "Invalid tier");
        require(svc.tierPrices[tier] > 0, "Tier not offered");
        require(msg.sender != svc.agent, "Cannot hire yourself");

        uint256 price = svc.tierPrices[tier];
        usdc.safeTransferFrom(msg.sender, address(escrow), price);
        questId = escrow.createQuestFromService(msg.sender, svc.agent, price, serviceId, tier);

        emit ServiceHired(serviceId, msg.sender, svc.agent, tier, price, questId);
    }

    function recordServiceCompletion(uint256 serviceId, uint256 volume, uint256 rating)
        external
        onlyRole(ESCROW_ROLE)
    {
        _recordServiceCompletion(serviceId, volume, rating);
    }

    function getServicesByGuild(uint8 guildId) external view returns (uint256[] memory) {
        return _guildServices[guildId];
    }

    function getServicesByAgent(address agent) external view returns (uint256[] memory) {
        return _agentServices[agent];
    }

    function getServiceCount() external view returns (uint256) {
        return serviceCount;
    }

    function getServiceTags(uint256 serviceId) external view returns (string[] memory) {
        return _services[serviceId].tags;
    }

    function getAverageRating(uint256 serviceId) external view returns (uint256) {
        Service storage svc = _services[serviceId];
        if (svc.ratingCount == 0) {
            return 0;
        }
        return svc.totalRating / svc.ratingCount;
    }

    function getActiveServicesByGuild(uint8 guildId) external view returns (uint256[] memory) {
        uint256[] storage allServices = _guildServices[guildId];
        uint256 activeCount = 0;
        uint256 length = allServices.length;

        for (uint256 i = 0; i < length;) {
            if (_services[allServices[i]].active) {
                activeCount += 1;
            }
            unchecked {
                ++i;
            }
        }

        uint256[] memory activeServices = new uint256[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < length;) {
            uint256 serviceId = allServices[i];
            if (_services[serviceId].active) {
                activeServices[index] = serviceId;
                index += 1;
            }
            unchecked {
                ++i;
            }
        }

        return activeServices;
    }

    function setGuild(address guild_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(guild_ != address(0), "Guild zero");
        guild = ITavernGuild(guild_);
        emit GuildUpdated(guild_);
    }

    function setEscrow(address escrow_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(escrow_ != address(0), "Escrow zero");
        escrow = ITavernEscrowServiceRegistry(escrow_);
        emit EscrowUpdated(escrow_);
    }

    function setRegistry(address registry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(registry_ != address(0), "Registry zero");
        registry = ITavernRegistryServiceRegistry(registry_);
        emit RegistryUpdated(registry_);
    }

    function adminDeactivateService(uint256 serviceId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Service storage svc = _services[serviceId];
        if (svc.active) {
            svc.active = false;
            svc.updatedAt = block.timestamp;
            emit ServiceDeactivated(serviceId);
        }
    }

    function _recordServiceCompletion(uint256 serviceId, uint256 volume, uint256 rating) internal {
        require(serviceId != 0 && serviceId <= serviceCount, "Service not found");
        require(rating >= 10 && rating <= 50, "Invalid rating");

        Service storage svc = _services[serviceId];
        svc.completedCount += 1;
        svc.totalRating += rating;
        svc.ratingCount += 1;

        guild.recordGuildCompletion(svc.agent, svc.guildId, volume);
        guild.recordRating(svc.agent, svc.guildId, rating);

        emit ServiceCompleted(serviceId, svc.completedCount, rating);
    }

    function _validateTierPrices(uint256[3] calldata tierPrices) internal pure {
        require(tierPrices[0] >= MIN_PRICE && tierPrices[0] <= MAX_PRICE, "Invalid standard price");
        if (tierPrices[1] > 0) {
            require(tierPrices[1] >= tierPrices[0] && tierPrices[1] <= MAX_PRICE, "Invalid deluxe price");
        }
        if (tierPrices[2] > 0) {
            uint256 floorPrice = tierPrices[1] > 0 ? tierPrices[1] : tierPrices[0];
            require(tierPrices[2] >= floorPrice && tierPrices[2] <= MAX_PRICE, "Invalid premium price");
        }
    }
}
