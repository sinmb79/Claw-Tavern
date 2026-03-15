// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AdminPriceFeed
 * @notice Owner-managed TVRN / USD price feed with Chainlink AggregatorV3Interface compatibility.
 * @dev TavernEscrow rejects stale prices older than 1 hour. The owner must call
 * `updatePrice()` or `refreshPrice()` at least once within that window during active settlement periods.
 */
contract AdminPriceFeed is AggregatorV3Interface, Ownable {
    uint8 private constant FEED_DECIMALS = 8;
    string private constant FEED_DESCRIPTION = "TVRN / USD";
    uint256 private constant FEED_VERSION = 1;

    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    mapping(uint80 => Round) private rounds;
    uint80 private latestRoundId;
    mapping(address => bool) public isRefresher;

    event PriceUpdated(uint80 indexed roundId, int256 price, uint256 updatedAt);
    event RefresherUpdated(address indexed addr, bool enabled);

    error InvalidPrice();

    constructor(int256 initialPrice) Ownable(msg.sender) {
        _recordPrice(initialPrice);
    }

    function decimals() external pure override returns (uint8) {
        return FEED_DECIMALS;
    }

    function description() external pure override returns (string memory) {
        return FEED_DESCRIPTION;
    }

    function version() external pure override returns (uint256) {
        return FEED_VERSION;
    }

    function getRoundData(uint80 roundId)
        external
        view
        override
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return _roundTuple(roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return _roundTuple(latestRoundId);
    }

    function updatePrice(int256 price) external onlyOwner {
        _recordPrice(price);
    }

    function setRefresher(address addr, bool enabled) external onlyOwner {
        isRefresher[addr] = enabled;
        emit RefresherUpdated(addr, enabled);
    }

    function refreshPrice() external {
        require(msg.sender == owner() || isRefresher[msg.sender], "Not authorized");
        _recordPrice(rounds[latestRoundId].answer);
    }

    function _recordPrice(int256 price) internal {
        if (price <= 0) {
            revert InvalidPrice();
        }

        unchecked {
            ++latestRoundId;
        }

        uint256 timestamp = block.timestamp;
        rounds[latestRoundId] = Round({
            answer: price,
            startedAt: timestamp,
            updatedAt: timestamp,
            answeredInRound: latestRoundId
        });

        emit PriceUpdated(latestRoundId, price, timestamp);
    }

    function _roundTuple(uint80 roundId)
        internal
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        Round memory round = rounds[roundId];
        if (round.updatedAt == 0) {
            revert("No data present");
        }

        return (
            roundId,
            round.answer,
            round.startedAt,
            round.updatedAt,
            round.answeredInRound
        );
    }
}
