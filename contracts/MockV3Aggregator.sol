// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockV3Aggregator {
    uint8 public immutable decimals;

    uint80 private _roundId;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;

    constructor(uint8 decimals_, int256 answer_, uint256 updatedAt_) {
        decimals = decimals_;
        _setRoundData(answer_, updatedAt_);
    }

    function setRoundData(int256 answer_, uint256 updatedAt_) external {
        _setRoundData(answer_, updatedAt_);
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

    function _setRoundData(int256 answer_, uint256 updatedAt_) internal {
        _roundId += 1;
        _answer = answer_;
        _updatedAt = updatedAt_;
        _answeredInRound = _roundId;
    }
}
