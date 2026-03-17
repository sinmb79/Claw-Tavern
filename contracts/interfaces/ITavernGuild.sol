// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITavernGuild {
    function GUILD_COUNT() external view returns (uint8);

    function addMember(uint8 guildId, address member) external;

    function isInGuild(address member, uint8 guildId) external view returns (bool);

    function recordGuildCompletion(address agent, uint8 guildId, uint256 volume) external;

    function recordRating(address agent, uint8 guildId, uint256 rating) external;

    function getMemberGuilds(address member) external view returns (uint8[] memory);

    function memberGuild(address member) external view returns (uint8);

    function getAverageRating(uint8 guildId, address member) external view returns (uint256);

    function needsMaintenance() external view returns (bool);

    function performMaintenance() external;
}
