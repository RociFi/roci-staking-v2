import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { NATIVE_ADDRESS } from "../shared/constants";
import { RociStake } from "../typechain-types";

describe("RociStake", function () {
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

    const RociStake = await ethers.getContractFactory("RociStake");
    const rociStakeNative = (await upgrades
      .deployProxy(RociStake, [
        owner.address,
        await rociToken.getAddress(),
        NATIVE_ADDRESS,
        lockTerm,
        unstakingFee,
        treasury.address,
        maxCapacity,
        rewardTotalSupply,
      ])
      .then((c) => c.waitForDeployment())) as RociStake;

    const rociStakeERC20 = (await upgrades
      .deployProxy(RociStake, [
        owner.address,
        await rociToken.getAddress(),
        await mockERC20.getAddress(),
        lockTerm,
        unstakingFee,
        treasury.address,
        maxCapacity,
        rewardTotalSupply,
      ])
      .then((c) => c.waitForDeployment())) as RociStake;

    await mockERC20.mint(owner.address, ethers.parseEther("1000"));

    await rociToken.transfer(user1.address, ethers.parseEther("1000"));
    await rociToken.transfer(user2.address, ethers.parseEther("1000"));

    return {
      rociStakeERC20,
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
    it("Native and ERC20 stacking", async function () {
      const {
        rociStakeNative,
        rociStakeERC20,
        mockERC20,
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

      // ERC20 CHECK
      expect(await rociStakeERC20.owner()).to.equal(owner.address);
      expect(await rociStakeERC20.stakeToken()).to.equal(
        await rociToken.getAddress(),
      );
      expect(await rociStakeERC20.rewardToken()).to.equal(
        await mockERC20.getAddress(),
      );
      expect(await rociStakeERC20.treasury()).to.equal(treasury.address);

      expect(await rociStakeERC20.lockTerm()).to.equal(lockTerm);
      expect(await rociStakeERC20.unstakingFee()).to.equal(unstakingFee);
      expect(await rociStakeERC20.maxCapacity()).to.equal(maxCapacity);
    });

    it("Upgrades", async function () {
      const { rociStakeNative, rociStakeERC20, owner, user1 } =
        await loadFixture(deployNativeReward);
      const factory = await ethers.getContractFactory("RociStakeUpgrade");

      // not owner cannot upgrade
      await expect(
        upgrades.upgradeProxy(
          await rociStakeNative.getAddress(),
          factory.connect(user1),
        ),
      ).to.be.revertedWithCustomError(
        rociStakeNative,
        "OwnableUnauthorizedAccount",
      );
      await expect(
        upgrades.upgradeProxy(
          await rociStakeERC20.getAddress(),
          factory.connect(user1),
        ),
      ).to.be.revertedWithCustomError(
        rociStakeERC20,
        "OwnableUnauthorizedAccount",
      );

      // owner can upgrade
      const upgradedNative = await upgrades.upgradeProxy(
        await rociStakeNative.getAddress(),
        factory,
      );
      const upgradedERC20 = await upgrades.upgradeProxy(
        await rociStakeERC20.getAddress(),
        factory,
      );

      expect(await upgradedNative.owner()).to.equal(owner.address);
      expect(await upgradedERC20.owner()).to.equal(owner.address);

      expect(await upgradedNative.version()).to.equal("v2");
      expect(await upgradedERC20.version()).to.equal("v2");
    });
  });

  describe("Deposit and withdrawals", async function () {
    it("Native asset", async () => {
      const { rociStakeNative, owner, user1 } = await loadFixture(
        deployNativeReward,
      );
      const amount = ethers.parseEther("100");
      await expect(
        rociStakeNative.connect(user1).deposit(0, { value: amount }),
      ).to.be.revertedWithCustomError(
        rociStakeNative,
        "OwnableUnauthorizedAccount",
      );
      for (let i = 0; i < 2; i++) {
        const deposit = rociStakeNative.deposit(0, { value: amount });
        await expect(deposit).to.changeEtherBalances(
          [owner, rociStakeNative],
          [-amount, amount],
        );
      }
      await expect(
        rociStakeNative.connect(user1).withdraw(amount),
      ).to.be.revertedWithCustomError(
        rociStakeNative,
        "OwnableUnauthorizedAccount",
      );
      for (let i = 0; i < 2; i++) {
        const withdraw = rociStakeNative.withdraw(amount);
        await expect(withdraw).to.changeEtherBalances(
          [owner, rociStakeNative],
          [amount, -amount],
        );
      }
    });

    it("ERC20 asset", async () => {
      const { rociStakeERC20, mockERC20, owner, user1 } = await loadFixture(
        deployNativeReward,
      );
      const amount = ethers.parseEther("100");
      await mockERC20.mint(user1.address, amount);
      await mockERC20
        .connect(user1)
        .approve(await rociStakeERC20.getAddress(), amount);
      await expect(
        rociStakeERC20.connect(user1).deposit(amount),
      ).to.be.revertedWithCustomError(
        rociStakeERC20,
        "OwnableUnauthorizedAccount",
      );
      await mockERC20.approve(await rociStakeERC20.getAddress(), amount * 2n);
      for (let i = 0; i < 2; i++) {
        const deposit = rociStakeERC20.deposit(amount);
        await expect(deposit).to.changeTokenBalances(
          mockERC20,
          [rociStakeERC20, owner],
          [amount, -amount],
        );
      }
      await expect(
        rociStakeERC20.connect(user1).withdraw(amount),
      ).to.be.revertedWithCustomError(
        rociStakeERC20,
        "OwnableUnauthorizedAccount",
      );
      for (let i = 0; i < 2; i++) {
        const withdraw = rociStakeERC20.withdraw(amount);
        await expect(withdraw).to.changeTokenBalances(
          mockERC20,
          [rociStakeERC20, owner],
          [-amount, amount],
        );
      }
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

      await rociStakeNative.deposit(0, { value: rewardTotalSupply });

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

      // owner cannot withdraw funds if there are active stakes
      await expect(rociStakeNative.withdraw(1)).to.be.revertedWithCustomError(
        rociStakeNative,
        "ActiveStakes",
      );

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

      // owner cannot withdraw funds if there are active stakes
      await expect(rociStakeNative.withdraw(1)).to.be.revertedWithCustomError(
        rociStakeNative,
        "ActiveStakes",
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

  describe("Rewards", async function () {
    it("Precision", async () => {
      const { rociStakeNative } = await loadFixture(deployNativeReward);
      // set max capacity to 1B - MAX TOTAL SUPPLY of Roci Token
      await rociStakeNative.setMaxCapacity(ethers.parseEther("1000000000"));
      // set reward total supply to 1 ETH
      await rociStakeNative.setRewardTotalSupply(ethers.parseEther("1"));
      // calculate reward for 0.000000001 ROCI
      expect(
        await rociStakeNative.getReward(ethers.parseEther("0.000000001")),
      ).eq(1);
    });
  });

  describe("Ownership", async function () {
    it("Transfer", async () => {
      const { rociStakeNative, owner, user1 } = await loadFixture(
        deployNativeReward,
      );

      await rociStakeNative.connect(owner).transferOwnership(user1.address);

      await expect(
        rociStakeNative.connect(owner).setMaxCapacity(1),
      ).to.be.revertedWithCustomError(
        rociStakeNative,
        "OwnableUnauthorizedAccount",
      );

      expect(await rociStakeNative.owner()).to.equal(user1.address);

      await rociStakeNative.connect(user1).setMaxCapacity(1);
      expect(await rociStakeNative.maxCapacity()).to.equal(1);
    });
  });
});
