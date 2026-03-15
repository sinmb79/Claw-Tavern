import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt, getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const { ethers, network, run } = hre;

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const LOCAL_HARDHAT_CHAIN_ID = 31337n;
const DEFAULT_BASE_SEPOLIA_RPC_URL = "https://base-sepolia-rpc.example";
const BASE_MANIFEST_PATH = path.join(process.cwd(), "deployments", "baseSepolia.json");
const LOCAL_OUTPUT_PATH = path.join(process.cwd(), "deployments", "baseSepolia.automation-router.local.json");
const FRONTEND_PATH = path.join(process.cwd(), "claw-tavern-app.html");
const DEFAULT_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEFAULT_ETH_USD_FEED = "0x4adc67d868ac7a395922e35c834e3bfa52e3f9c0";
const DEFAULT_TVRN_USD_FEED = ethers.ZeroAddress;
const DEFAULT_ROUTER_PRICE_FEED = ethers.ZeroAddress;

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
    tavernAutomationRouter?: {
      escrow: string;
      registry: string;
      priceFeed: string;
    } | null;
  };
  rolesGranted?: RoleGrantRecord[];
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

async function verifyContract(name: string, address: string, constructorArguments: string[]): Promise<boolean> {
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

async function updateFrontendRouterAddress(routerAddress: string): Promise<void> {
  let html = await readFile(FRONTEND_PATH, "utf8");

  if (/tavernAutomationRouter:\s*\"0x[a-fA-F0-9]{40}\"/.test(html)) {
    html = html.replace(
      /tavernAutomationRouter:\s*\"0x[a-fA-F0-9]{40}\"/,
      `tavernAutomationRouter: "${routerAddress}"`
    );
  } else {
    html = html.replace(
      /(tavernGovernance:\s*\"0x[a-fA-F0-9]{40}\",\r?\n)/,
      `$1        tavernAutomationRouter: "${routerAddress}",\n`
    );
  }

  await writeFile(FRONTEND_PATH, html, "utf8");
}

async function deployLocalPrerequisites(): Promise<{
  tokenAddress: string;
  registryAddress: string;
  escrowAddress: string;
  localManifest: Record<string, unknown>;
}> {
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const nowBlock = await ethers.provider.getBlock("latest");
  const now = BigInt(nowBlock?.timestamp ?? Math.floor(Date.now() / 1000));

  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const ethUsdFeed = await MockV3Aggregator.deploy(8, 2_000n * 10n ** 8n, now);
  await ethUsdFeed.waitForDeployment();
  const tvrnUsdFeed = await MockV3Aggregator.deploy(8, 1n * 10n ** 8n, now);
  await tvrnUsdFeed.waitForDeployment();

  const TavernToken = await getWorkspaceContractFactory("TavernToken");
  const token = await TavernToken.deploy();
  await token.waitForDeployment();

  const TavernRegistry = await getWorkspaceContractFactory("TavernRegistry");
  const registry = await TavernRegistry.deploy(await token.getAddress());
  await registry.waitForDeployment();

  const TavernEscrow = await ethers.getContractFactory("TavernEscrow");
  const escrow = await TavernEscrow.deploy(
    await usdc.getAddress(),
    await token.getAddress(),
    await registry.getAddress(),
    await ethUsdFeed.getAddress(),
    await tvrnUsdFeed.getAddress()
  );
  await escrow.waitForDeployment();

  await token.grantRole(await token.MINTER_ROLE(), await registry.getAddress());
  await token.grantRole(await token.MINTER_ROLE(), await escrow.getAddress());
  await token.grantRole(await token.ESCROW_ROLE(), await escrow.getAddress());
  await registry.grantRole(await registry.ARBITER_ROLE(), await escrow.getAddress());

  return {
    tokenAddress: await token.getAddress(),
    registryAddress: await registry.getAddress(),
    escrowAddress: await escrow.getAddress(),
    localManifest: {
      mockUsdc: await usdc.getAddress(),
      ethUsdFeed: await ethUsdFeed.getAddress(),
      tvrnUsdFeed: await tvrnUsdFeed.getAddress()
    }
  };
}

async function main(): Promise<void> {
  await run("compile", { quiet: true, force: true });

  const [deployer] = await ethers.getSigners();
  const managedDeployer = new ethers.NonceManager(deployer);
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID && currentNetwork.chainId !== LOCAL_HARDHAT_CHAIN_ID) {
    throw new Error(
      `This automation router deployment is configured for Base Sepolia (84532) or Hardhat local validation (31337). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const isLocalValidation = currentNetwork.chainId === LOCAL_HARDHAT_CHAIN_ID;
  const manifestPath = isLocalValidation ? LOCAL_OUTPUT_PATH : BASE_MANIFEST_PATH;
  const manifest = (await readManifest(isLocalValidation ? LOCAL_OUTPUT_PATH : BASE_MANIFEST_PATH)) ?? {
    addresses: {},
    constructorArgs: {}
  };

  let tokenAddress = manifest.addresses.tavernToken ?? null;
  let registryAddress = manifest.addresses.tavernRegistry ?? null;
  let escrowAddress = manifest.addresses.tavernEscrow ?? null;
  let localValidation: Record<string, unknown> | undefined = manifest.localValidation;

  if (isLocalValidation) {
    const local = await deployLocalPrerequisites();
    tokenAddress = local.tokenAddress;
    registryAddress = local.registryAddress;
    escrowAddress = local.escrowAddress;
    localValidation = {
      mode: "local-hardhat",
      tavernToken: tokenAddress,
      tavernRegistry: registryAddress,
      tavernEscrow: escrowAddress,
      ...local.localManifest
    };
  }

  const resolvedRegistry = validateAddress("addresses.tavernRegistry", registryAddress);
  const resolvedEscrow = validateAddress("addresses.tavernEscrow", escrowAddress);
  const reuseRouterAddress = process.env.PHASE3_REUSE_AUTOMATION_ROUTER_ADDRESS?.trim();
  const reuseRouterTxHash = process.env.PHASE3_REUSE_AUTOMATION_ROUTER_TX_HASH?.trim() || null;

  let routerAddress: string;
  let deploymentTxHash: string | null;
  const routerPriceFeed = isLocalValidation
    ? DEFAULT_ROUTER_PRICE_FEED
    : validateAddress(
        "PHASE3_AUTOMATION_PRICE_FEED_ADDRESS",
        process.env.PHASE3_AUTOMATION_PRICE_FEED_ADDRESS?.trim() || DEFAULT_ROUTER_PRICE_FEED
      );

  if (reuseRouterAddress) {
    routerAddress = validateAddress("PHASE3_REUSE_AUTOMATION_ROUTER_ADDRESS", reuseRouterAddress);
    const existingCode = await ethers.provider.getCode(routerAddress);
    if (existingCode === "0x") {
      throw new Error(`PHASE3_REUSE_AUTOMATION_ROUTER_ADDRESS has no code on the current network: ${routerAddress}`);
    }
    deploymentTxHash = reuseRouterTxHash;
  } else {
    const TavernAutomationRouter = await ethers.getContractFactory("TavernAutomationRouter", managedDeployer);
    const router = await TavernAutomationRouter.deploy(resolvedEscrow, resolvedRegistry, routerPriceFeed);
    await router.waitForDeployment();
    routerAddress = await router.getAddress();
    deploymentTxHash = router.deploymentTransaction()?.hash ?? null;
  }

  const registry = await getWorkspaceContractAt("TavernRegistry", resolvedRegistry, managedDeployer);
  const escrow = await ethers.getContractAt("TavernEscrow", resolvedEscrow, managedDeployer);

  const registryGrant = await ensureRole(
    registry,
    "TavernRegistry",
    await registry.KEEPER_ROLE(),
    routerAddress
  );
  const escrowGrant = await ensureRole(
    escrow,
    "TavernEscrow",
    await escrow.KEEPER_ROLE(),
    routerAddress
  );

  let verified = false;
  if (!isLocalValidation) {
    verified = await verifyContract("TavernAutomationRouter", routerAddress, [
      resolvedEscrow,
      resolvedRegistry,
      routerPriceFeed
    ]);
    await updateFrontendRouterAddress(routerAddress);
  }

  const notes = new Set(manifest.notes ?? []);
  notes.add("Task 14 adds TavernAutomationRouter as a native Chainlink Automation-compatible upkeep target.");
  notes.add("Router deployment requires KEEPER_ROLE on TavernEscrow and TavernRegistry, then register-automation.ts can switch to a single native upkeep.");
  if (isLocalValidation) {
    notes.add("Local validation manifest: deploy/06_deploy_automation_router.ts deployed temporary mocks plus TavernToken, TavernRegistry, and TavernEscrow before wiring TavernAutomationRouter.");
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
      tavernToken: tokenAddress ?? manifest.addresses.tavernToken,
      tavernRegistry: resolvedRegistry,
      tavernEscrow: resolvedEscrow,
      tavernAutomationRouter: routerAddress
    },
    constructorArgs: {
      ...manifest.constructorArgs,
      ...(isLocalValidation
        ? {
            tavernToken: null,
            tavernRegistry: { guildToken: tokenAddress ?? deployer.address },
            tavernEscrow: {
              usdc: String(localValidation?.mockUsdc ?? DEFAULT_USDC_ADDRESS),
              tavernToken: tokenAddress ?? deployer.address,
              registry: resolvedRegistry,
              ethUsdFeed: String(localValidation?.ethUsdFeed ?? DEFAULT_ETH_USD_FEED),
              tvrnUsdFeed: String(localValidation?.tvrnUsdFeed ?? DEFAULT_TVRN_USD_FEED)
            }
          }
        : {}),
      tavernAutomationRouter: {
        escrow: resolvedEscrow,
        registry: resolvedRegistry,
        priceFeed: routerPriceFeed
      }
    },
    rolesGranted: [...(manifest.rolesGranted ?? []), registryGrant, escrowGrant],
    notes: [...notes],
    localValidation
  };

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(nextManifest, null, 2));

  console.log(`TavernAutomationRouter deployed: ${routerAddress}`);
  console.log(`Deployment tx: ${deploymentTxHash ?? "unknown"}`);
  console.log(`TavernRegistry KEEPER_ROLE -> ${registryGrant.status} (${registryGrant.txHash ?? "already granted"})`);
  console.log(`TavernEscrow KEEPER_ROLE -> ${escrowGrant.status} (${escrowGrant.txHash ?? "already granted"})`);
  console.log(`Basescan verification: ${isLocalValidation ? "skipped (local validation)" : verified ? "ok" : "failed"}`);
  console.log(`Deployment manifest written to ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
