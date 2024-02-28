import { ethers } from "hardhat";
import {
  ROCI_TOKEN_ADDRESS_ETHEREUM,
  TREASURY_ADDRESS_ETHEREUM,
} from "../shared/constants";
import { RociStake } from "../typechain-types";

async function main() {
  // 31 days
  const lockTerm = BigInt(31 * 24 * 60 * 60);
  // 10%
  const unstakingFee = 1000n;
  // 3400000 ROCI
  const maxCapacity = ethers.parseEther("3400000");

  const rewardTotalSupply = ethers.parseEther("1.5");

  const [owner] = await ethers.getSigners();

  const RociStake = await ethers.getContractFactory("RociStakeImmutable");
  // const rociStakeNative = (await RociStake.deploy(
  //   owner.address,
  //   ROCI_TOKEN_ADDRESS_ETHEREUM,
  //   lockTerm,
  //   unstakingFee,
  //   TREASURY_ADDRESS_ETHEREUM,
  //   maxCapacity,
  //   rewardTotalSupply,
  // ).then((c) => c.waitForDeployment())) as RociStake;
  // console.log(
  //   "RociStakeNative deployed to:",
  //   await rociStakeNative.getAddress(),
  // );

  // await rociStakeNative.deposit(0, { value: rewardTotalSupply });
  // await rociStakeNative.unpause();

  console.log(
    owner.address,
    ROCI_TOKEN_ADDRESS_ETHEREUM,
    lockTerm,
    unstakingFee,
    TREASURY_ADDRESS_ETHEREUM,
    maxCapacity,
    rewardTotalSupply,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
