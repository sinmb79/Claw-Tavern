// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITavernSubscription {
    function isSubscriptionActive(address client, address agent) external view returns (bool);

    function expireSubscription(uint256 subId) external;

    function pendingExpiries(uint256 limit) external view returns (uint256[] memory);
}
