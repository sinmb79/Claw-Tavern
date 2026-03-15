// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITavernRegistryGovernance {
    function isAgentActive(address agent) external view returns (bool);

    function isFoundingAgent(address agent) external view returns (bool);
}
