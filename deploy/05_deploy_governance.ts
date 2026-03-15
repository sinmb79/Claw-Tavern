import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const { ethers, network, run } = hre;

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const LOCAL_HARDHAT_CHAIN_ID = 31337n;
const DEFAULT_BASE_SEPOLIA_RPC_URL = "https://base-sepolia-rpc.example";
const BASE_MANIFEST_PATH = path.join(process.cwd(), "deployments", "baseSepolia.json");
const LOCAL_OUTPUT_PATH = path.join(process.cwd(), "deployments", "baseSepolia.governance.local.json");
const FRONTEND_PATH = path.join(process.cwd(), "claw-tavern-app.html");

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
    tavernGovernance?: string | null;
    tavernAutomationRouter?: string | null;
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
    tavernGovernance?: {
      tavernToken: string;
      registry: string;
    } | null;
    tavernAutomationRouter?: {
      escrow: string;
      registry: string;
    } | null;
  };
  notes?: string[];
  localValidation?: Record<string, unknown>;
};

function validateAddress(name: string, value: string | undefined | null): string {
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

async function verifyContract(
  name: string,
  address: string,
  constructorArguments: string[]
): Promise<boolean> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await run("verify:verify", {
        address,
        constructorArguments
      });
      console.log(`Verified ${name} at ${address}`);
      return true;
    } catch (error: any) {
      const message = String(error?.message ?? error);
      const normalized = message.toLowerCase();

      if (
        normalized.includes("already verified") ||
        normalized.includes("source code already verified") ||
        normalized.includes("contract source code already verified")
      ) {
        console.log(`Skipped ${name}: already verified.`);
        return true;
      }

      const retryable =
        normalized.includes("does not have bytecode") ||
        normalized.includes("unable to locate contractcode") ||
        normalized.includes("bytecode") ||
        normalized.includes("not found");

      if (!retryable || attempt === 5) {
        throw error;
      }

      console.log(`Verification retry ${attempt}/5 for ${name} after index delay...`);
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }

  return false;
}

async function updateFrontendGovernanceAddress(governanceAddress: string): Promise<void> {
  let html = await readFile(FRONTEND_PATH, "utf8");

  if (/tavernGovernance:\s*\"0x[a-fA-F0-9]{40}\"/.test(html)) {
    html = html.replace(
      /tavernGovernance:\s*\"0x[a-fA-F0-9]{40}\"/,
      `tavernGovernance: "${governanceAddress}"`
    );
  } else {
    html = html.replace(
      /(tavernEscrow:\s*\"0x[a-fA-F0-9]{40}\",\r?\n)/,
      `$1        tavernGovernance: "${governanceAddress}",\n`
    );
  }

  await writeFile(FRONTEND_PATH, html, "utf8");
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
  await run("compile", { quiet: true, force: true });

  const [deployer] = await ethers.getSigners();
  const managedDeployer = new ethers.NonceManager(deployer);
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID && currentNetwork.chainId !== LOCAL_HARDHAT_CHAIN_ID) {
    throw new Error(
      `This governance deployment is configured for Base Sepolia (84532) or Hardhat local validation (31337). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const isLocalValidation = currentNetwork.chainId === LOCAL_HARDHAT_CHAIN_ID;
  const manifestPath = isLocalValidation ? LOCAL_OUTPUT_PATH : BASE_MANIFEST_PATH;
  const manifest = (await readManifest(isLocalValidation ? LOCAL_OUTPUT_PATH : BASE_MANIFEST_PATH)) ?? {
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
    tokenAddress = validateAddress("addresses.tavernToken", manifest.addresses.tavernToken);
    registryAddress = validateAddress("addresses.tavernRegistry", manifest.addresses.tavernRegistry);
  }

  const TavernGovernance = await ethers.getContractFactory("TavernGovernance", managedDeployer);
  const governance = await TavernGovernance.deploy(tokenAddress, registryAddress);
  await governance.waitForDeployment();

  const governanceAddress = await governance.getAddress();
  const deploymentTx = governance.deploymentTransaction();

  let verified = false;
  if (!isLocalValidation) {
    verified = await verifyContract("TavernGovernance", governanceAddress, [tokenAddress, registryAddress]);
    await updateFrontendGovernanceAddress(governanceAddress);
  }

  const notes = new Set(manifest.notes ?? []);
  notes.add("Task 12 adds TavernGovernance with square-root voting, a 5-day voting window, and a 2-day timelock.");
  notes.add("Phase 3 pending: ERC20Votes snapshots and GOVERNANCE_ROLE wiring on target contracts.");
  if (isLocalValidation) {
    notes.add("Local validation manifest: deploy/05_deploy_governance.ts deployed temporary TavernToken and TavernRegistry before wiring TavernGovernance.");
  }

  const nextManifest: DeploymentManifest = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId),
      rpcUrl: isLocalValidation
        ? "hardhat://in-memory"
        : process.env.BASE_SEPOLIA_RPC_URL ?? DEFAULT_BASE_SEPOLIA_RPC_URL
    },
    deployer: deployer.address,
    addresses: {
      ...manifest.addresses,
      tavernToken: tokenAddress,
      tavernRegistry: registryAddress,
      tavernGovernance: governanceAddress,
      tavernAutomationRouter: manifest.addresses.tavernAutomationRouter ?? null
    },
    constructorArgs: {
      ...manifest.constructorArgs,
      ...(isLocalValidation
        ? {
            tavernToken: null,
            tavernRegistry: { guildToken: tokenAddress }
          }
        : {}),
      tavernAutomationRouter: manifest.constructorArgs.tavernAutomationRouter ?? null,
      tavernGovernance: {
        tavernToken: tokenAddress,
        registry: registryAddress
      }
    },
    notes: [...notes],
    localValidation: isLocalValidation
      ? {
          mode: "local-hardhat",
          tavernToken: tokenAddress,
          tavernRegistry: registryAddress,
          tavernGovernance: governanceAddress
        }
      : manifest.localValidation
  };

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(nextManifest, null, 2));

  console.log(`TavernGovernance deployed: ${governanceAddress}`);
  console.log(`Deployment tx: ${deploymentTx?.hash ?? "unknown"}`);
  console.log(`Basescan verification: ${isLocalValidation ? "skipped (local validation)" : verified ? "ok" : "failed"}`);
  console.log(`Deployment manifest written to ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
