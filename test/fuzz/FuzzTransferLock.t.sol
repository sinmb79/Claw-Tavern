// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseFuzz.t.sol";

contract FuzzTransferLock is BaseFuzz {
    function testFuzz_CompensationTransferLockBoundary(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, 31 days);

        uint256 questId = createAcceptedUsdcQuest(250e6);
        timeoutQuest(questId, false);

        uint256 balance = token.balanceOf(client);
        assertTrue(balance > 0, "expected compensation mint");

        vm.warp(block.timestamp + elapsed);

        if (elapsed < escrow.TVRN_LOCK_DURATION()) {
            vm.expectRevert(bytes("TVRN: transfer locked (30-day compensation lock)"));
            vm.prank(client);
            token.transfer(recipient, 1);
            return;
        }

        vm.prank(client);
        assertTrue(token.transfer(recipient, 1), "transfer should succeed after unlock");
    }
}
