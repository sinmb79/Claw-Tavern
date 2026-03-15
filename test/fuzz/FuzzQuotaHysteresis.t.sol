// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseFuzz.t.sol";

contract FuzzQuotaHysteresis is BaseFuzz {
    bytes32 private constant QUOTA_REBALANCED_TOPIC = keccak256("QuotaRebalanced(uint256[6],uint256)");

    function testFuzz_QuotaRebalanceHonorsHysteresis(uint64[6] memory rawScores) public {
        uint256[6] memory scores = toUint256Array(rawScores);
        uint256[6] memory before = snapshotQuotas();
        bool expectedRebalance = _expectedRebalance(scores, before);

        vm.recordLogs();
        vm.prank(keeper);
        registry.dailyQuotaRebalance(scores);

        bool emitted = _sawQuotaRebalanced();
        uint256[6] memory updatedQuotas = snapshotQuotas();

        if (!expectedRebalance) {
            assertFalse(emitted, "rebalance event must not emit below hysteresis");
            assertTrue(arraysEqual(updatedQuotas, before), "quotas must remain unchanged below hysteresis");
            return;
        }

        assertTrue(emitted, "rebalance event must emit when any delta crosses hysteresis");
        assertEq(sumQuotas(updatedQuotas), 10_000, "rebalanced quotas must normalize to 100%");
    }

    function _expectedRebalance(uint256[6] memory scores, uint256[6] memory before) internal view returns (bool) {
        uint256 total;
        for (uint256 i = 0; i < scores.length; i++) {
            total += scores[i];
        }

        if (total == 0) {
            return false;
        }

        for (uint256 i = 0; i < scores.length; i++) {
            uint256 ideal = (scores[i] * 10_000) / total;
            uint256 prev = before[i];
            uint256 deltaCap = (prev * registry.MAX_DAILY_CHANGE()) / 10_000;
            uint256 maxUp = prev + deltaCap;
            uint256 maxDown = prev > deltaCap ? prev - deltaCap : registry.MIN_QUOTA();

            uint256 bounded = ideal;
            if (bounded > maxUp) {
                bounded = maxUp;
            } else if (bounded < maxDown) {
                bounded = maxDown;
            }

            if (bounded < registry.MIN_QUOTA()) {
                bounded = registry.MIN_QUOTA();
            }

            if (absDiff(bounded, prev) >= registry.HYSTERESIS_BPS()) {
                return true;
            }
        }

        return false;
    }

    function _sawQuotaRebalanced() internal returns (bool emitted) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == QUOTA_REBALANCED_TOPIC) {
                return true;
            }
        }
        return false;
    }
}
