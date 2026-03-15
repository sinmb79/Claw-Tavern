// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../../contracts/MockUSDC.sol";
import "../../TavernEscrow.sol";
import "../../TavernRegistry.sol";
import "../../TavernToken.sol";

contract FlexibleMockV3Aggregator {
    uint8 public immutable decimals;

    uint80 private _roundId;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;

    constructor(uint8 decimals_, int256 answer_, uint256 updatedAt_) {
        decimals = decimals_;
        setRoundData(1, answer_, updatedAt_, 1);
    }

    function setRoundData(uint80 roundId_, int256 answer_, uint256 updatedAt_, uint80 answeredInRound_) public {
        _roundId = roundId_;
        _answer = answer_;
        _updatedAt = updatedAt_;
        _answeredInRound = answeredInRound_;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, _answer, _updatedAt, _updatedAt, _answeredInRound);
    }
}

contract TavernEscrowHarness is TavernEscrow {
    constructor(
        address usdc_,
        address tavernToken_,
        address registry_,
        address ethUsdFeed_,
        address tvrnUsdFeed_
    ) TavernEscrow(usdc_, tavernToken_, registry_, ethUsdFeed_, tvrnUsdFeed_) {}

    function exposedGetCheckedPrice(address feed) external view returns (uint256) {
        return _getCheckedPrice(feed);
    }

    function setActiveCounts(uint256 clients, uint256 agents) external {
        activeClientCount = clients;
        activeAgentCount = agents;
    }
}

abstract contract BaseFuzz is Test {
    MockUSDC internal usdc;
    FlexibleMockV3Aggregator internal ethUsdFeed;
    FlexibleMockV3Aggregator internal tvrnUsdFeed;
    TavernToken internal token;
    TavernRegistry internal registry;
    TavernEscrowHarness internal escrow;

    address internal client = address(0x1001);
    address internal agent = address(0x1002);
    address internal keeper = address(0x1003);
    address internal recipient = address(0x1004);

    function setUp() public virtual {
        vm.warp(30 days);

        usdc = new MockUSDC();
        ethUsdFeed = new FlexibleMockV3Aggregator(8, 2_000e8, block.timestamp);
        tvrnUsdFeed = new FlexibleMockV3Aggregator(8, 1e8, block.timestamp);
        token = new TavernToken();
        registry = new TavernRegistry(address(token));
        escrow = new TavernEscrowHarness(
            address(usdc),
            address(token),
            address(registry),
            address(ethUsdFeed),
            address(tvrnUsdFeed)
        );

        token.grantRole(token.MINTER_ROLE(), address(escrow));
        token.grantRole(token.ESCROW_ROLE(), address(escrow));
        registry.grantRole(registry.ARBITER_ROLE(), address(escrow));
        registry.grantRole(registry.KEEPER_ROLE(), keeper);
        escrow.grantRole(escrow.KEEPER_ROLE(), keeper);
        escrow.setMaxQuestDepositUsdc(1_000_000e6);
        escrow.setMaxQuestDeposit(1_000_000 ether);

        usdc.transfer(client, 10_000_000e6);
    }

    function createAcceptedUsdcQuest(uint256 depositAmount) internal returns (uint256 questId) {
        vm.startPrank(client);
        escrow.createQuest(address(usdc), depositAmount, keccak256("brief"), "ipfs://brief");
        questId = escrow.nextQuestId();
        usdc.approve(address(escrow), depositAmount);
        escrow.fundQuestUSDC(questId);
        vm.stopPrank();

        vm.prank(agent);
        escrow.acceptQuest(questId);
    }

    function timeoutQuest(uint256 questId, bool withHeartbeat) internal {
        if (withHeartbeat) {
            vm.prank(agent);
            escrow.recordHeartbeat(questId);
        }

        vm.warp(block.timestamp + escrow.SUBMISSION_TIMEOUT() + 1);
        tvrnUsdFeed.setRoundData(1, 1e8, block.timestamp, 1);
        ethUsdFeed.setRoundData(1, 2_000e8, block.timestamp, 1);

        vm.prank(keeper);
        escrow.executeTimeout(questId);
    }

    function snapshotQuotas() internal view returns (uint256[6] memory quotas) {
        for (uint256 i = 0; i < 6; i++) {
            quotas[i] = registry.jobQuota(i);
        }
    }

    function sumQuotas(uint256[6] memory quotas) internal pure returns (uint256 total) {
        for (uint256 i = 0; i < quotas.length; i++) {
            total += quotas[i];
        }
    }

    function arraysEqual(uint256[6] memory a, uint256[6] memory b) internal pure returns (bool equal) {
        equal = true;
        for (uint256 i = 0; i < a.length; i++) {
            if (a[i] != b[i]) {
                return false;
            }
        }
    }

    function toUint256Array(uint64[6] memory rawScores) internal pure returns (uint256[6] memory scores) {
        for (uint256 i = 0; i < rawScores.length; i++) {
            scores[i] = uint256(rawScores[i]);
        }
    }

    function absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }
}
