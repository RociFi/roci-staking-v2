import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { NATIVE_ADDRESS } from "../shared/constants";

describe("RociStake2", function () {
  async function deployNativeReward() {
    // 1 day
    const lockTerm = BigInt(24 * 60 * 60);
    // 10%
    const unstakingFee = 1000n;
    // 1000 ROCI
    const maxCapacity = ethers.parseEther("1000");

    const rewardTotalSupply = maxCapacity / 100n;

    const [owner, treasury, user1, user2] = await ethers.getSigners();

    const RociToken = await ethers.getContractFactory("RociToken", owner);
    const rociToken = await RociToken.deploy();

    const MockERC20 = await ethers.getContractFactory("MockERC20", owner);
    const mockERC20 = await MockERC20.deploy("Mock ERC20", "mERC20", 18);

    const RociStake = await ethers.getContractFactory("RociStake2");
    const rociStakeNative = await RociStake.deploy(
      owner.address,
      await rociToken.getAddress(),
      lockTerm,
      unstakingFee,
      treasury.address,
      maxCapacity,
      { value: rewardTotalSupply },
    ).then((c) => c.waitForDeployment());

    await rociToken.transfer(user1.address, ethers.parseEther("1000"));
    await rociToken.transfer(user2.address, ethers.parseEther("1000"));

    return {
      rociStakeNative,
      rociToken,
      mockERC20,
      treasury,
      owner,
      user1,
      user2,
      lockTerm,
      unstakingFee,
      maxCapacity,
    };
  }

  describe("Deployment", function () {
    it("Native", async function () {
      const {
        rociStakeNative,
        rociToken,
        treasury,
        owner,
        lockTerm,
        unstakingFee,
        maxCapacity,
      } = await loadFixture(deployNativeReward);

      // NATIVE CHECK
      expect(await rociStakeNative.owner()).to.equal(owner.address);
      expect(await rociStakeNative.stakeToken()).to.equal(
        await rociToken.getAddress(),
      );
      expect(await rociStakeNative.rewardToken()).to.equal(NATIVE_ADDRESS);
      expect(await rociStakeNative.treasury()).to.equal(treasury.address);

      expect(await rociStakeNative.lockTerm()).to.equal(lockTerm);
      expect(await rociStakeNative.unstakingFee()).to.equal(unstakingFee);
      expect(await rociStakeNative.maxCapacity()).to.equal(maxCapacity);
    });
  });

  describe("Deposit and withdrawals", async function () {
    it("Native asset", async () => {
      const { rociStakeNative, owner, user1 } = await loadFixture(
        deployNativeReward,
      );
      const amount = ethers.parseEther("10");
      await expect(
        rociStakeNative.connect(user1).withdraw(amount),
      ).to.be.revertedWithCustomError(
        rociStakeNative,
        "OwnableUnauthorizedAccount",
      );
      const withdraw = rociStakeNative.withdraw(amount);
      await expect(withdraw).to.changeEtherBalances(
        [owner, rociStakeNative],
        [amount, -amount],
      );
    });
  });

  describe("Staking", async function () {
    it("Native asset", async () => {
      const {
        rociStakeNative,
        user1,
        user2,
        maxCapacity,
        rociToken,
        treasury,
        unstakingFee,
        lockTerm,
      } = await loadFixture(deployNativeReward);
      const rewardTotalSupply = await rociStakeNative.rewardTotalSupply();
      const amount = maxCapacity / 4n;

      // nobody can stake if paused
      await expect(
        rociStakeNative.connect(user1).stake(amount),
      ).to.be.revertedWithCustomError(rociStakeNative, "EnforcedPause");

      await rociStakeNative.unpause();

      // user1 stakes -> unstakes before lockTerm -> pays unstaking fee
      {
        await rociToken
          .connect(user1)
          .approve(await rociStakeNative.getAddress(), amount);
        await expect(
          rociStakeNative.connect(user1).stake(amount),
        ).to.changeTokenBalances(
          rociToken,
          [user1, rociStakeNative],
          [-amount, amount],
        );
        expect(await rociStakeNative.getStakes(user1.address)).to.be.lengthOf(
          1,
        );
        const timestamp = await time.latest();
        expect(await rociStakeNative.stakes(user1.address, 0)).to.deep.equal([
          amount,
          timestamp,
          false,
        ]);
        const lockTerm = Number(await rociStakeNative.lockTerm());
        const rewardTotalSupply = await rociStakeNative.rewardTotalSupply();
        const unstakingWithhold = (amount * unstakingFee) / 10000n;
        {
          const stakingInfo = await rociStakeNative.stakeInfo(user1.address, 0);
          expect(stakingInfo.active).to.equal(true);
          expect(stakingInfo.unlocked).to.equal(false);
          expect(stakingInfo.amount).to.equal(amount);
          expect(stakingInfo.stakedAt).to.equal(timestamp);
          expect(stakingInfo.unlockAt).to.equal(timestamp + lockTerm);
          expect(stakingInfo.reward).to.equal(
            (amount * rewardTotalSupply) / maxCapacity,
          );
          expect(stakingInfo.fee).to.equal(unstakingWithhold);
        }

        const unstakeTx = rociStakeNative.connect(user1).unstake(0);
        await expect(unstakeTx).changeTokenBalances(
          rociToken,
          [user1, rociStakeNative, treasury],
          [amount - unstakingWithhold, -amount, unstakingWithhold],
        );
        await expect(unstakeTx).to.changeEtherBalances(
          [user1, rociStakeNative],
          [0, 0],
        );
        expect(await rociStakeNative.getStakes(user1.address)).to.be.lengthOf(
          1,
        );
        expect(await rociStakeNative.stakes(user1.address, 0)).to.deep.equal([
          amount,
          timestamp,
          true,
        ]);
        {
          const stakingInfo = await rociStakeNative.stakeInfo(user1.address, 0);
          expect(stakingInfo.active).to.equal(false);
          expect(stakingInfo.unlocked).to.equal(false);
          expect(stakingInfo.amount).to.equal(amount);
          expect(stakingInfo.stakedAt).to.equal(timestamp);
          expect(stakingInfo.unlockAt).to.equal(timestamp + lockTerm);
          expect(stakingInfo.reward).to.equal(
            (amount * rewardTotalSupply) / maxCapacity,
          );
          expect(stakingInfo.fee).to.equal(unstakingWithhold);
        }
      }

      // user1 stakes 3 times
      for (let i = 0; i < 3; i++) {
        await rociToken
          .connect(user1)
          .approve(await rociStakeNative.getAddress(), amount);
        await expect(
          rociStakeNative.connect(user1).stake(amount),
        ).to.changeTokenBalances(
          rociToken,
          [user1, rociStakeNative],
          [-amount, amount],
        );
        expect(await rociStakeNative.getStakes(user1.address)).to.be.lengthOf(
          i + 2,
        );
      }
      // user2 stakes 2 times - second is reverted because of maxCapacity
      {
        await rociToken
          .connect(user2)
          .approve(await rociStakeNative.getAddress(), amount * 2n);
        await expect(
          rociStakeNative.connect(user2).stake(amount),
        ).to.changeTokenBalances(
          rociToken,
          [user2, rociStakeNative],
          [-amount, amount],
        );
        expect(await rociStakeNative.getStakes(user2.address)).to.be.lengthOf(
          1,
        );
        await expect(
          rociStakeNative.connect(user2).stake(amount),
        ).to.be.revertedWithCustomError(
          rociStakeNative,
          "StakingMaxCapacityReached",
        );
      }

      await time.increase(lockTerm + 100n);

      // nobody can unstake if paused
      await rociStakeNative.pause();
      await expect(
        rociStakeNative.connect(user1).unstake(1),
      ).to.be.revertedWithCustomError(rociStakeNative, "EnforcedPause");
      await rociStakeNative.unpause();

      // user1 unstakes after lockTerm
      {
        const payload: string[] = [];
        for (let i = 1; i < 4; i++) {
          payload.push(
            rociStakeNative.interface.encodeFunctionData("unstake", [i]),
          );
        }
        const unstakeTx = rociStakeNative.connect(user1).multicall(payload);
        // const unstakeTx = rociStakeNative.connect(user1).unstake(1);
        await expect(unstakeTx).to.changeTokenBalances(
          rociToken,
          [user1, rociStakeNative, treasury],
          [amount * 3n, -amount * 3n, 0],
        );
        const rewardAmount = (amount * 3n * rewardTotalSupply) / maxCapacity;
        await expect(unstakeTx).to.changeEtherBalances(
          [user1, rociStakeNative],
          [rewardAmount, -rewardAmount],
        );
        expect(await rociStakeNative.getStakes(user1.address)).to.be.lengthOf(
          4,
        );
      }
      // user1 cannot unstake twice
      await expect(
        rociStakeNative.connect(user1).unstake(1),
      ).to.be.revertedWithCustomError(rociStakeNative, "AlreadyUnstaked");

      // user1 cannot stake again after unstaking because of maxCapacity
      await expect(
        rociStakeNative.connect(user1).stake(1),
      ).to.revertedWithCustomError(
        rociStakeNative,
        "StakingMaxCapacityReached",
      );

      // user2 unstakes after lockTerm
      {
        const unstakeTx = rociStakeNative.connect(user2).unstake(0);
        await expect(unstakeTx).to.changeTokenBalances(
          rociToken,
          [user2, rociStakeNative, treasury],
          [amount, -amount, 0],
        );
        const rewardAmount = (amount * rewardTotalSupply) / maxCapacity;
        await expect(unstakeTx).to.changeEtherBalances(
          [user2, rociStakeNative],
          [rewardAmount, -rewardAmount],
        );
        expect(await rociStakeNative.getStakes(user2.address)).to.be.lengthOf(
          1,
        );
      }

      expect(
        await ethers.provider.getBalance(await rociStakeNative.getAddress()),
      ).to.eq(0);
      expect(
        await rociToken.balanceOf(await rociStakeNative.getAddress()),
      ).to.eq(0);
    });
  });
});
