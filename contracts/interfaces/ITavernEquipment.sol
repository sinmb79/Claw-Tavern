// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITavernEquipment {
    function mintLevelReward(address to, uint256 newLevel) external;

    function mintGuildReward(address to, uint256 tokenId) external;
}
