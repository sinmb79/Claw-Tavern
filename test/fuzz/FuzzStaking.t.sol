// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseFuzz.t.sol";
import "../../TavernStaking.sol";

contract TavernStakingHarness is TavernStaking {
    constructor(address tokenAddress, address registryAddress) TavernStaking(tokenAddress, registryAddress) {}

    function setStakeInfo(address agent, uint256 amount, uint256 unstakeRequestAt, bool slashed) external {
        stakes[agent] = StakeInfo({amount: amount, unstakeRequestAt: unstakeRequestAt, slashed: slashed});
    }
}

contract FuzzStaking is BaseFuzz {
    TavernStakingHarness internal staking;

    address internal worker = address(0xB0B);
    address internal slasher = address(0x5151);

    function setUp() public override {
        super.setUp();

        staking = new TavernStakingHarness(address(token), address(registry));
        token.grantRole(token.MINTER_ROLE(), address(this));
        token.grantRole(token.BURNER_ROLE(), address(staking));
        registry.setStakingContract(address(staking));

        token.operationMint(address(this), 20_000 ether, "fuzz-funding");
        token.transfer(worker, 10_000 ether);
        staking.grantRole(staking.SLASHER_ROLE(), slasher);
    }

    function testFuzz_stakeRequiresExactBond(uint256 balanceAmount, uint256 approvalAmount) public {
        uint256 stakeAmount = staking.STAKE_AMOUNT();
        uint256 fundedBalance = bound(balanceAmount, 0, 200 ether);
        uint256 fundedApproval = bound(approvalAmount, 0, 200 ether);

        vm.prank(address(this));
        token.transfer(recipient, fundedBalance);

        vm.startPrank(recipient);
        token.approve(address(staking), fundedApproval);
        if (fundedBalance >= stakeAmount && fundedApproval >= stakeAmount) {
            staking.stake();
            TavernStaking.StakeInfo memory stakeInfo = staking.getStakeInfo(recipient);
            assertEq(stakeInfo.amount, stakeAmount);
            assertFalse(stakeInfo.slashed);
        } else {
            vm.expectRevert();
            staking.stake();
        }
        vm.stopPrank();
    }

    function testFuzz_isStakedReflectsAmountAndSlash(uint256 amount, bool slashedFlag) public {
        uint256 boundedAmount = bound(amount, 0, 200 ether);
        staking.setStakeInfo(worker, boundedAmount, 0, slashedFlag);

        bool expected = !slashedFlag && boundedAmount >= staking.STAKE_AMOUNT();
        assertTrue(staking.isStaked(worker) == expected);
    }

    function testFuzz_requestUnstakeDoesNotResetTimestamp(uint64 delaySeconds) public {
        _stake(worker);

        vm.prank(worker);
        staking.requestUnstake();

        TavernStaking.StakeInfo memory requestedStake = staking.getStakeInfo(worker);
        assertEq(requestedStake.amount, staking.STAKE_AMOUNT());
        assertFalse(requestedStake.slashed);

        vm.warp(block.timestamp + bound(uint256(delaySeconds), 1, 3 days));

        vm.prank(worker);
        vm.expectRevert("Unstake already requested");
        staking.requestUnstake();

        TavernStaking.StakeInfo memory requestedStakeAfter = staking.getStakeInfo(worker);
        assertEq(requestedStakeAfter.unstakeRequestAt, requestedStake.unstakeRequestAt);
    }

    function testFuzz_withdrawCooldownBoundary(uint64 extraDelay) public {
        _stake(worker);

        vm.prank(worker);
        staking.requestUnstake();

        TavernStaking.StakeInfo memory stakeAfterRequest = staking.getStakeInfo(worker);
        uint256 cooldown = staking.UNSTAKE_COOLDOWN();
        uint256 boundedExtraDelay = bound(uint256(extraDelay), 0, 3 days);

        vm.warp(stakeAfterRequest.unstakeRequestAt + cooldown - 1);
        vm.prank(worker);
        vm.expectRevert("Cooldown still active");
        staking.withdraw();

        uint256 workerBalanceBefore = token.balanceOf(worker);
        vm.warp(stakeAfterRequest.unstakeRequestAt + cooldown + boundedExtraDelay);
        vm.prank(worker);
        staking.withdraw();

        assertEq(token.balanceOf(worker), workerBalanceBefore + staking.STAKE_AMOUNT());
        TavernStaking.StakeInfo memory withdrawnStake = staking.getStakeInfo(worker);
        assertEq(withdrawnStake.amount, 0);
        assertEq(withdrawnStake.unstakeRequestAt, 0);
        assertFalse(withdrawnStake.slashed);
    }

    function testFuzz_slashBurnsHalfBond(uint64 delaySeconds) public {
        _stake(worker);
        vm.warp(block.timestamp + bound(uint256(delaySeconds), 0, 7 days));

        uint256 stakingBalanceBefore = token.balanceOf(address(staking));
        uint256 supplyBefore = token.totalSupply();

        vm.prank(slasher);
        staking.slash(worker);

        uint256 expectedSlash = staking.STAKE_AMOUNT() / 2;
        assertEq(token.balanceOf(address(staking)), stakingBalanceBefore - expectedSlash);
        assertEq(token.totalSupply(), supplyBefore - expectedSlash);

        TavernStaking.StakeInfo memory slashedStake = staking.getStakeInfo(worker);
        assertEq(slashedStake.amount, staking.STAKE_AMOUNT() - expectedSlash);
        assertTrue(slashedStake.slashed);
    }

    function testFuzz_slashSetsUnstakeRequestAtImmediately(uint64 delaySeconds) public {
        _stake(worker);
        vm.warp(block.timestamp + bound(uint256(delaySeconds), 0, 7 days));
        uint256 slashAt = block.timestamp;

        vm.prank(slasher);
        staking.slash(worker);

        TavernStaking.StakeInfo memory slashInfo = staking.getStakeInfo(worker);
        assertEq(slashInfo.unstakeRequestAt, slashAt);
        assertTrue(slashInfo.slashed);
    }

    function testFuzz_slashWithdrawTimingInteraction(uint64 delaySeconds) public {
        _stake(worker);

        vm.prank(slasher);
        staking.slash(worker);

        TavernStaking.StakeInfo memory postSlashStake = staking.getStakeInfo(worker);
        uint256 cooldown = staking.UNSTAKE_COOLDOWN();
        uint256 boundedDelay = bound(uint256(delaySeconds), 0, 2 days);

        vm.warp(postSlashStake.unstakeRequestAt + cooldown - 1);
        vm.prank(worker);
        vm.expectRevert("Cooldown still active");
        staking.withdraw();

        uint256 workerBalanceBefore = token.balanceOf(worker);
        vm.warp(postSlashStake.unstakeRequestAt + cooldown + boundedDelay);
        vm.prank(worker);
        staking.withdraw();

        assertEq(token.balanceOf(worker), workerBalanceBefore + (staking.STAKE_AMOUNT() / 2));
    }

    function testFuzz_slashBeforeVsAfterRequest(uint64 delaySeconds, bool requestFirst) public {
        _stake(worker);

        uint256 firstRequestAt = 0;
        if (requestFirst) {
            vm.prank(worker);
            staking.requestUnstake();
            TavernStaking.StakeInfo memory requestedBeforeSlash = staking.getStakeInfo(worker);
            firstRequestAt = requestedBeforeSlash.unstakeRequestAt;
        }

        vm.warp(block.timestamp + bound(uint256(delaySeconds), 0, 7 days));
        uint256 slashAt = block.timestamp;

        vm.prank(slasher);
        staking.slash(worker);

        TavernStaking.StakeInfo memory finalStake = staking.getStakeInfo(worker);
        assertEq(finalStake.amount, staking.STAKE_AMOUNT() / 2);
        assertEq(finalStake.unstakeRequestAt, slashAt);
        assertTrue(finalStake.slashed);

        if (requestFirst && slashAt >= firstRequestAt) {
            assertTrue(finalStake.unstakeRequestAt >= firstRequestAt);
        }
    }

    function _stake(address staker) internal {
        vm.startPrank(staker);
        token.approve(address(staking), staking.STAKE_AMOUNT());
        staking.stake();
        vm.stopPrank();
    }
}
