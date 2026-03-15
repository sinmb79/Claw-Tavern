// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseFuzz.t.sol";

contract FuzzCompensation is BaseFuzz {
    function testFuzz_TimedOutCompensationSharesStayDepositBounded(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1, 1_000_000) * 1e6;

        uint256 questId = createAcceptedUsdcQuest(depositAmount);
        timeoutQuest(questId, true);

        uint256 tvrnShare = (depositAmount * escrow.TIMEOUT_COMP_PCT()) / 100;
        uint256 creditShare = (depositAmount * escrow.TIMEOUT_COMP_PCT()) / 100;
        uint256 opsShare = depositAmount / 10;
        (, , uint256 previewOpsShare) = escrow.previewCompensation(questId);

        assertEq(tvrnShare + creditShare + opsShare, depositAmount, "deposit share split must stay within 100%");
        assertEq(previewOpsShare, opsShare, "preview operator share mismatch");
        assertEq(escrow.operatorPoolBalance(address(usdc)), opsShare, "operator pool mismatch");
        assertEq(
            escrow.compensationReserveBalance(address(usdc)),
            depositAmount - opsShare,
            "reserve accounting mismatch"
        );
    }
}
