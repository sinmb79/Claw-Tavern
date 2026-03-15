// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./contracts/interfaces/ITavernStaking.sol";
import "./contracts/interfaces/ITavernToken.sol";

interface ITavernRegistryStatus {
    function isAgentActive(address agent) external view returns (bool);
}

contract TavernStaking is AccessControl, ReentrancyGuard, ITavernStaking {
    using SafeERC20 for IERC20;

    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    uint256 public constant STAKE_AMOUNT = 100 * 1e18;
    uint256 public constant UNSTAKE_COOLDOWN = 7 days;
    uint256 public constant SLASH_EJECTION_BPS = 5000;
    uint256 public constant SLASH_CHALLENGE_BPS = 1000;
    uint256 public constant SLASH_BPS = SLASH_EJECTION_BPS;

    ITavernToken public immutable tvrnToken;
    ITavernRegistryStatus public immutable registry;

    struct StakeInfo {
        uint256 amount;
        uint256 unstakeRequestAt;
        bool slashed;
    }

    mapping(address => StakeInfo) public stakes;

    event Staked(address indexed agent, uint256 amount);
    event UnstakeRequested(address indexed agent, uint256 unlockAt);
    event Withdrawn(address indexed agent, uint256 amount);
    event Slashed(address indexed agent, uint256 slashAmount, uint256 remaining);

    constructor(address _tvrnToken, address _registry) {
        require(_tvrnToken != address(0), "Invalid TVRN token");
        require(_registry != address(0), "Invalid registry");

        tvrnToken = ITavernToken(_tvrnToken);
        registry = ITavernRegistryStatus(_registry);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SLASHER_ROLE, msg.sender);
    }

    function stake() external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        require(info.amount == 0, "Stake already exists");
        uint256 stakeAmount = STAKE_AMOUNT;

        IERC20(address(tvrnToken)).safeTransferFrom(msg.sender, address(this), stakeAmount);

        info.amount = stakeAmount;
        info.unstakeRequestAt = 0;
        info.slashed = false;

        emit Staked(msg.sender, stakeAmount);
    }

    function requestUnstake() external {
        StakeInfo storage info = stakes[msg.sender];
        require(info.amount > 0, "No active stake");
        require(info.unstakeRequestAt == 0, "Unstake already requested");
        require(!registry.isAgentActive(msg.sender), "Agent must deactivate before unstaking");

        info.unstakeRequestAt = block.timestamp;

        emit UnstakeRequested(msg.sender, block.timestamp + UNSTAKE_COOLDOWN);
    }

    function withdraw() external nonReentrant {
        StakeInfo memory info = stakes[msg.sender];
        require(info.amount > 0, "No active stake");
        require(info.unstakeRequestAt > 0, "Unstake not requested");
        require(
            block.timestamp >= info.unstakeRequestAt + UNSTAKE_COOLDOWN,
            "Cooldown still active"
        );

        delete stakes[msg.sender];
        IERC20(address(tvrnToken)).safeTransfer(msg.sender, info.amount);

        emit Withdrawn(msg.sender, info.amount);
    }

    function slash(address agent) external onlyRole(SLASHER_ROLE) nonReentrant {
        _slash(agent, SLASH_EJECTION_BPS);
    }

    function slashEjection(address agent) external onlyRole(SLASHER_ROLE) nonReentrant {
        _slash(agent, SLASH_EJECTION_BPS);
    }

    function slashChallenge(address agent) external onlyRole(SLASHER_ROLE) nonReentrant {
        _slash(agent, SLASH_CHALLENGE_BPS);
    }

    function _slash(address agent, uint256 slashBps) internal {
        StakeInfo storage info = stakes[agent];
        require(info.amount > 0, "No active stake");
        require(!info.slashed, "Stake already slashed");

        uint256 stakedAmount = info.amount;
        uint256 slashAmount = (stakedAmount * slashBps) / 10000;
        uint256 remaining = stakedAmount - slashAmount;

        info.amount = remaining;
        info.slashed = true;
        info.unstakeRequestAt = block.timestamp;

        tvrnToken.burn(address(this), slashAmount);

        emit Slashed(agent, slashAmount, remaining);
    }

    function isStaked(address agent) external view returns (bool) {
        StakeInfo memory info = stakes[agent];
        return !info.slashed && info.amount >= STAKE_AMOUNT;
    }

    function getStakeInfo(address agent) external view returns (StakeInfo memory) {
        return stakes[agent];
    }
}
