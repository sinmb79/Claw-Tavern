// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseFuzz.t.sol";

contract FuzzOracleEdge is BaseFuzz {
    function testFuzz_OracleRejectsInvalidRoundMetadata(
        int256 price,
        uint256 updatedAt,
        uint80 roundId,
        uint80 answeredInRound
    ) public {
        uint256 boundedUpdatedAt = bound(updatedAt, 0, block.timestamp + 2 days);
        tvrnUsdFeed.setRoundData(roundId, price, boundedUpdatedAt, answeredInRound);

        if (price <= 0) {
            vm.expectRevert(abi.encodeWithSelector(OracleInvalidPrice.selector));
            escrow.exposedGetCheckedPrice(address(tvrnUsdFeed));
            return;
        }

        if (boundedUpdatedAt <= block.timestamp - escrow.ORACLE_STALENESS()) {
            vm.expectRevert(abi.encodeWithSelector(OracleStalePrice.selector));
            escrow.exposedGetCheckedPrice(address(tvrnUsdFeed));
            return;
        }

        if (answeredInRound < roundId) {
            vm.expectRevert(abi.encodeWithSelector(OracleIncompleteRound.selector));
            escrow.exposedGetCheckedPrice(address(tvrnUsdFeed));
            return;
        }

        assertEq(escrow.exposedGetCheckedPrice(address(tvrnUsdFeed)), uint256(price));
    }
}
