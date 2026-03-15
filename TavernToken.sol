// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TavernToken is ERC20, AccessControl {
    enum MintPool {
        Quest,
        Attendance,
        Client,
        Operation
    }

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    uint256 public constant MAX_SUPPLY = 2_100_000_000 * 1e18;
    uint256 public constant MAX_MINT_PER_EPOCH = 30_000_000 * 1e18;
    uint256 public constant DAO_REALLOC_CAP = 100_000_000 * 1e18;
    uint256 public constant MIN_ATTENDANCE_YEARLY_BUDGET = 7_000_000 * 1e18;

    uint256 public questPoolRemaining = 1_050_000_000 * 1e18;
    uint256 public attendancePoolRemaining = 210_000_000 * 1e18;
    uint256 public clientPoolRemaining = 168_000_000 * 1e18;
    uint256 public operationPoolRemaining = 672_000_000 * 1e18;

    uint256 public attendanceYearlyBudget = 60_000_000 * 1e18;
    uint256 public attendanceMintedThisYear;
    uint256 public currentYearStart;
    uint256 public halvingCount;

    uint256 public daoReallocated;
    uint256 public lastEpochStart;
    uint256 public epochMinted;
    bytes32 public emissionScheduleHash;

    mapping(address => uint256) public tvrnUnlockAt;

    event QuestMint(address indexed to, uint256 amount, string reason);
    event AttendanceMint(address indexed to, uint256 amount);
    event ClientRewardMint(address indexed to, uint256 amount, string reason);
    event OperationMint(address indexed to, uint256 amount, string reason);
    event DaoReallocation(address indexed pool, uint256 amount, uint256 totalReallocated);
    event EmissionScheduleUpdated(bytes32 oldHash, bytes32 newHash);
    event HalvingTriggered(uint256 newYearlyBudget);
    event UnlockTimeUpdated(address indexed account, uint256 unlockAt);

    constructor() ERC20("Tavern Token", "TVRN") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        currentYearStart = block.timestamp;
        lastEpochStart = block.timestamp;
    }

    modifier onlyEscrow() {
        require(hasRole(ESCROW_ROLE, msg.sender), "TavernToken: not escrow");
        _;
    }

    function questMint(address to, uint256 amount, string calldata reason) external onlyRole(MINTER_ROLE) {
        _mintFromPool(MintPool.Quest, to, amount);
        emit QuestMint(to, amount, reason);
    }

    function attendanceMint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _checkAndAdvanceYear();
        require(
            attendanceMintedThisYear + amount <= attendanceYearlyBudget,
            "Annual attendance budget exhausted"
        );

        attendanceMintedThisYear += amount;
        _mintFromPool(MintPool.Attendance, to, amount);
        emit AttendanceMint(to, amount);
    }

    function clientRewardMint(address to, uint256 amount, string calldata reason)
        external
        onlyRole(MINTER_ROLE)
    {
        _mintFromPool(MintPool.Client, to, amount);
        emit ClientRewardMint(to, amount, reason);
    }

    function operationMint(address to, uint256 amount, string calldata reason)
        external
        onlyRole(MINTER_ROLE)
    {
        _mintFromPool(MintPool.Operation, to, amount);
        emit OperationMint(to, amount, reason);
    }

    function daoReallocate(address pool, uint256 amount) external onlyRole(GOVERNANCE_ROLE) {
        require(pool != address(0), "Pool is zero");
        require(daoReallocated + amount <= DAO_REALLOC_CAP, "Cap exceeded");

        _checkEpochReset();
        require(epochMinted + amount <= MAX_MINT_PER_EPOCH, "Epoch cap exceeded");
        require(totalSupply() + amount <= MAX_SUPPLY, "Max supply exceeded");

        daoReallocated += amount;
        epochMinted += amount;
        _mint(pool, amount);

        emit DaoReallocation(pool, amount, daoReallocated);
    }

    function setEmissionScheduleHash(bytes32 newHash) external onlyRole(GOVERNANCE_ROLE) {
        bytes32 oldHash = emissionScheduleHash;
        emissionScheduleHash = newHash;
        emit EmissionScheduleUpdated(oldHash, newHash);
    }

    function burn(address from, uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(from, amount);
    }

    function setUnlockTime(address account, uint256 unlockAt) external onlyEscrow {
        if (unlockAt > tvrnUnlockAt[account]) {
            tvrnUnlockAt[account] = unlockAt;
            emit UnlockTimeUpdated(account, unlockAt);
        }
    }

    function currentAttendanceBudgetRemaining() external view returns (uint256) {
        return attendanceYearlyBudget - attendanceMintedThisYear;
    }

    function totalPoolRemaining() external view returns (uint256) {
        return questPoolRemaining + attendancePoolRemaining + clientPoolRemaining + operationPoolRemaining;
    }

    function _mintFromPool(MintPool pool, address to, uint256 amount) internal {
        require(totalSupply() + amount <= MAX_SUPPLY, "Max supply exceeded");

        if (pool == MintPool.Quest) {
            require(questPoolRemaining >= amount, "Pool exhausted");
            questPoolRemaining -= amount;
        } else if (pool == MintPool.Attendance) {
            require(attendancePoolRemaining >= amount, "Pool exhausted");
            attendancePoolRemaining -= amount;
        } else if (pool == MintPool.Client) {
            require(clientPoolRemaining >= amount, "Pool exhausted");
            clientPoolRemaining -= amount;
        } else {
            require(operationPoolRemaining >= amount, "Pool exhausted");
            operationPoolRemaining -= amount;
        }

        _mint(to, amount);
    }

    function _checkAndAdvanceYear() internal {
        if (block.timestamp >= currentYearStart + 365 days) {
            currentYearStart = block.timestamp;
            attendanceMintedThisYear = 0;
            unchecked {
                halvingCount++;
            }

            attendanceYearlyBudget = attendanceYearlyBudget / 2;
            if (attendanceYearlyBudget < MIN_ATTENDANCE_YEARLY_BUDGET) {
                attendanceYearlyBudget = MIN_ATTENDANCE_YEARLY_BUDGET;
            }

            emit HalvingTriggered(attendanceYearlyBudget);
        }
    }

    function _checkEpochReset() internal {
        if (block.timestamp >= lastEpochStart + 30 days) {
            lastEpochStart = block.timestamp;
            epochMinted = 0;
        }
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0)) {
            uint256 unlockAt = tvrnUnlockAt[from];
            require(block.timestamp >= unlockAt, "TVRN: transfer locked (30-day compensation lock)");
        }

        super._update(from, to, amount);
    }
}
