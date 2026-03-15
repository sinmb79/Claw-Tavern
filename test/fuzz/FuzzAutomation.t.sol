// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../../contracts/TavernAutomationRouter.sol";

contract MockEscrowAutomation {
    struct QuestView {
        uint8 state;
        uint256 acceptedAt;
        uint256 submittedAt;
    }

    mapping(uint256 => QuestView) internal _quests;
    uint256 public nextQuestId;
    uint256 public currentFeeStage;
    uint256 public previewFeeStageValue;
    uint256 public timeoutCalls;
    uint256 public autoApproveCalls;
    uint256 public lastTimeoutQuestId;
    uint256 public lastAutoApproveQuestId;
    uint256 public feeStageChecks;

    function setNextQuestId(uint256 newNextQuestId) external {
        nextQuestId = newNextQuestId;
    }

    function setQuestView(uint256 questId, uint8 state, uint256 acceptedAt, uint256 submittedAt) external {
        _quests[questId] = QuestView({state: state, acceptedAt: acceptedAt, submittedAt: submittedAt});
    }

    function setFeeStages(uint256 currentStage, uint256 previewStage) external {
        currentFeeStage = currentStage;
        previewFeeStageValue = previewStage;
    }

    function getAutomationQuestView(uint256 questId)
        external
        view
        returns (uint8 state, uint256 acceptedAt, uint256 submittedAt)
    {
        QuestView memory quest = _quests[questId];
        return (quest.state, quest.acceptedAt, quest.submittedAt);
    }

    function executeTimeout(uint256 questId) external {
        timeoutCalls++;
        lastTimeoutQuestId = questId;
    }

    function executeAutoApprove(uint256 questId) external {
        autoApproveCalls++;
        lastAutoApproveQuestId = questId;
    }

    function checkAndUpgradeFeeStage() external returns (uint256) {
        feeStageChecks++;
        currentFeeStage = previewFeeStageValue;
        return currentFeeStage;
    }

    function previewFeeStage() external view returns (uint256) {
        return previewFeeStageValue;
    }
}

contract MockRegistryAutomation {
    uint256 public rebalanceCalls;
    uint256[6] public lastScores;

    function dailyQuotaRebalance(uint256[6] calldata todayScores) external {
        rebalanceCalls++;
        lastScores = todayScores;
    }
}

contract FuzzAutomation is Test {
    uint8 internal constant TASK_NONE = 0;
    uint8 internal constant TASK_TIMEOUT = 1;
    uint8 internal constant TASK_AUTO_APPROVE = 2;
    uint8 internal constant TASK_FEE_STAGE = 3;
    uint8 internal constant TASK_QUOTA = 4;

    MockEscrowAutomation internal escrow;
    MockRegistryAutomation internal registry;
    TavernAutomationRouter internal router;

    address internal keeper = address(0xCAFE);
    address internal outsider = address(0xDEAD);

    function setUp() public {
        vm.warp(90 days);
        escrow = new MockEscrowAutomation();
        registry = new MockRegistryAutomation();
        router = new TavernAutomationRouter(address(escrow), address(registry), address(0));
        router.grantRole(router.KEEPER_ROLE(), keeper);
    }

    function testFuzz_cursorWraparoundEmptyQuestRange(uint64 rawCursor) public {
        escrow.setNextQuestId(1);
        escrow.setQuestView(1, TASK_NONE, 0, 0);

        uint256 cursor = bound(uint256(rawCursor), 1, 1);
        router.resetScanCursor(cursor);

        (bool upkeepNeeded, bytes memory performData) = router.checkUpkeep("");
        assertFalse(upkeepNeeded);
        assertEq(performData.length, 0);
    }

    function testFuzz_cursorWraparoundSingleQuest(uint64 acceptedAgo) public {
        uint256 timeoutAge = bound(uint256(acceptedAgo), router.SUBMISSION_TIMEOUT() + 1, router.SUBMISSION_TIMEOUT() + 30 days);

        escrow.setNextQuestId(2);
        escrow.setQuestView(1, TASK_TIMEOUT + 1, block.timestamp - timeoutAge, 0);

        (bool upkeepNeeded, bytes memory performData) = router.checkUpkeep("");
        (uint8 taskType, uint256 questId) = _decode(performData);

        assertTrue(upkeepNeeded);
        assertEq(taskType, TASK_TIMEOUT);
        assertEq(questId, 1);
    }

    function testFuzz_cursorAtEndWrapsToOne(uint64 acceptedAgo) public {
        uint256 timeoutAge = bound(uint256(acceptedAgo), router.SUBMISSION_TIMEOUT() + 1, router.SUBMISSION_TIMEOUT() + 30 days);

        escrow.setNextQuestId(2);
        escrow.setQuestView(2, 2, block.timestamp - timeoutAge, 0);
        router.resetScanCursor(2);

        (, bytes memory performData) = router.checkUpkeep("");
        vm.prank(keeper);
        router.performUpkeep(performData);

        assertEq(escrow.lastTimeoutQuestId(), 2);
        assertEq(router.lastScanCursor(), 1);
    }

    function testFuzz_checkUpkeepMatchesQuestState(uint8 rawState, bool overdue) public {
        uint8 state = uint8(bound(uint256(rawState), 0, 10));
        uint256 acceptedAt = overdue ? block.timestamp - router.SUBMISSION_TIMEOUT() - 1 : block.timestamp;
        uint256 submittedAt = overdue ? block.timestamp - router.AUTO_APPROVE_DELAY() - 1 : block.timestamp;

        escrow.setNextQuestId(1);
        escrow.setQuestView(1, state, acceptedAt, submittedAt);

        (bool upkeepNeeded, bytes memory performData) = router.checkUpkeep("");

        if ((state == 2 || state == 3) && overdue) {
            (uint8 taskType, uint256 questId) = _decode(performData);
            assertTrue(upkeepNeeded);
            assertEq(taskType, TASK_TIMEOUT);
            assertEq(questId, 1);
            return;
        }

        if (state == 4 && overdue) {
            (uint8 taskType, uint256 questId) = _decode(performData);
            assertTrue(upkeepNeeded);
            assertEq(taskType, TASK_AUTO_APPROVE);
            assertEq(questId, 1);
            return;
        }

        assertFalse(upkeepNeeded);
        assertEq(performData.length, 0);
    }

    function testFuzz_taskPriorityTimeoutBeforeAllOthers(uint64 acceptedAgo, uint64 submittedAgo) public {
        uint256 timeoutAge = bound(uint256(acceptedAgo), router.SUBMISSION_TIMEOUT() + 1, router.SUBMISSION_TIMEOUT() + 7 days);
        uint256 autoApproveAge = bound(
            uint256(submittedAgo),
            router.AUTO_APPROVE_DELAY() + 1,
            router.AUTO_APPROVE_DELAY() + 7 days
        );

        escrow.setNextQuestId(2);
        escrow.setQuestView(1, 2, block.timestamp - timeoutAge, 0);
        escrow.setQuestView(2, 4, 0, block.timestamp - autoApproveAge);
        escrow.setFeeStages(0, 1);
        router.setPendingQuotaScores([uint256(10_000), 0, 0, 0, 0, 0]);
        vm.warp(block.timestamp + 2 days);

        (bool upkeepNeeded, bytes memory performData) = router.checkUpkeep("");
        (uint8 taskType, uint256 questId) = _decode(performData);

        assertTrue(upkeepNeeded);
        assertEq(taskType, TASK_TIMEOUT);
        assertEq(questId, 1);
    }

    function testFuzz_performUpkeepRequiresKeeperRole(uint256 rawParam) public {
        uint256 param = bound(rawParam, 0, 100);
        bytes memory performData = abi.encode(TavernAutomationRouter.TaskType.FeeStageCheck, param);

        vm.prank(outsider);
        vm.expectRevert("Not keeper");
        router.performUpkeep(performData);
    }

    function testFuzz_stalePendingQuotaScoresDoNotTriggerBeforeIntervalElapses(uint64 firstScore) public {
        uint256 score = bound(uint256(firstScore), 1, 10_000);
        router.setPendingQuotaScores([score, 0, 0, 0, 0, 0]);

        (bool upkeepNeeded, bytes memory performData) = router.checkUpkeep("");
        assertFalse(upkeepNeeded);
        assertEq(performData.length, 0);
    }

    function _decode(bytes memory performData) internal pure returns (uint8 taskType, uint256 questId) {
        (TavernAutomationRouter.TaskType decodedTaskType, uint256 decodedQuestId) = abi.decode(
            performData,
            (TavernAutomationRouter.TaskType, uint256)
        );
        return (uint8(decodedTaskType), decodedQuestId);
    }
}
