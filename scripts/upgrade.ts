import { ethers, upgrades } from "hardhat";
import {
  ROCI_STAKE_ADDRESS_ETHEREUM,
  ROCI_TOKEN_ADDRESS_ETHEREUM,
} from "../shared/constants";
import { RociStake } from "../typechain-types";

async function main() {
  const [owner] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("RociStake", owner);
  const newImplementationAddress = await upgrades.prepareUpgrade(
    ROCI_TOKEN_ADDRESS_ETHEREUM,
    factory,
  );
  const rociStake = (await ethers.getContractAt(
    "RociStake",
    ROCI_STAKE_ADDRESS_ETHEREUM,
    owner,
  )) as unknown as RociStake;
  const pauseEncoded = rociStake.interface.encodeFunctionData("pause");
  rociStake.interface.encodeFunctionData("deposit", [ethers.parseEther("1")]);
  const upgradeToEncoded = rociStake.interface.encodeFunctionData(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    "upgradeToAndCall",
    [newImplementationAddress, "0x"],
  );
  const unpauseEncoded = rociStake.interface.encodeFunctionData("unpause");
  await rociStake.multicall([pauseEncoded, upgradeToEncoded, unpauseEncoded]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
