import "dotenv/config";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";

import type { HardhatUserConfig } from "hardhat/config";

function getAccounts(): string[] {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();

  if (!privateKey) {
    return [];
  }

  return [privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`];
}

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1
      },
      viaIR: true
    },
  },
  networks: {
    hardhat: {},
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://base-sepolia-rpc.example",
      chainId: 84532,
      accounts: getAccounts()
    },
    base: {
      url: process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org",
      chainId: 8453,
      accounts: getAccounts()
    }
  },
  paths: {
    sources: "./contracts"
  },
  etherscan: {
    apiKey: process.env.BASESCAN_API_KEY ?? "",
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
          browserURL: "https://sepolia.basescan.org"
        }
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
          browserURL: "https://basescan.org"
        }
      }
    ]
  }
};

export default config;
