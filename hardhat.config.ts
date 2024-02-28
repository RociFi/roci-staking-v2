import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import { HardhatUserConfig } from "hardhat/config";
//
import dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.23",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10000,
          },
        },
      },
      { version: "0.8.20" },
      { version: "0.4.18" },
      { version: "0.8.9" },
    ],
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_INFURA!,
      accounts: [process.env.OWNER_PRIVATE_KEY!],
    },
    ethereum: {
      url: process.env.ETHEREUM_RPC_INFURA!,
      accounts: [process.env.REAL_OWNER_PRIVATE_KEY!],
    },
    hardhat: {
      forking: {
        url: process.env.ETHEREUM_RPC_INFURA!,
        blockNumber: 19255927,
      },
    },
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.API_KEY_ETHERSCAN!,
      sepolia: process.env.API_KEY_ETHERSCAN!,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS ? true : false,
  },
};

export default config;
