// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRociStake {
    /* ========== STRUCTS ========== */

    struct Stake {
        // amount of staked token
        uint256 amount;
        // when the stake was created
        uint256 timestamp;
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

    /* ========== EVENTS ========== */

    event Staked(address indexed account, uint256 amount);
    event Unstaked(address indexed account, uint256 amount, uint256 reward, uint256 fee);
}
