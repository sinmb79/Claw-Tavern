// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITavernClientRPG {
    function MAX_LEVEL() external view returns (uint256);

    function clientClaimable(address client) external view returns (uint256);

    function checkWithdrawalEligible(address client, uint256 amount)
        external
        view
        returns (bool eligible, string memory reason);

    function accumulateReward(address client, uint256 amount, uint8 rewardKind) external;

    function recordWithdrawal(address client, uint256 amount) external;

    function registerClient(address client) external;

    function grantJobCompleteEXP(address client) external;

    function grantEvalEXP(address client) external;

    function grantReferralEXP(address client) external;

    function grantSubscriptionEXP(address client) external;

    function withdrawFor(address client, uint256 amount) external;

    function levelThreshold(uint256 level) external view returns (uint256);
}
