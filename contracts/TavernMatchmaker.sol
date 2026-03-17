// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

interface ITavernServiceRegistryMatchmaker {
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
        );

    function getActiveServicesByGuild(uint8 guildId) external view returns (uint256[] memory);

    function getAverageRating(uint256 serviceId) external view returns (uint256);
}

interface ITavernClientRPGMatchmaker {
    function clientProfiles(address client)
        external
        view
        returns (
            uint256 registeredAt,
            uint256 exp,
            uint256 level,
            uint256 totalJobsCompleted,
            uint256 lastWithdrawalAt,
            uint256 withdrawnThisMonth,
            uint256 lastWithdrawalMonth,
            bool verified,
            bool banned
        );
}

contract TavernMatchmaker is AccessControl {
    struct AgentScore {
        address agent;
        uint256 serviceId;
        uint256 score;
    }

    ITavernServiceRegistryMatchmaker public serviceRegistry;
    ITavernClientRPGMatchmaker public rpg;

    uint256 public weightRating = 40;
    uint256 public weightLevel = 25;
    uint256 public weightCompletions = 20;
    uint256 public weightPrice = 15;

    event WeightsUpdated(uint256 rating, uint256 level, uint256 completions, uint256 price);
    event ServiceRegistryUpdated(address indexed serviceRegistry);
    event RPGUpdated(address indexed rpg);

    constructor(address serviceRegistry_, address rpg_) {
        require(serviceRegistry_ != address(0), "Registry zero");
        require(rpg_ != address(0), "RPG zero");

        serviceRegistry = ITavernServiceRegistryMatchmaker(serviceRegistry_);
        rpg = ITavernClientRPGMatchmaker(rpg_);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function getRecommendedAgents(uint8 guildId, uint256 budget, uint256 maxResults)
        external
        view
        returns (
            address[] memory agents,
            uint256[] memory serviceIds,
            uint256[] memory scores
        )
    {
        if (maxResults == 0) {
            return (new address[](0), new uint256[](0), new uint256[](0));
        }

        uint256[] memory activeServices = serviceRegistry.getActiveServicesByGuild(guildId);
        AgentScore[] memory ranked = new AgentScore[](activeServices.length);
        uint256 validCount = 0;

        for (uint256 i = 0; i < activeServices.length;) {
            uint256 serviceId = activeServices[i];
            (
                address agent,
                ,
                ,
                ,
                uint256[3] memory tierPrices,
                uint256 completedCount,
                ,
                ,
                bool active,
                ,
            ) = serviceRegistry.services(serviceId);

            if (active && (budget == 0 || tierPrices[0] <= budget)) {
                (, , uint256 level, , , , , bool verified, bool banned) = rpg.clientProfiles(agent);
                if (!banned) {
                    uint256 rating = serviceRegistry.getAverageRating(serviceId);
                    uint256 score =
                        _calculateScore(rating, level, completedCount, tierPrices[0], budget);

                    if (verified) {
                        score += 5;
                    }

                    ranked[validCount] = AgentScore(agent, serviceId, score);
                    validCount += 1;
                }
            }

            unchecked {
                ++i;
            }
        }

        for (uint256 i = 1; i < validCount;) {
            AgentScore memory key = ranked[i];
            uint256 j = i;

            while (j > 0 && ranked[j - 1].score < key.score) {
                ranked[j] = ranked[j - 1];
                j -= 1;
            }

            ranked[j] = key;
            unchecked {
                ++i;
            }
        }

        uint256 resultCount = validCount < maxResults ? validCount : maxResults;
        agents = new address[](resultCount);
        serviceIds = new uint256[](resultCount);
        scores = new uint256[](resultCount);

        for (uint256 i = 0; i < resultCount;) {
            agents[i] = ranked[i].agent;
            serviceIds[i] = ranked[i].serviceId;
            scores[i] = ranked[i].score;
            unchecked {
                ++i;
            }
        }
    }

    function setWeights(
        uint256 rating,
        uint256 level,
        uint256 completions,
        uint256 price
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(rating + level + completions + price == 100, "Weights must sum to 100");

        weightRating = rating;
        weightLevel = level;
        weightCompletions = completions;
        weightPrice = price;

        emit WeightsUpdated(rating, level, completions, price);
    }

    function setServiceRegistry(address serviceRegistry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(serviceRegistry_ != address(0), "Registry zero");
        serviceRegistry = ITavernServiceRegistryMatchmaker(serviceRegistry_);
        emit ServiceRegistryUpdated(serviceRegistry_);
    }

    function setRPG(address rpg_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(rpg_ != address(0), "RPG zero");
        rpg = ITavernClientRPGMatchmaker(rpg_);
        emit RPGUpdated(rpg_);
    }

    function _calculateScore(
        uint256 rating,
        uint256 level,
        uint256 completions,
        uint256 price,
        uint256 budget
    ) internal view returns (uint256) {
        uint256 ratingScore = rating * 2;
        uint256 levelScore = level > 100 ? 100 : level;
        uint256 completionScore = completions > 100 ? 100 : completions;
        uint256 priceScore;

        if (budget == 0 || price == 0) {
            priceScore = 50;
        } else if (price <= budget / 2) {
            priceScore = 100;
        } else if (price <= budget) {
            priceScore = 50 + ((50 * (budget - price)) / budget);
        } else {
            priceScore = 0;
        }

        return (
            (ratingScore * weightRating) + (levelScore * weightLevel)
                + (completionScore * weightCompletions) + (priceScore * weightPrice)
        ) / 100;
    }
}
