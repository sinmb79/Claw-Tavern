// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/ITavernGovernance.sol";
import "./interfaces/ITavernRegistryGovernance.sol";
import "./interfaces/ITavernToken.sol";

/**
 * @title TavernGovernance
 * @notice Phase 2 governance for proposal tracking, square-root voting, and timelocked execution.
 * @dev Phase 3 will replace balanceOf-based voting with ERC20Votes snapshots and dedicated governance roles.
 */
contract TavernGovernance is AccessControl, ReentrancyGuard, ITavernGovernance {
    uint256 public constant VOTING_PERIOD = 5 days;
    uint256 public constant TIMELOCK_DELAY = 2 days;
    uint256 public constant QUORUM_BPS = 1000;
    uint256 public constant PROPOSAL_THRESHOLD = 100e18;
    uint256 public constant FOUNDING_BONUS_BPS = 15000;
    uint256 public constant FOUNDING_BONUS_BASE = 10000;
    uint256 public constant ACTIVITY_BONUS_BPS = 12000;

    enum ProposalType {
        GuildFeeChange,
        GuildMasterChange,
        SubTokenIssuance,
        PlatformFeeChange,
        ForceDissolveGuild,
        EmergencyFreeze
    }

    enum ProposalState {
        Active,
        Defeated,
        Queued,
        Executed,
        Cancelled
    }

    struct Proposal {
        uint256 id;
        address proposer;
        ProposalType proposalType;
        bytes callData;
        address target;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        uint256 startTime;
        uint256 endTime;
        uint256 eta;
        ProposalState state;
        string description;
    }

    ITavernToken public immutable tavernToken;
    ITavernRegistryGovernance public immutable registry;

    uint256 public nextProposalId;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // Phase 3: replace balanceOf voting with ERC20Votes checkpoints at snapshotBlock.
    mapping(uint256 => uint256) public snapshotBlock;

    event ProposalCreated(
        uint256 indexed id,
        address indexed proposer,
        ProposalType proposalType,
        address target,
        string description
    );
    event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 votingPower);
    event ProposalQueued(uint256 indexed id, uint256 eta);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);
    event ProposalDefeated(uint256 indexed id, uint256 turnout, uint256 quorumRequired);

    constructor(address tavernTokenAddress, address registryAddress) {
        require(tavernTokenAddress != address(0), "Invalid token");
        require(registryAddress != address(0), "Invalid registry");

        tavernToken = ITavernToken(tavernTokenAddress);
        registry = ITavernRegistryGovernance(registryAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function getVotingPower(address voter, uint256 proposalId) public view returns (uint256) {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.proposer != address(0), "Proposal not found");
        // Phase 3 will switch this function to checkpointed voting power at snapshotBlock[proposalId].

        uint256 basePower = _sqrt(tavernToken.balanceOf(voter));
        uint256 activityBonus = registry.isAgentActive(voter) ? ACTIVITY_BONUS_BPS : FOUNDING_BONUS_BASE;
        uint256 foundingBonus = registry.isFoundingAgent(voter) ? FOUNDING_BONUS_BPS : FOUNDING_BONUS_BASE;

        return Math.mulDiv(
            basePower,
            activityBonus * foundingBonus,
            FOUNDING_BONUS_BASE * FOUNDING_BONUS_BASE
        );
    }

    function propose(
        uint8 proposalTypeValue,
        address target,
        bytes calldata callData,
        string calldata description
    ) external returns (uint256 proposalId) {
        require(proposalTypeValue <= uint8(ProposalType.EmergencyFreeze), "Invalid proposal type");
        require(target != address(0), "Invalid target");
        require(callData.length > 0, "Missing calldata");
        require(tavernToken.balanceOf(msg.sender) >= PROPOSAL_THRESHOLD, "Proposal threshold not met");

        proposalId = nextProposalId;
        unchecked {
            nextProposalId = proposalId + 1;
        }

        Proposal storage proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.proposalType = ProposalType(proposalTypeValue);
        proposal.callData = callData;
        proposal.target = target;
        proposal.startTime = block.timestamp;
        proposal.endTime = block.timestamp + VOTING_PERIOD;
        proposal.state = ProposalState.Active;
        proposal.description = description;

        snapshotBlock[proposalId] = block.number;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            ProposalType(proposalTypeValue),
            target,
            description
        );
    }

    function vote(uint256 proposalId, uint8 support) external {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.proposer != address(0), "Proposal not found");
        require(support <= 2, "Invalid support value");
        require(proposal.state == ProposalState.Active, "Proposal not active");
        require(block.timestamp <= proposal.endTime, "Voting period ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        uint256 votingPower = getVotingPower(msg.sender, proposalId);
        require(votingPower > 0, "No voting power");

        hasVoted[proposalId][msg.sender] = true;

        if (support == 0) {
            proposal.againstVotes += votingPower;
        } else if (support == 1) {
            proposal.forVotes += votingPower;
        } else {
            proposal.abstainVotes += votingPower;
        }

        emit VoteCast(proposalId, msg.sender, support, votingPower);
    }

    function queue(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.proposer != address(0), "Proposal not found");
        require(proposal.state == ProposalState.Active, "Proposal not active");
        require(block.timestamp > proposal.endTime, "Voting period not finished");

        uint256 turnout = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
        uint256 quorumRequired = quorum();
        if (turnout < quorumRequired || proposal.forVotes <= proposal.againstVotes) {
            proposal.state = ProposalState.Defeated;
            emit ProposalDefeated(proposalId, turnout, quorumRequired);
            return;
        }

        proposal.state = ProposalState.Queued;
        if (proposal.proposalType == ProposalType.EmergencyFreeze) {
            proposal.eta = block.timestamp;
        } else {
            proposal.eta = block.timestamp + TIMELOCK_DELAY;
        }

        emit ProposalQueued(proposalId, proposal.eta);
    }

    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.proposer != address(0), "Proposal not found");
        require(proposal.state == ProposalState.Queued, "Proposal not queued");
        require(block.timestamp >= proposal.eta, "Timelock not expired");

        proposal.state = ProposalState.Executed;

        // Phase 3: target contracts should grant GOVERNANCE_ROLE or onlyGovernance access to this contract.
        (bool ok, bytes memory data) = proposal.target.call(proposal.callData);
        if (!ok) {
            assembly {
                revert(add(data, 32), mload(data))
            }
        }

        emit ProposalExecuted(proposalId);
    }

    function cancel(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.proposer != address(0), "Proposal not found");
        require(msg.sender == proposal.proposer || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not authorized");
        require(
            proposal.state == ProposalState.Active || proposal.state == ProposalState.Queued,
            "Proposal cannot be cancelled"
        );

        proposal.state = ProposalState.Cancelled;
        emit ProposalCancelled(proposalId);
    }

    function proposalState(uint256 proposalId) external view returns (ProposalState) {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.proposer != address(0), "Proposal not found");

        if (proposal.state != ProposalState.Active || block.timestamp <= proposal.endTime) {
            return proposal.state;
        }

        uint256 turnout = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
        if (turnout < quorum() || proposal.forVotes <= proposal.againstVotes) {
            return ProposalState.Defeated;
        }

        return ProposalState.Active;
    }

    function quorum() public view returns (uint256) {
        uint256 totalVotingPower = _sqrt(tavernToken.totalSupply());
        return totalVotingPower * QUORUM_BPS / FOUNDING_BONUS_BASE;
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
