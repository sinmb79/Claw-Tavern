// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC8004ReputationRegistry {
    function getIdentityRegistry() external view returns (address);

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}
