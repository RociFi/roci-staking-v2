// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {MulticallUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IRociStake} from "./IRociStake.sol";

/**
 * @title RociStake
 * @author Konstantin Samarin
 * @notice Contract for staking RociToken and receiving reward in ETH or ERC20 token
 */
contract RociStake is
    IRociStake,
    Initializable,
    MulticallUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    /// @notice token to be staked
    IERC20 public stakeToken;

    /// @notice token to be rewarded
    /// in case of native asset - 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
    address public rewardToken;

    /// @notice address to receive unstaking fee
    address public treasury;

    /// @notice lock term in seconds
    uint256 public lockTerm;

    /// @notice unstaking fee in base points e.g. 100 = 1%
    uint256 public unstakingFee;

    /// @notice max amount of stake token can be staked
    uint256 public maxCapacity;

    /// @notice total amount of stake token staked for reward
    uint256 public stakedForReward;

    /// @notice total amount of reward token on pool launch
    uint256 public rewardTotalSupply;

    /// @notice user stakes
    mapping(address => Stake[]) public stakes;

    /* ========== CONSTRUCTOR ========== */

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        IERC20 _stakeToken,
        address _rewardToken,
        uint256 _lockTerm,
        uint256 _unstakingFee,
        address _treasury,
        uint256 _maxCapacity,
        uint256 _rewardTotalSupply
    ) external initializer {
        __Pausable_init();
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        stakeToken = _stakeToken;
        rewardToken = _rewardToken;
        lockTerm = _lockTerm;
        unstakingFee = _unstakingFee;
        treasury = _treasury;
        maxCapacity = _maxCapacity;
        rewardTotalSupply = _rewardTotalSupply;
        _pause();
    }

    /* ========== EXTERNAL FUNCTIONS DEFAULTS ========== */

    receive() external payable {}

    fallback() external payable {}

    /* ========== EXTERNAL VIEW FUNCTIONS ========== */

    /**
     * @dev Returns the amount of stake token remained to be staked
     */
    function getStakeAmountRemained() external view returns (uint256) {
        return maxCapacity - stakedForReward;
    }

    /**
     * @dev Returns the amount of reward token that can be received for the given amount of stake token
     */
    function getReward(uint256 amount) external view returns (uint256) {
        return _getReward(amount);
    }

    /**
     * @dev Returns the amount of fee that will be paid for the given amount of stake token
     */
    function getFee(uint256 amount) external view returns (uint256) {
        return _getFee(amount);
    }

    /**
     * @dev Returns all user stakes
     */
    function getStakes(address account) external view returns (Stake[] memory) {
        return stakes[account];
    }

    /**
     * @dev Returns stake info for all user stakes
     */
    function stakeInfos(address account) external view returns (StakeState[] memory _stakeStates) {
        Stake[] memory _stakes = stakes[account];
        _stakeStates = new StakeState[](_stakes.length);
        for (uint256 i = 0; i < _stakes.length; ) {
            _stakeStates[i] = _stakeInfo(_stakes[i]);
            unchecked {
                i++;
            }
        }
    }

    /**
     * @dev Returns stake info for the given stake index of the given account
     */
    function stakeInfo(address account, uint256 index) external view returns (StakeState memory) {
        Stake memory _stake = stakes[account][index];
        return _stakeInfo(_stake);
    }

    /* ========== EXTERNAL MUTABLE FUNCTIONS ========== */

    /* ==========  OWNER PART ========== */

    /**
     * @dev Sets lock term in seconds
     */
    function setLockTerm(uint256 _lockTerm) external whenPaused onlyOwner {
        lockTerm = _lockTerm;
    }

    /**
     * @dev Sets unstaking fee in base points e.g. 100 = 1%
     */
    function setUnstakingFee(uint256 _unstakingFee) external whenPaused onlyOwner {
        unstakingFee = _unstakingFee;
    }

    /**
     * @dev Sets max amount of stake token can be staked
     */
    function setMaxCapacity(uint256 _maxCapacity) external whenPaused onlyOwner {
        maxCapacity = _maxCapacity;
    }

    /**
     * @dev Sets treasury address
     */
    function setTreasury(address _treasury) external whenPaused onlyOwner {
        treasury = _treasury;
    }

    /**
     * @dev Sets total amount of reward token on pool launch
     */
    function setRewardTotalSupply(uint256 _rewardTotalSupply) external whenPaused onlyOwner {
        rewardTotalSupply = _rewardTotalSupply;
    }

    /**
     * @dev Sets reward token address
     */
    function setRewardToken(address _rewardToken) external whenPaused onlyOwner {
        rewardToken = _rewardToken;
    }

    /**
     * @dev Deposits reward token to the pool
     */
    function deposit(uint256 amount) external payable onlyOwner {
        if (_isNativeReward()) {
            amount = msg.value;
        }
        if (amount == 0) revert InsufficientAmount();
        if (!_isNativeReward()) {
            IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    /**
     * @dev Withdraws reward token from the pool
     */
    function withdraw(uint256 amount) external onlyOwner {
        if (amount == 0) revert InsufficientAmount();
        uint256 stakeBalance = stakeToken.balanceOf(address(this));
        if (stakeBalance > 0) revert ActiveStakes();
        _sendRewardToken(msg.sender, amount);
    }

    /**
     * @dev Pauses all stake actions
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses all stake actions
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /* ==========  USER PART ========== */

    /**
     * @dev Stakes the given amount of stake token
     */
    function stake(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert InsufficientAmount();
        if (stakedForReward + amount > maxCapacity) revert StakingMaxCapacityReached();
        stakedForReward += amount;
        stakes[msg.sender].push(Stake(amount, block.timestamp, false));
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /**
     * @dev Unstakes the stake at the given index
     * If reward is unlocked, user will get reward and stake amount
     * If reward is locked, user will get stake amount minus fee
     */
    function unstake(uint256 index) external whenNotPaused nonReentrant {
        Stake storage _stake = stakes[msg.sender][index];
        if (_stake.withdrawn) revert AlreadyUnstaked();
        _stake.withdrawn = true;
        if (_rewardUnlocked(_stake.timestamp)) {
            stakeToken.safeTransfer(msg.sender, _stake.amount);
            uint256 reward = _getReward(_stake.amount);
            _sendRewardToken(msg.sender, reward);
            emit Unstaked(msg.sender, _stake.amount, reward, 0);
        } else {
            uint256 fee = _getFee(_stake.amount);
            uint256 amount = _stake.amount - fee;
            stakedForReward -= _stake.amount;
            stakeToken.safeTransfer(treasury, fee);
            stakeToken.safeTransfer(msg.sender, amount);
            emit Unstaked(msg.sender, _stake.amount, 0, fee);
        }
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    /**
     * @dev Sends reward token to the given receiver
     */
    function _sendRewardToken(address receiver, uint256 amount) internal {
        if (_isNativeReward()) {
            bool success = payable(receiver).send(amount);
            if (!success) revert WithdrawFailed();
        } else {
            IERC20(rewardToken).safeTransfer(receiver, amount);
        }
    }

    /**
     * @dev Returns true if reward token is native asset
     */
    function _isNativeReward() internal view returns (bool) {
        return rewardToken == 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    }

    /**
     * @dev Returns true if reward is unlocked
     */
    function _rewardUnlocked(uint256 timestamp) internal view returns (bool) {
        return timestamp + lockTerm < block.timestamp;
    }

    /**
     * @dev Returns the amount of reward token that can be received for the given amount of stake token
     */
    function _getReward(uint256 amount) internal view returns (uint256) {
        return (amount * rewardTotalSupply) / maxCapacity;
    }

    /**
     * @dev Returns the amount of fee that will be paid for the given amount of stake token
     */
    function _getFee(uint256 amount) internal view returns (uint256) {
        return (amount * unstakingFee) / 10000;
    }

    /**
     * @dev Returns stake info for the given stake
     */
    function _stakeInfo(Stake memory _stake) internal view returns (StakeState memory) {
        return
            StakeState(
                !_stake.withdrawn,
                _rewardUnlocked(_stake.timestamp),
                _stake.amount,
                _stake.timestamp,
                _stake.timestamp + lockTerm,
                _getReward(_stake.amount),
                _getFee(_stake.amount)
            );
    }

    /**
     * @dev See {UUPSUpgradeable-_authorizeUpgrade}. Only owner can upgrade the contract
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner whenPaused {}
}
