// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITavernStaking {
    function isStaked(address agent) external view returns (bool);
}
