import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ethers, network } from "hardhat";

import { getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const LOCAL_HARDHAT_CHAIN_ID = 31337n;

const DEFAULT_BASE_SEPOLIA_RPC_URL = "https://base-sepolia-rpc.example";
const DEFAULT_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEFAULT_ETH_USD_FEED = "0x4adc67d868ac7a395922e35c834e3bfa52e3f9c0";
const DEFAULT_TVRN_USD_FEED = ethers.ZeroAddress;

type RoleGrantRecord = {
  contract: string;
  role: string;
  grantee: string;
  txHash: string | null;
  status: "granted" | "already-granted";
};

function getRequiredAddress(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;

  if (!ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }

  return ethers.getAddress(value);
}

function getOptionalAddress(name: string): string | null {
  const value = process.env[name]?.trim();

  if (!value) {
    return null;
  }

  if (!ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }

  return ethers.getAddress(value);
}

async function ensureRole(
  contract: any,
  contractName: string,
  role: string,
  grantee: string,
  records: RoleGrantRecord[]
): Promise<void> {
  const hasRole = await contract.hasRole(role, grantee);

  if (hasRole) {
    records.push({
      contract: contractName,
      role,
      grantee,
      txHash: null,
      status: "already-granted"
    });
    return;
  }

  const tx = await contract.grantRole(role, grantee);
  await tx.wait();

  records.push({
    contract: contractName,
    role,
    grantee,
    txHash: tx.hash,
    status: "granted"
  });
}

async function ensureMasterFlag(
  registry: any,
  methodName: "setMasterFounder" | "setMasterSuccessor",
  target: string
): Promise<string> {
  const tx = await registry[methodName](target, true);
  await tx.wait();
  return tx.hash;
}

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const currentNetwork = await ethers.provider.getNetwork();

  if (
    currentNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID &&
    currentNetwork.chainId !== LOCAL_HARDHAT_CHAIN_ID
  ) {
    throw new Error(
      `This deployment is configured for Base Sepolia (84532). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const ethUsdFeed = getRequiredAddress("BASE_SEPOLIA_ETH_USD_FEED", DEFAULT_ETH_USD_FEED);
  const tvrnUsdFeed = getRequiredAddress("BASE_SEPOLIA_TVRN_USD_FEED", DEFAULT_TVRN_USD_FEED);

  let usdcAddress: string;
  let localMockUsdcAddress: string | null = null;

  if (currentNetwork.chainId === LOCAL_HARDHAT_CHAIN_ID) {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    localMockUsdcAddress = await mockUsdc.getAddress();
    usdcAddress = localMockUsdcAddress;

    console.log(`MockUSDC deployed for local validation: ${localMockUsdcAddress}`);
  } else {
    usdcAddress = getRequiredAddress("BASE_SEPOLIA_USDC_ADDRESS", DEFAULT_USDC_ADDRESS);
  }

  const arbiterAddress = getOptionalAddress("ARBITER_ADDRESS");
  const keeperAddress = getRequiredAddress("KEEPER_ADDRESS", deployer.address);
  const masterFounderAddress = getOptionalAddress("MASTER_FOUNDER_ADDRESS");
  const masterSuccessorAddress = getOptionalAddress("MASTER_SUCCESSOR_ADDRESS");

  if (tvrnUsdFeed === ethers.ZeroAddress) {
    console.warn(
      "BASE_SEPOLIA_TVRN_USD_FEED is using a placeholder zero address. Set a live feed before compensation paths that price TVRN are used."
    );
  }

  const TavernToken = await getWorkspaceContractFactory("TavernToken");
  const token = await TavernToken.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  console.log(`TavernToken deployed: ${tokenAddress}`);

  const TavernRegistry = await getWorkspaceContractFactory("TavernRegistry");
  const registry = await TavernRegistry.deploy(tokenAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();

  console.log(`TavernRegistry deployed: ${registryAddress}`);

  const TavernEscrow = await ethers.getContractFactory("TavernEscrow");
  const escrow = await TavernEscrow.deploy(
    usdcAddress,
    tokenAddress,
    registryAddress,
    ethUsdFeed,
    tvrnUsdFeed
  );
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  console.log(`TavernEscrow deployed: ${escrowAddress}`);

  const roleGrants: RoleGrantRecord[] = [];

  await ensureRole(
    token,
    "TavernToken",
    await token.MINTER_ROLE(),
    registryAddress,
    roleGrants
  );
  await ensureRole(
    token,
    "TavernToken",
    await token.MINTER_ROLE(),
    escrowAddress,
    roleGrants
  );
  await ensureRole(
    token,
    "TavernToken",
    await token.ESCROW_ROLE(),
    escrowAddress,
    roleGrants
  );
  await ensureRole(
    registry,
    "TavernRegistry",
    await registry.ARBITER_ROLE(),
    escrowAddress,
    roleGrants
  );

  if (arbiterAddress) {
    await ensureRole(
      registry,
      "TavernRegistry",
      await registry.ARBITER_ROLE(),
      arbiterAddress,
      roleGrants
    );
  }

  await ensureRole(
    registry,
    "TavernRegistry",
    await registry.KEEPER_ROLE(),
    keeperAddress,
    roleGrants
  );
  await ensureRole(
    escrow,
    "TavernEscrow",
    await escrow.KEEPER_ROLE(),
    keeperAddress,
    roleGrants
  );

  const masterFlags: Array<{
    kind: "founder" | "successor";
    address: string;
    txHash: string;
  }> = [];

  if (masterFounderAddress) {
    const txHash = await ensureMasterFlag(registry, "setMasterFounder", masterFounderAddress);
    masterFlags.push({
      kind: "founder",
      address: masterFounderAddress,
      txHash
    });
  }

  if (masterSuccessorAddress) {
    const txHash = await ensureMasterFlag(registry, "setMasterSuccessor", masterSuccessorAddress);
    masterFlags.push({
      kind: "successor",
      address: masterSuccessorAddress,
      txHash
    });
  }

  const outputPath = path.join(process.cwd(), "deployments", "baseSepolia.json");
  await mkdir(path.dirname(outputPath), { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId),
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? DEFAULT_BASE_SEPOLIA_RPC_URL
    },
    deployer: deployer.address,
    addresses: {
      tavernToken: tokenAddress,
      tavernRegistry: registryAddress,
      tavernEscrow: escrowAddress
    },
    constructorArgs: {
      tavernToken: null,
      tavernRegistry: {
        guildToken: tokenAddress
      },
      tavernEscrow: {
        usdc: usdcAddress,
        tavernToken: tokenAddress,
        registry: registryAddress,
        ethUsdFeed,
        tvrnUsdFeed
      }
    },
    optionalRoleTargets: {
      arbiterAddress,
      keeperAddress
    },
    localValidation: {
      mockUsdc: localMockUsdcAddress
    },
    masterFlags,
    rolesGranted: roleGrants,
    notes: [
      "Base Sepolia USDC defaults to 0x036CbD53842c5426634e7929541eC2318f3dCF7e from Base documentation.",
      "ETH/USD defaults to 0x4adc67d868ac7a395922e35c834e3bfa52e3f9c0 for Base Sepolia.",
      "TVRN/USD defaults to the zero-address placeholder until a live feed exists.",
      "Local Hardhat validation deploys MockUSDC automatically because TavernEscrow reads token decimals in the constructor."
    ]
  };

  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Deployment manifest saved to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
