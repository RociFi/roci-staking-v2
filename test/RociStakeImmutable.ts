import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { RociStakeImmutable } from "../typechain-types";

describe("RociStakeImmutable", function () {
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

    const RociStake = await ethers.getContractFactory("RociStakeImmutable");
    const rociStake = (await RociStake.deploy(
      owner.address,
      await rociToken.getAddress(),
      lockTerm,
      unstakingFee,
      treasury.address,
      maxCapacity,
      rewardTotalSupply,
    ).then((c) => c.waitForDeployment())) as RociStakeImmutable;

    await rociToken.transfer(user1.address, ethers.parseEther("1000"));
    await rociToken.transfer(user2.address, ethers.parseEther("1000"));

    return {
      rociStake,
      rociToken,
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
    it("Works", async function () {
      const {
        rociStake,
        rociToken,
        treasury,
        owner,
        lockTerm,
        unstakingFee,
        maxCapacity,
      } = await loadFixture(deployNativeReward);

      // NATIVE CHECK
      expect(await rociStake.owner()).to.equal(owner.address);
      expect(await rociStake.stakeToken()).to.equal(
        await rociToken.getAddress(),
      );
      expect(await rociStake.treasury()).to.equal(treasury.address);

      expect(await rociStake.lockTerm()).to.equal(lockTerm);
      expect(await rociStake.unstakingFee()).to.equal(unstakingFee);
      expect(await rociStake.maxCapacity()).to.equal(maxCapacity);
    });
  });

  describe("Deposit and withdrawals", async function () {
    it("Native asset", async () => {
      const { rociStake, owner, user1 } = await loadFixture(deployNativeReward);
      const amount = ethers.parseEther("100");
      await expect(
        owner.sendTransaction({ to: rociStake.getAddress(), value: amount }),
      ).to.changeEtherBalances([owner, rociStake], [-amount, amount]);
      await expect(
        user1.sendTransaction({ to: rociStake.getAddress(), value: amount }),
      ).to.changeEtherBalances([user1, rociStake], [-amount, amount]);
      await expect(
        rociStake.connect(user1).withdraw(amount),
      ).to.be.revertedWithCustomError(rociStake, "OwnableUnauthorizedAccount");
      for (let i = 0; i < 2; i++) {
        await expect(
          rociStake.connect(owner).withdraw(amount),
        ).to.changeEtherBalances([owner, rociStake], [amount, -amount]);
      }
    });
  });

  describe("Staking", async function () {
    it("Native asset", async () => {
      const {
        owner,
        rociStake,
        user1,
        user2,
        maxCapacity,
        rociToken,
        treasury,
        unstakingFee,
        lockTerm,
      } = await loadFixture(deployNativeReward);
      const rewardTotalSupply = await rociStake.rewardTotalSupply();
      const amount = maxCapacity / 4n;

      await owner.sendTransaction({
        to: await rociStake.getAddress(),
        value: rewardTotalSupply,
      });
      expect(
        await ethers.provider.getBalance(await rociStake.getAddress()),
      ).to.eq(rewardTotalSupply);

      // nobody can stake if paused
      await expect(
        rociStake.connect(user1).stake(amount),
      ).to.be.revertedWithCustomError(rociStake, "EnforcedPause");

      await rociStake.unpause();

      // user1 stakes -> unstakes before lockTerm -> pays unstaking fee
      {
        await rociToken
          .connect(user1)
          .approve(await rociStake.getAddress(), amount);
        await expect(
          rociStake.connect(user1).stake(amount),
        ).to.changeTokenBalances(
          rociToken,
          [user1, rociStake],
          [-amount, amount],
        );
        expect(await rociStake.getStakes(user1.address)).to.be.lengthOf(1);
        const timestamp = await time.latest();
        expect(await rociStake.stakes(user1.address, 0)).to.deep.equal([
          amount,
          timestamp,
          false,
        ]);
        const lockTerm = Number(await rociStake.lockTerm());
        const rewardTotalSupply = await rociStake.rewardTotalSupply();
        const unstakingWithhold = (amount * unstakingFee) / 10000n;
        {
          const stakingInfo = await rociStake.stakeInfo(user1.address, 0);
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

        const unstakeTx = rociStake.connect(user1).unstake(0);
        await expect(unstakeTx).changeTokenBalances(
          rociToken,
          [user1, rociStake, treasury],
          [amount - unstakingWithhold, -amount, unstakingWithhold],
        );
        await expect(unstakeTx).to.changeEtherBalances(
          [user1, rociStake],
          [0, 0],
        );
        expect(await rociStake.getStakes(user1.address)).to.be.lengthOf(1);
        expect(await rociStake.stakes(user1.address, 0)).to.deep.equal([
          amount,
          timestamp,
          true,
        ]);
        {
          const stakingInfo = await rociStake.stakeInfo(user1.address, 0);
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
          .approve(await rociStake.getAddress(), amount);
        await expect(
          rociStake.connect(user1).stake(amount),
        ).to.changeTokenBalances(
          rociToken,
          [user1, rociStake],
          [-amount, amount],
        );
        expect(await rociStake.getStakes(user1.address)).to.be.lengthOf(i + 2);
      }
      // user2 stakes 2 times - second is reverted because of maxCapacity
      {
        await rociToken
          .connect(user2)
          .approve(await rociStake.getAddress(), amount * 2n);
        await expect(
          rociStake.connect(user2).stake(amount),
        ).to.changeTokenBalances(
          rociToken,
          [user2, rociStake],
          [-amount, amount],
        );
        expect(await rociStake.getStakes(user2.address)).to.be.lengthOf(1);
        await expect(
          rociStake.connect(user2).stake(amount),
        ).to.be.revertedWithCustomError(rociStake, "StakingMaxCapacityReached");
      }

      await time.increase(lockTerm + 100n);

      // nobody can unstake if paused
      await rociStake.pause();
      await expect(
        rociStake.connect(user1).unstake(1),
      ).to.be.revertedWithCustomError(rociStake, "EnforcedPause");
      await rociStake.unpause();

      // user1 unstakes after lockTerm
      {
        const payload: string[] = [];
        for (let i = 1; i < 4; i++) {
          payload.push(rociStake.interface.encodeFunctionData("unstake", [i]));
        }
        const unstakeTx = rociStake.connect(user1).multicall(payload);
        // const unstakeTx = rociStake.connect(user1).unstake(1);
        await expect(unstakeTx).to.changeTokenBalances(
          rociToken,
          [user1, rociStake, treasury],
          [amount * 3n, -amount * 3n, 0],
        );
        const rewardAmount = (amount * 3n * rewardTotalSupply) / maxCapacity;
        await expect(unstakeTx).to.changeEtherBalances(
          [user1, rociStake],
          [rewardAmount, -rewardAmount],
        );
        expect(await rociStake.getStakes(user1.address)).to.be.lengthOf(4);
      }
      // user1 cannot unstake twice
      await expect(
        rociStake.connect(user1).unstake(1),
      ).to.be.revertedWithCustomError(rociStake, "AlreadyUnstaked");

      // user1 cannot stake again after unstaking because of maxCapacity
      await expect(
        rociStake.connect(user1).stake(1),
      ).to.revertedWithCustomError(rociStake, "StakingMaxCapacityReached");

      {
        // owner can always withdraw funds
        const currentBalance = await ethers.provider.getBalance(
          await rociStake.getAddress(),
        );
        expect(
          await rociStake.connect(owner).withdraw(currentBalance),
        ).to.changeEtherBalances(
          [owner.address, await rociStake.getAddress()],
          [currentBalance, -currentBalance],
        );
        expect(
          await ethers.provider.getBalance(await rociStake.getAddress()),
        ).to.eq(0);
        expect(
          await rociToken.balanceOf(await rociStake.getAddress()),
        ).to.be.greaterThan(0);
        expect(
          await owner.sendTransaction({
            to: await rociStake.getAddress(),
            value: currentBalance,
          }),
        ).to.changeEtherBalances(
          [owner.address, await rociStake.getAddress()],
          [currentBalance, -currentBalance],
        );
      }
      // user2 unstakes after lockTerm
      {
        const unstakeTx = rociStake.connect(user2).unstake(0);
        await expect(unstakeTx).to.changeTokenBalances(
          rociToken,
          [user2, rociStake, treasury],
          [amount, -amount, 0],
        );
        const rewardAmount = (amount * rewardTotalSupply) / maxCapacity;
        await expect(unstakeTx).to.changeEtherBalances(
          [user2, rociStake],
          [rewardAmount, -rewardAmount],
        );
        expect(await rociStake.getStakes(user2.address)).to.be.lengthOf(1);
      }

      expect(
        await ethers.provider.getBalance(await rociStake.getAddress()),
      ).to.eq(0);
      expect(await rociToken.balanceOf(await rociStake.getAddress())).to.eq(0);
    });
  });

  describe("Rewards", async function () {
    it("Precision", async () => {
      const { rociStake } = await loadFixture(deployNativeReward);
      // set max capacity to 1B - MAX TOTAL SUPPLY of Roci Token
      await rociStake.setMaxCapacity(ethers.parseEther("1000000000"));
      // set reward total supply to 1 ETH
      await rociStake.setRewardTotalSupply(ethers.parseEther("1"));
      // calculate reward for 0.000000001 ROCI
      expect(await rociStake.getReward(ethers.parseEther("0.000000001"))).eq(1);
    });
  });

  describe("Ownership", async function () {
    it("Transfer", async () => {
      const { rociStake, owner, user1 } = await loadFixture(deployNativeReward);

      await rociStake.connect(owner).transferOwnership(user1.address);

      await expect(
        rociStake.connect(owner).setMaxCapacity(1),
      ).to.be.revertedWithCustomError(rociStake, "OwnableUnauthorizedAccount");

      expect(await rociStake.owner()).to.equal(user1.address);

      await rociStake.connect(user1).setMaxCapacity(1);
      expect(await rociStake.maxCapacity()).to.equal(1);
    });
  });

  describe("Users can withdraw in case of emergency", async () => {
    it("Native asset", async () => {
      const { rociStake, owner, user1, maxCapacity, rociToken, unstakingFee } =
        await loadFixture(deployNativeReward);
      const amount = ethers.parseEther("100");
      await owner.sendTransaction({
        to: rociStake.getAddress(),
        value: amount,
      });

      await rociStake.connect(owner).unpause();

      await rociToken
        .connect(user1)
        .approve(await rociStake.getAddress(), maxCapacity);
      await rociStake.connect(user1).stake(maxCapacity);

      await rociStake.connect(owner).withdraw(amount);

      expect(
        await ethers.provider.getBalance(await rociStake.getAddress()),
      ).to.eq(0);

      await rociStake.connect(user1).unstake(0);
      expect(await rociToken.balanceOf(user1.address)).to.eq(
        maxCapacity - (unstakingFee * maxCapacity) / 10000n,
      );
      expect(await rociToken.balanceOf(await rociStake.getAddress())).to.eq(0);
    });
  });
});
