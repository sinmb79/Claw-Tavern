// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../../contracts/TavernGovernance.sol";
import "../../contracts/interfaces/ITavernToken.sol";
import "../../contracts/interfaces/ITavernRegistryGovernance.sol";

contract MockVotingToken is ITavernToken {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    function setBalance(address account, uint256 amount) external {
        _balances[account] = amount;
    }

    function setTotalSupply(uint256 amount) external {
        _totalSupply = amount;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "allowance");

        unchecked {
            _allowances[from][msg.sender] = currentAllowance - amount;
        }

        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function burn(address from, uint256 amount) external {
        _balances[from] -= amount;
        _totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}

contract MockGovernanceRegistry is ITavernRegistryGovernance {
    mapping(address => bool) private _active;
    mapping(address => bool) private _founding;

    function setActive(address agent, bool active_) external {
        _active[agent] = active_;
    }

    function setFounding(address agent, bool founding_) external {
        _founding[agent] = founding_;
    }

    function isAgentActive(address agent) external view returns (bool) {
        return _active[agent];
    }

    function isFoundingAgent(address agent) external view returns (bool) {
        return _founding[agent];
    }
}

contract FuzzGovernance is Test {
    uint256 internal constant PROPOSAL_THRESHOLD = 100e18;
    uint256 internal constant VOTING_PERIOD = 5 days;
    uint256 internal constant TIMELOCK_DELAY = 2 days;

    MockVotingToken internal token;
    MockGovernanceRegistry internal registry;
    TavernGovernance internal governance;

    address internal proposer = address(0xAA01);
    address internal vanillaHolder = address(0xAA02);
    address internal activeHolder = address(0xAA03);
    address internal foundingHolder = address(0xAA04);

    function setUp() public {
        token = new MockVotingToken();
        registry = new MockGovernanceRegistry();
        governance = new TavernGovernance(address(token), address(registry));
    }

    function testFuzz_getVotingPowerEqualsSqrtForVanilla(uint256 balance) public {
        uint256 boundedBalance = bound(balance, 0, type(uint256).max / 2);
        uint256 proposalId = _createProposal(uint8(TavernGovernance.ProposalType.GuildFeeChange));

        token.setBalance(vanillaHolder, boundedBalance);
        token.setTotalSupply(boundedBalance + PROPOSAL_THRESHOLD);

        assertEq(governance.getVotingPower(vanillaHolder, proposalId), _sqrt(boundedBalance));
    }

    function testFuzz_getVotingPowerEqualsSqrtTimesActivityBonus(uint256 balance) public {
        uint256 boundedBalance = bound(balance, 1, type(uint256).max / 2);
        uint256 proposalId = _createProposal(uint8(TavernGovernance.ProposalType.GuildFeeChange));

        token.setBalance(activeHolder, boundedBalance);
        token.setTotalSupply(boundedBalance + PROPOSAL_THRESHOLD);
        registry.setActive(activeHolder, true);

        uint256 expected = ( _sqrt(boundedBalance) * 12_000 ) / 10_000;
        assertEq(governance.getVotingPower(activeHolder, proposalId), expected);
    }

    function testFuzz_getVotingPowerEqualsSqrtTimesFoundingBonus(uint256 balance) public {
        uint256 boundedBalance = bound(balance, 1, type(uint256).max / 2);
        uint256 proposalId = _createProposal(uint8(TavernGovernance.ProposalType.GuildFeeChange));

        token.setBalance(foundingHolder, boundedBalance);
        token.setTotalSupply(boundedBalance + PROPOSAL_THRESHOLD);
        registry.setFounding(foundingHolder, true);

        uint256 expected = (_sqrt(boundedBalance) * 15_000) / 10_000;
        assertEq(governance.getVotingPower(foundingHolder, proposalId), expected);
    }

    function testFuzz_votingPowerZeroAndOneBoundaries(bool useOne) public {
        uint256 proposalId = _createProposal(uint8(TavernGovernance.ProposalType.GuildFeeChange));
        uint256 balance = useOne ? 1 : 0;

        token.setBalance(vanillaHolder, balance);
        token.setTotalSupply(PROPOSAL_THRESHOLD + balance);

        assertEq(governance.getVotingPower(vanillaHolder, proposalId), balance);
    }

    function testFuzz_votingPowerLargeBalancesDoNotOverflow(uint256 rawBalance) public {
        uint256 boundedBalance = bound(rawBalance, type(uint256).max / 4, type(uint256).max / 2);
        uint256 proposalId = _createProposal(uint8(TavernGovernance.ProposalType.GuildFeeChange));

        token.setBalance(vanillaHolder, boundedBalance);
        token.setTotalSupply(boundedBalance);

        uint256 power = governance.getVotingPower(vanillaHolder, proposalId);
        assertEq(power, _sqrt(boundedBalance));
        assertTrue(power > 0);
    }

    function testFuzz_proposalThresholdBoundary(uint96 dust) public {
        uint256 boundedDust = bound(uint256(dust), 1, 1e18);
        uint256 threshold = PROPOSAL_THRESHOLD;

        token.setBalance(proposer, threshold - boundedDust);
        token.setTotalSupply(threshold);
        vm.prank(proposer);
        vm.expectRevert("Proposal threshold not met");
        governance.propose(
            uint8(TavernGovernance.ProposalType.GuildFeeChange),
            address(this),
            hex"01",
            "below-threshold"
        );

        token.setBalance(proposer, threshold);
        token.setTotalSupply(threshold);
        vm.prank(proposer);
        uint256 proposalId = governance.propose(
            uint8(TavernGovernance.ProposalType.GuildFeeChange),
            address(this),
            hex"01",
            "at-threshold"
        );

        assertEq(proposalId, 0);
    }

    function testFuzz_queueTimingNormalProposal(uint64 totalSupplyExtra) public {
        uint256 proposalId = _createProposal(uint8(TavernGovernance.ProposalType.PlatformFeeChange));
        uint256 totalSupply = PROPOSAL_THRESHOLD + bound(uint256(totalSupplyExtra), 0, 1_000_000 ether);
        token.setTotalSupply(totalSupply);

        vm.prank(proposer);
        governance.vote(proposalId, 1);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        uint256 queuedAt = block.timestamp;
        governance.queue(proposalId);

        (,,,,,,,,,, uint256 eta,,) = governance.proposals(proposalId);
        assertTrue(eta >= queuedAt + TIMELOCK_DELAY);
    }

    function testFuzz_queueTimingEmergencyFreeze(uint64 totalSupplyExtra) public {
        uint256 proposalId = _createProposal(uint8(TavernGovernance.ProposalType.EmergencyFreeze));
        uint256 totalSupply = PROPOSAL_THRESHOLD + bound(uint256(totalSupplyExtra), 0, 1_000_000 ether);
        token.setTotalSupply(totalSupply);

        vm.prank(proposer);
        governance.vote(proposalId, 1);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        uint256 queuedAt = block.timestamp;
        governance.queue(proposalId);

        (,,,,,,,,,, uint256 eta,,) = governance.proposals(proposalId);
        assertTrue(eta <= queuedAt);
    }

    function testFuzz_voteTallyMixedVotersSumsCorrectly(
        uint128 vanillaBalance,
        uint128 activeBalance,
        uint128 foundingBalance
    ) public {
        uint256 vanillaAmount = bound(uint256(vanillaBalance), 1 ether, 1_000_000 ether);
        uint256 activeAmount = bound(uint256(activeBalance), 1 ether, 1_000_000 ether);
        uint256 foundingAmount = bound(uint256(foundingBalance), 1 ether, 1_000_000 ether);
        uint256 proposalId = _createProposal(uint8(TavernGovernance.ProposalType.GuildMasterChange));

        token.setBalance(vanillaHolder, vanillaAmount);
        token.setBalance(activeHolder, activeAmount);
        token.setBalance(foundingHolder, foundingAmount);
        token.setTotalSupply(
            PROPOSAL_THRESHOLD + vanillaAmount + activeAmount + foundingAmount
        );

        registry.setActive(activeHolder, true);
        registry.setFounding(foundingHolder, true);

        uint256 vanillaPower = _sqrt(vanillaAmount);
        uint256 activePower = (_sqrt(activeAmount) * 12_000) / 10_000;
        uint256 foundingPower = (_sqrt(foundingAmount) * 15_000) / 10_000;

        vm.prank(vanillaHolder);
        governance.vote(proposalId, 1);
        vm.prank(activeHolder);
        governance.vote(proposalId, 0);
        vm.prank(foundingHolder);
        governance.vote(proposalId, 2);

        (,,,,, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes,,,,,) = governance.proposals(proposalId);
        assertEq(forVotes, vanillaPower);
        assertEq(againstVotes, activePower);
        assertEq(abstainVotes, foundingPower);
    }

    function _createProposal(uint8 proposalTypeValue) internal returns (uint256 proposalId) {
        uint256 threshold = PROPOSAL_THRESHOLD;
        token.setBalance(proposer, threshold);
        token.setTotalSupply(threshold);

        vm.prank(proposer);
        proposalId = governance.propose(proposalTypeValue, address(this), hex"01", "test-proposal");
    }

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) {
            return 0;
        }

        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }

        return y;
    }
}
