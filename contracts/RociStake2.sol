// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title RociStake2
 * @author Konstantin Samarin
 * @notice Contract for staking RociToken and receiving reward in ETH or ERC20 token
 */
contract RociStake2 is Multicall, Pausable, Ownable {
    using SafeERC20 for IERC20;

    /* ========== STRUCTS ========== */

    struct Stake {
        // amount of staked token
        uint128 amount;
        // when the stake was created
        uint96 timestamp;
        // is stake withdrawn
        bool withdrawn;
    }

    struct StakeState {
        // not active means withdrawn
        bool active;
        // unlocked means reward is ready to be claimed
        bool unlocked;
        // amount of staked token
        uint256 amount;
        // when the stake was created
        uint256 stakedAt;
        // when the stake will be unlocked for claiming reward
        uint256 unlockAt;
        // amount of reward user will get after unlocking
        uint256 reward;
        // amount of fee user will pay in case of early unstaking
        uint256 fee;
    }

    /* ========== Errors ========== */

    error InsufficientAmount();
    error WithdrawFailed();
    error ActiveStakes();
    error StakingMaxCapacityReached();
    error AlreadyUnstaked();

    /* ========== STATE VARIABLES ========== */

    /// @notice token to be rewarded
    /// in case of native asset - 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
    address public constant rewardToken = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// @notice token to be staked
    IERC20 public immutable stakeToken;

    /// @notice unstaking fee in base points e.g. 100 = 1%
    uint256 public immutable unstakingFee;

    /// @notice max amount of stake token can be staked
    uint256 public immutable maxCapacity;

    /// @notice total amount of reward token on pool launch
    uint256 public immutable rewardTotalSupply;

    /// @notice address to receive unstaking fee
    address public immutable treasury;

    /// @notice lock term in seconds
    uint256 public immutable lockTerm;

    /// @notice total amount of stake token staked for reward
    uint256 public stakedForReward;

    /// @notice user stakes
    mapping(address => Stake[]) public stakes;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address _owner,
        IERC20 _stakeToken,
        uint96 _lockTerm,
        uint128 _unstakingFee,
        address _treasury,
        uint128 _maxCapacity
    ) payable Ownable(_owner) {
        stakeToken = _stakeToken;
        lockTerm = _lockTerm;
        unstakingFee = _unstakingFee;
        treasury = _treasury;
        maxCapacity = _maxCapacity;
        rewardTotalSupply = msg.value;
        _pause();
    }

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
    function getReward(uint128 amount) external view returns (uint256) {
        return _getReward(amount);
    }

    /**
     * @dev Returns the amount of fee that will be paid for the given amount of stake token
     */
    function getFee(uint128 amount) external view returns (uint256) {
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
        for (uint256 i = 0; i < _stakes.length; i++) {
            _stakeStates[i] = _stakeInfo(_stakes[i]);
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
     * @dev Withdraws reward token from the pool
     */
    function withdraw(uint256 amount) external onlyOwner {
        if (amount == 0) revert InsufficientAmount();
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
    function stake(uint256 amount) external whenNotPaused {
        if (amount == 0) revert InsufficientAmount();
        unchecked {
            stakedForReward += amount;
            if (stakedForReward > maxCapacity) revert StakingMaxCapacityReached();
        }
        stakes[msg.sender].push(Stake(uint128(amount), uint96(block.timestamp), false));
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @dev Unstakes the stake at the given index
     * If reward is unlocked, user will get reward and stake amount
     * If reward is locked, user will get stake amount minus fee
     */
    function unstake(uint256 index) external whenNotPaused {
        Stake memory _stake = stakes[msg.sender][index];
        if (_stake.withdrawn) revert AlreadyUnstaked();
        stakes[msg.sender][index].withdrawn = true;
        if (_rewardUnlocked(_stake.timestamp)) {
            stakeToken.safeTransfer(msg.sender, _stake.amount);
            uint256 reward = _getReward(_stake.amount);
            _sendRewardToken(msg.sender, reward);
        } else {
            uint256 fee = _getFee(_stake.amount);
            uint256 amount = _stake.amount - fee;
            stakedForReward -= _stake.amount;
            stakeToken.safeTransfer(treasury, fee);
            stakeToken.safeTransfer(msg.sender, amount);
        }
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    /**
     * @dev Sends reward token to the given receiver
     */
    function _sendRewardToken(address receiver, uint256 amount) internal {
        (bool success, ) = payable(receiver).call{value: amount}("");
        if (!success) revert WithdrawFailed();
    }

    /**
     * @dev Returns true if reward is unlocked
     */
    function _rewardUnlocked(uint256 timestamp) internal view returns (bool) {
        unchecked {
            return timestamp + lockTerm < block.timestamp;
        }
    }

    /**
     * @dev Returns the amount of reward token that can be received for the given amount of stake token
     */
    function _getReward(uint256 amount) internal view returns (uint256) {
        unchecked {
            return (amount * rewardTotalSupply) / maxCapacity;
        }
    }

    /**
     * @dev Returns the amount of fee that will be paid for the given amount of stake token
     */
    function _getFee(uint256 amount) internal view returns (uint256) {
        unchecked {
            return (amount * unstakingFee) / 10000;
        }
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
}
