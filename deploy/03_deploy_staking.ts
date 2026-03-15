import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ethers, network } from "hardhat";

import { getWorkspaceContractAt, getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const LOCAL_HARDHAT_CHAIN_ID = 31337n;
const DEFAULT_BASE_SEPOLIA_RPC_URL = "https://base-sepolia-rpc.example";
const BASE_MANIFEST_PATH = path.join(process.cwd(), "deployments", "baseSepolia.json");
const LOCAL_OUTPUT_PATH = path.join(process.cwd(), "deployments", "baseSepolia.staking.local.json");

type RoleGrantRecord = {
  contract: string;
  role: string;
  grantee: string;
  txHash: string | null;
  status: "granted" | "already-granted";
};

type DeploymentManifest = {
  generatedAt?: string;
  network?: {
    name: string;
    chainId: number;
    rpcUrl: string;
  };
  deployer?: string;
  addresses: {
    tavernToken?: string;
    tavernRegistry?: string;
    tavernEscrow?: string;
    tavernStaking?: string;
  };
  constructorArgs: {
    tavernToken?: null;
    tavernRegistry?: {
      guildToken: string;
    };
    tavernEscrow?: {
      usdc: string;
      tavernToken: string;
      registry: string;
      ethUsdFeed: string;
      tvrnUsdFeed: string;
    };
    tavernStaking?: {
      tavernToken: string;
      registry: string;
    };
  };
  optionalRoleTargets?: Record<string, unknown>;
  rolesGranted?: RoleGrantRecord[];
  notes?: string[];
  localValidation?: Record<string, unknown>;
};

function validateAddress(name: string, value: string | undefined): string {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value ?? "undefined"}`);
  }

  return ethers.getAddress(value);
}

async function readManifest(filePath: string): Promise<DeploymentManifest | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as DeploymentManifest;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function ensureRole(
  contract: any,
  contractName: string,
  role: string,
  grantee: string
): Promise<RoleGrantRecord> {
  const hasRole = await contract.hasRole(role, grantee);

  if (hasRole) {
    return {
      contract: contractName,
      role,
      grantee,
      txHash: null,
      status: "already-granted"
    };
  }

  const tx = await contract.grantRole(role, grantee);
  await tx.wait();

  return {
    contract: contractName,
    role,
    grantee,
    txHash: tx.hash,
    status: "granted"
  };
}

async function ensureStakingContract(registry: any, stakingAddress: string): Promise<{
  status: "configured" | "already-configured";
  txHash: string | null;
}> {
  const current = ethers.getAddress(await registry.stakingContract());

  if (current === stakingAddress) {
    return {
      status: "already-configured",
      txHash: null
    };
  }

  const tx = await registry.setStakingContract(stakingAddress);
  await tx.wait();

  return {
    status: "configured",
    txHash: tx.hash
  };
}

async function assertRegistrySupportsStakingHooks(registry: any, registryAddress: string): Promise<void> {
  try {
    await ethers.provider.call({
      to: registryAddress,
      data: registry.interface.encodeFunctionData("stakingContract")
    });
  } catch (error: any) {
    throw new Error(
      `Live TavernRegistry at ${registryAddress} does not implement Phase 2 staking hooks (stakingContract/setStakingContract). Aborting before deploying TavernStaking to avoid another orphan deployment. Root cause: ${error?.shortMessage ?? error?.message ?? error}`
    );
  }
}

async function deployLocalPrerequisites(): Promise<{
  tokenAddress: string;
  registryAddress: string;
}> {
  const TavernToken = await getWorkspaceContractFactory("TavernToken");
  const token = await TavernToken.deploy();
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();

  const TavernRegistry = await getWorkspaceContractFactory("TavernRegistry");
  const registry = await TavernRegistry.deploy(tokenAddress);
  await registry.waitForDeployment();

  return {
    tokenAddress,
    registryAddress: await registry.getAddress()
  };
}

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const currentNetwork = await ethers.provider.getNetwork();
  const chainId = currentNetwork.chainId;

  if (chainId !== BASE_SEPOLIA_CHAIN_ID && chainId !== LOCAL_HARDHAT_CHAIN_ID) {
    throw new Error(
      `This staking deployment is configured for Base Sepolia (84532) or Hardhat local validation (31337). Connected chainId: ${chainId.toString()}`
    );
  }

  const isLocalValidation = chainId === LOCAL_HARDHAT_CHAIN_ID;
  const outputPath = isLocalValidation ? LOCAL_OUTPUT_PATH : BASE_MANIFEST_PATH;

  let baseManifest = (await readManifest(isLocalValidation ? LOCAL_OUTPUT_PATH : BASE_MANIFEST_PATH)) ?? {
    addresses: {},
    constructorArgs: {}
  };

  let tokenAddress: string;
  let registryAddress: string;

  if (isLocalValidation) {
    const local = await deployLocalPrerequisites();
    tokenAddress = local.tokenAddress;
    registryAddress = local.registryAddress;
  } else {
    tokenAddress = validateAddress("addresses.tavernToken", baseManifest.addresses.tavernToken);
    registryAddress = validateAddress("addresses.tavernRegistry", baseManifest.addresses.tavernRegistry);
  }

  const token = await getWorkspaceContractAt("TavernToken", tokenAddress);
  const registry = await getWorkspaceContractAt("TavernRegistry", registryAddress);

  if (!isLocalValidation) {
    await assertRegistrySupportsStakingHooks(registry, registryAddress);
  }

  const TavernStaking = await getWorkspaceContractFactory("TavernStaking");
  const staking = await TavernStaking.deploy(tokenAddress, registryAddress);
  await staking.waitForDeployment();

  const stakingAddress = await staking.getAddress();

  const burnerGrant = await ensureRole(
    token,
    "TavernToken",
    await token.BURNER_ROLE(),
    stakingAddress
  );
  const stakingSetup = await ensureStakingContract(registry, stakingAddress);

  const notes = new Set(baseManifest.notes ?? []);
  notes.add("Task 11 adds TavernStaking with a 100 TVRN bond, 7-day unstake cooldown, and 50% slash burn.");
  if (isLocalValidation) {
    notes.add("Local validation manifest: deploy/03_deploy_staking.ts deployed a temporary TavernToken and TavernRegistry before wiring TavernStaking.");
  }

  const nextManifest: DeploymentManifest = {
    ...baseManifest,
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(chainId),
      rpcUrl: isLocalValidation
        ? "hardhat://in-memory"
        : process.env.BASE_SEPOLIA_RPC_URL ?? DEFAULT_BASE_SEPOLIA_RPC_URL
    },
    deployer: deployer.address,
    addresses: {
      ...baseManifest.addresses,
      tavernToken: tokenAddress,
      tavernRegistry: registryAddress,
      tavernStaking: stakingAddress
    },
    constructorArgs: {
      ...baseManifest.constructorArgs,
      ...(isLocalValidation
        ? {
            tavernToken: null,
            tavernRegistry: { guildToken: tokenAddress }
          }
        : {}),
      tavernStaking: {
        tavernToken: tokenAddress,
        registry: registryAddress
      }
    },
    rolesGranted: [...(baseManifest.rolesGranted ?? []), burnerGrant],
    notes: [...notes],
    localValidation: isLocalValidation
      ? {
          mode: "local-hardhat",
          tavernToken: tokenAddress,
          tavernRegistry: registryAddress
        }
      : baseManifest.localValidation
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(nextManifest, null, 2));

  console.log(`TavernStaking deployed: ${stakingAddress}`);
  console.log(
    `TavernToken BURNER_ROLE -> ${burnerGrant.status} (${burnerGrant.txHash ?? "already granted"})`
  );
  console.log(
    `TavernRegistry stakingContract -> ${stakingSetup.status} (${stakingSetup.txHash ?? "already configured"})`
  );
  console.log(`Deployment manifest written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
