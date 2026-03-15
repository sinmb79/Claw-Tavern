// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITavernGovernance {
    function getVotingPower(address voter, uint256 proposalId) external view returns (uint256);

    function propose(
        uint8 proposalType,
        address target,
        bytes calldata callData,
        string calldata description
    ) external returns (uint256);

    function vote(uint256 proposalId, uint8 support) external;

    function queue(uint256 proposalId) external;

    function execute(uint256 proposalId) external;
}
