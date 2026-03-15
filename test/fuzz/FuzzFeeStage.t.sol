// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseFuzz.t.sol";

contract FuzzFeeStage is BaseFuzz {
    function testFuzz_FeeStageBoundaries(uint256 clientCount, uint256 agentCount) public {
        clientCount = bound(clientCount, 0, 50_000);
        agentCount = bound(agentCount, 0, 5_000);

        escrow.setActiveCounts(clientCount, agentCount);

        uint256 expectedStage = _expectedStage(clientCount, agentCount);
        assertEq(escrow.previewFeeStage(), expectedStage, "previewFeeStage mismatch");
        assertEq(escrow.checkAndUpgradeFeeStage(), expectedStage, "upgrade result mismatch");
        assertEq(escrow.currentFeeStage(), expectedStage, "stored fee stage mismatch");
    }

    function _expectedStage(uint256 clientCount, uint256 agentCount) internal pure returns (uint256) {
        if (clientCount >= 10_000 && agentCount >= 1_000) {
            return 3;
        }

        if (clientCount >= 5_000 && agentCount >= 500) {
            return 2;
        }

        if (clientCount >= 1_000 && agentCount >= 200) {
            return 1;
        }

        return 0;
    }
}
