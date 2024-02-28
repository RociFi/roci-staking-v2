import { ethers } from "hardhat";
import { ROCI_STAKE_ADDRESS_ETHEREUM } from "../shared/constants";

async function main() {
  const [owner] = await ethers.getSigners();
  const rociStake = await ethers.getContractAt(
    "RociStake",
    ROCI_STAKE_ADDRESS_ETHEREUM,
    owner,
  );
  await rociStake.unpause().then((tx) => tx.wait());
  // await rociStake.deposit(0, { value: ethers.parseEther("1.5") });
  // await rociStake.rewardTotalSupply().then(console.log);
  // await rociStake.paused().then(console.log);
  // await rociStake.unpause().then((tx) => tx.wait());
  // await rociStake
  //   .deposit(ethers.parseEther("10"), { value: ethers.parseEther("10") })
  //   .then((tx) => tx.wait());
  // await rociStake.withdraw(ethers.parseEther("10")).then((tx) => tx.wait());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
