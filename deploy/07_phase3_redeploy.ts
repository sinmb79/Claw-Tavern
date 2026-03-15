import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt, getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const { ethers, network, run } = hre;

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const DEFAULT_BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";
const DEPLOYMENT_PATH = path.join(process.cwd(), "deployments", "baseSepolia.json");
const AUTOMATION_PATH = path.join(process.cwd(), "deployments", "baseSepolia.automation.json");
const FRONTEND_PATH = path.join(process.cwd(), "claw-tavern-app.html");
const ADMIN_TVRN_USD_INITIAL_PRICE = 1_000_000;

type RoleGrantRecord = {
  contract: string;
  role: string;
  grantee: string;
  txHash: string | null;
  status: "granted" | "already-granted";
};

type LegacyAddressRecord = {
  label: string;
  adminPriceFeed?: string | null;
  tavernToken?: string | null;
  tavernRegistry?: string | null;
  tavernEscrow?: string | null;
  tavernStaking?: string | null;
  tavernGovernance?: string | null;
  tavernAutomationRouter?: string | null;
  tavernClientRPG?: string | null;
  tavernSubscription?: string | null;
  supersededAt: string;
  note: string;
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
    adminPriceFeed?: string | null;
    mockUsdc?: string | null;
    tavernToken?: string | null;
    tavernRegistry?: string | null;
    tavernEscrow?: string | null;
    tavernStaking?: string | null;
    tavernGovernance?: string | null;
    tavernAutomationRouter?: string | null;
    tavernClientRPG?: string | null;
    tavernSubscription?: string | null;
  };
  constructorArgs?: {
    adminPriceFeed?: {
      initialPrice: number;
    } | null;
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
    };
    tavernAutomationRouter?: {
      escrow: string;
      registry: string;
      priceFeed: string;
    };
    tavernClientRPG?: {
      tavernToken: string;
      escrow: string;
    } | null;
    tavernSubscription?: {
      usdc: string;
      operatorWallet: string;
      registry: string;
    } | null;
  };
  optionalRoleTargets?: {
    arbiterAddress?: string | null;
    keeperAddress?: string | null;
    operatorWallet?: string | null;
  };
  rolesGranted?: RoleGrantRecord[];
  notes?: string[];
  legacyAddresses?: LegacyAddressRecord[];
  task29FullRedeploy?: {
    executedAt: string;
    mode: "full-9-contract";
    transactionHashes: Record<string, string>;
    verification: {
      adminPriceFeed: boolean;
      tavernToken: boolean;
      tavernRegistry: boolean;
      tavernEscrow: boolean;
      tavernStaking: boolean;
      tavernGovernance: boolean;
      tavernAutomationRouter: boolean;
      tavernClientRPG: boolean;
      tavernSubscription: boolean;
    };
    smokeTestPath: string;
    automationManifestPath: string;
    nextStep: string;
  };
};

type DeploymentResult = {
  instance: any;
  address: string;
  txHash: string;
  reused: boolean;
};

function readFirstEnv(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function validateAddress(name: string, value: string | undefined | null, allowZero = false): string {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} is not configured with a valid address.`);
  }

  const normalized = ethers.getAddress(value);
  if (!allowZero && normalized === ethers.ZeroAddress) {
    throw new Error(`${name} must not be the zero address.`);
  }

  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readDeploymentManifest(): Promise<DeploymentManifest | null> {
  try {
    return JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8")) as DeploymentManifest;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function backupFile(filePath: string, backupFileName: string): Promise<string | null> {
  try {
    const contents = await readFile(filePath, "utf8");
    const backupPath = path.join(path.dirname(filePath), backupFileName);
    await writeFile(backupPath, contents, "utf8");
    return backupPath;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function assertContractCode(address: string, label: string): Promise<void> {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(`${label} points to an address with no deployed code: ${address}`);
  }
}

async function ensureRole(
  contract: any,
  contractName: string,
  role: string,
  grantee: string,
  records: RoleGrantRecord[]
): Promise<void> {
  if (await contract.hasRole(role, grantee)) {
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

async function verifyContract(
  label: string,
  address: string,
  constructorArguments: Array<string | number>
): Promise<boolean> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await run("verify:verify", {
        address,
        constructorArguments
      });
      console.log(`Verified ${label} at ${address}`);
      return true;
    } catch (error: any) {
      const message = String(error?.message ?? error).toLowerCase();
      if (
        message.includes("already verified")
        || message.includes("source code already verified")
        || message.includes("contract source code already verified")
      ) {
        console.log(`Skipped ${label}: already verified.`);
        return true;
      }

      const retryable =
        message.includes("does not have bytecode")
        || message.includes("unable to locate contractcode")
        || message.includes("bytecode")
        || message.includes("not found");

      if (!retryable || attempt === 5) {
        throw error;
      }

      console.log(`Verification retry ${attempt}/5 for ${label} after explorer index delay...`);
      await sleep(15000);
    }
  }

  return false;
}

async function assertRegistryReady(registryAddress: string): Promise<void> {
  const probe = new ethers.Contract(
    registryAddress,
    [
      "function stakingContract() view returns (address)",
      "function erc8004IdentityRegistry() view returns (address)",
      "function erc8004Required() view returns (bool)",
      "function guildCount() view returns (uint256)"
    ],
    ethers.provider
  );

  let lastError: unknown;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const code = await ethers.provider.getCode(registryAddress);
      if (code === "0x") {
        throw new Error(`No code visible yet at ${registryAddress}`);
      }

      const [stakingContract, identityRegistry, erc8004Required, guildCount] = await Promise.all([
        probe.stakingContract(),
        probe.erc8004IdentityRegistry(),
        probe.erc8004Required(),
        probe.guildCount()
      ]);

      if (stakingContract === undefined || identityRegistry === undefined || erc8004Required === undefined) {
        throw new Error(`Fresh TavernRegistry at ${registryAddress} is missing the expected selector coverage.`);
      }

      if (Number(guildCount) < 5) {
        throw new Error(`Fresh TavernRegistry at ${registryAddress} did not initialize founding guilds.`);
      }

      return;
    } catch (error) {
      lastError = error;
      if (attempt < 10) {
        await sleep(3000);
      }
    }
  }

  throw lastError;
}

async function assertEscrowReady(escrowAddress: string): Promise<void> {
  const probe = new ethers.Contract(
    escrowAddress,
    [
      "function getAutomationQuestView(uint256) view returns (uint8,uint256,uint256)",
      "function clientWithdrawTVRN(uint256)"
    ],
    ethers.provider
  );

  let lastError: unknown;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const code = await ethers.provider.getCode(escrowAddress);
      if (code === "0x") {
        throw new Error(`No code visible yet at ${escrowAddress}`);
      }

      await probe.getAutomationQuestView(0);
      throw new Error("Expected getAutomationQuestView(0) to revert for an empty quest set.");
    } catch (error: any) {
      const message = String(error?.shortMessage ?? error?.message ?? error).toLowerCase();
      if (
        message.includes("quest not found")
        || message.includes("questnotfound")
        || message.includes("execution reverted")
      ) {
        return;
      }

      lastError = new Error(
        `Fresh TavernEscrow at ${escrowAddress} does not expose the expected automation or Phase 2 path. Root cause: ${String(error?.message ?? error)}`
      );

      if (attempt < 10) {
        await sleep(3000);
      }
    }
  }

  throw lastError;
}

async function updateFrontendAddresses(
  replacements: Array<{ oldAddress: string | null; newAddress: string | null }>
): Promise<void> {
  let html = await readFile(FRONTEND_PATH, "utf8");

  for (const replacement of replacements) {
    if (!replacement.oldAddress || !replacement.newAddress) {
      continue;
    }

    html = html.replace(
      new RegExp(escapeRegExp(replacement.oldAddress), "g"),
      replacement.newAddress
    );
    html = html.replace(
      new RegExp(escapeRegExp(shortAddress(replacement.oldAddress)), "g"),
      shortAddress(replacement.newAddress)
    );
  }

  await writeFile(FRONTEND_PATH, html, "utf8");
}

async function resolveFreshOrReused(
  envAddressNames: string[],
  envTxHashNames: string[],
  factory: any,
  contractName: string,
  signer: any,
  deployArgs: unknown[]
): Promise<DeploymentResult> {
  const reusedAddressRaw = readFirstEnv(envAddressNames);
  const reusedTxHash = readFirstEnv(envTxHashNames) ?? "";

  if (reusedAddressRaw) {
    const address = validateAddress(envAddressNames[0] ?? contractName, reusedAddressRaw);
    const code = await ethers.provider.getCode(address);
    if (code === "0x") {
      throw new Error(`${envAddressNames[0] ?? contractName} points to an address with no deployed code: ${address}`);
    }

    return {
      instance: await getWorkspaceContractAt(contractName, address, signer),
      address,
      txHash: reusedTxHash,
      reused: true
    };
  }

  const instance = await factory.deploy(...deployArgs);
  await instance.waitForDeployment();
  return {
    instance,
    address: await instance.getAddress(),
    txHash: instance.deploymentTransaction?.()?.hash ?? "",
    reused: false
  };
}

function buildLegacyRecord(previousManifest: DeploymentManifest | null): LegacyAddressRecord[] {
  if (!previousManifest) {
    return [];
  }

  return [
    {
      label: "Task 25 live Sepolia set",
      adminPriceFeed: previousManifest.addresses.adminPriceFeed ?? null,
      tavernToken: previousManifest.addresses.tavernToken ?? null,
      tavernRegistry: previousManifest.addresses.tavernRegistry ?? null,
      tavernEscrow: previousManifest.addresses.tavernEscrow ?? null,
      tavernStaking: previousManifest.addresses.tavernStaking ?? null,
      tavernGovernance: previousManifest.addresses.tavernGovernance ?? null,
      tavernAutomationRouter: previousManifest.addresses.tavernAutomationRouter ?? null,
      tavernClientRPG: previousManifest.addresses.tavernClientRPG ?? null,
      tavernSubscription: previousManifest.addresses.tavernSubscription ?? null,
      supersededAt: new Date().toISOString(),
      note: "Superseded by Task 29 full 9-contract Base Sepolia redeploy."
    }
  ];
}

async function main(): Promise<void> {
  await run("compile", { quiet: true, force: true });

  const [deployer] = await ethers.getSigners();
  const signer = new ethers.NonceManager(deployer);
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `deploy/07_phase3_redeploy.ts only supports Base Sepolia (84532). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const previousManifest = await readDeploymentManifest();
  const deploymentBackup = await backupFile(DEPLOYMENT_PATH, "baseSepolia.v1-backup.json");
  const automationBackup = await backupFile(AUTOMATION_PATH, "baseSepolia.automation.v1-backup.json");

  if (deploymentBackup) {
    console.log(`Backed up deployment manifest to ${deploymentBackup}`);
  }
  if (automationBackup) {
    console.log(`Backed up automation manifest to ${automationBackup}`);
  }

  const keeperAddress = validateAddress(
    "KEEPER_ADDRESS",
    readFirstEnv(["KEEPER_ADDRESS"]) ?? previousManifest?.optionalRoleTargets?.keeperAddress ?? deployer.address
  );
  const arbiterAddress = validateAddress(
    "ARBITER_ADDRESS",
    readFirstEnv(["ARBITER_ADDRESS"]) ?? previousManifest?.optionalRoleTargets?.arbiterAddress ?? deployer.address
  );
  const operatorWallet = validateAddress(
    "BASE_SEPOLIA_SUBSCRIPTION_OPERATOR_WALLET",
    readFirstEnv([
      "BASE_SEPOLIA_SUBSCRIPTION_OPERATOR_WALLET",
      "BASE_SEPOLIA_OPERATOR_WALLET",
      "OPERATOR_WALLET",
      "SUBSCRIPTION_OPERATOR_WALLET"
    ]) ?? previousManifest?.optionalRoleTargets?.operatorWallet ?? deployer.address
  );

  const previousEscrowArgs = previousManifest?.constructorArgs?.tavernEscrow;
  const usdc = validateAddress(
    "BASE_SEPOLIA_USDC_ADDRESS",
    readFirstEnv(["BASE_SEPOLIA_USDC_ADDRESS", "BASE_SEPOLIA_USDC"]) ?? previousEscrowArgs?.usdc
  );
  const ethUsdFeed = validateAddress(
    "BASE_SEPOLIA_ETH_USD_FEED",
    readFirstEnv(["BASE_SEPOLIA_ETH_USD_FEED"]) ?? previousEscrowArgs?.ethUsdFeed
  );

  await assertContractCode(usdc, "BASE_SEPOLIA_USDC_ADDRESS");
  await assertContractCode(ethUsdFeed, "BASE_SEPOLIA_ETH_USD_FEED");

  const oldAddresses = previousManifest?.addresses ?? {};

  const AdminPriceFeedFactory = await getWorkspaceContractFactory("AdminPriceFeed", signer);
  const TavernTokenFactory = await getWorkspaceContractFactory("TavernToken", signer);
  const TavernRegistryFactory = await getWorkspaceContractFactory("TavernRegistry", signer);
  const TavernEscrowFactory = await getWorkspaceContractFactory("TavernEscrow", signer);
  const TavernStakingFactory = await getWorkspaceContractFactory("TavernStaking", signer);
  const TavernGovernanceFactory = await getWorkspaceContractFactory("TavernGovernance", signer);
  const TavernAutomationRouterFactory = await getWorkspaceContractFactory("TavernAutomationRouter", signer);
  const TavernClientRPGFactory = await getWorkspaceContractFactory("TavernClientRPG", signer);
  const TavernSubscriptionFactory = await getWorkspaceContractFactory("TavernSubscription", signer);

  const adminPriceFeedDeploy = await resolveFreshOrReused(
    ["PHASE3_REUSE_ADMIN_PRICE_FEED_ADDRESS", "SEPOLIA_REUSE_ADMIN_PRICE_FEED_ADDRESS"],
    ["PHASE3_REUSE_ADMIN_PRICE_FEED_TX_HASH", "SEPOLIA_REUSE_ADMIN_PRICE_FEED_TX_HASH"],
    AdminPriceFeedFactory,
    "AdminPriceFeed",
    signer,
    [ADMIN_TVRN_USD_INITIAL_PRICE]
  );
  const tavernTokenDeploy = await resolveFreshOrReused(
    ["PHASE3_REUSE_TOKEN_ADDRESS", "SEPOLIA_REUSE_TOKEN_ADDRESS"],
    ["PHASE3_REUSE_TOKEN_TX_HASH", "SEPOLIA_REUSE_TOKEN_TX_HASH"],
    TavernTokenFactory,
    "TavernToken",
    signer,
    []
  );
  const tavernRegistryDeploy = await resolveFreshOrReused(
    ["PHASE3_REUSE_REGISTRY_ADDRESS", "SEPOLIA_REUSE_REGISTRY_ADDRESS"],
    ["PHASE3_REUSE_REGISTRY_TX_HASH", "SEPOLIA_REUSE_REGISTRY_TX_HASH"],
    TavernRegistryFactory,
    "TavernRegistry",
    signer,
    [tavernTokenDeploy.address]
  );
  const tavernEscrowDeploy = await resolveFreshOrReused(
    ["PHASE3_REUSE_ESCROW_ADDRESS", "SEPOLIA_REUSE_ESCROW_ADDRESS"],
    ["PHASE3_REUSE_ESCROW_TX_HASH", "SEPOLIA_REUSE_ESCROW_TX_HASH"],
    TavernEscrowFactory,
    "TavernEscrow",
    signer,
    [
      usdc,
      tavernTokenDeploy.address,
      tavernRegistryDeploy.address,
      ethUsdFeed,
      adminPriceFeedDeploy.address
    ]
  );
  const tavernStakingDeploy = await resolveFreshOrReused(
    ["PHASE3_REUSE_STAKING_ADDRESS", "SEPOLIA_REUSE_STAKING_ADDRESS"],
    ["PHASE3_REUSE_STAKING_TX_HASH", "SEPOLIA_REUSE_STAKING_TX_HASH"],
    TavernStakingFactory,
    "TavernStaking",
    signer,
    [tavernTokenDeploy.address, tavernRegistryDeploy.address]
  );
  const tavernGovernanceDeploy = await resolveFreshOrReused(
    ["PHASE3_REUSE_GOVERNANCE_ADDRESS", "SEPOLIA_REUSE_GOVERNANCE_ADDRESS"],
    ["PHASE3_REUSE_GOVERNANCE_TX_HASH", "SEPOLIA_REUSE_GOVERNANCE_TX_HASH"],
    TavernGovernanceFactory,
    "TavernGovernance",
    signer,
    [tavernTokenDeploy.address, tavernRegistryDeploy.address]
  );
  const tavernAutomationRouterDeploy = await resolveFreshOrReused(
    ["PHASE3_REUSE_ROUTER_ADDRESS", "SEPOLIA_REUSE_ROUTER_ADDRESS"],
    ["PHASE3_REUSE_ROUTER_TX_HASH", "SEPOLIA_REUSE_ROUTER_TX_HASH"],
    TavernAutomationRouterFactory,
    "TavernAutomationRouter",
    signer,
    [tavernEscrowDeploy.address, tavernRegistryDeploy.address, adminPriceFeedDeploy.address]
  );
  const tavernClientRPGDeploy = await resolveFreshOrReused(
    ["PHASE3_REUSE_CLIENT_RPG_ADDRESS", "SEPOLIA_REUSE_CLIENT_RPG_ADDRESS"],
    ["PHASE3_REUSE_CLIENT_RPG_TX_HASH", "SEPOLIA_REUSE_CLIENT_RPG_TX_HASH"],
    TavernClientRPGFactory,
    "TavernClientRPG",
    signer,
    [tavernTokenDeploy.address, tavernEscrowDeploy.address]
  );
  const tavernSubscriptionDeploy = await resolveFreshOrReused(
    ["PHASE3_REUSE_SUBSCRIPTION_ADDRESS", "SEPOLIA_REUSE_SUBSCRIPTION_ADDRESS"],
    ["PHASE3_REUSE_SUBSCRIPTION_TX_HASH", "SEPOLIA_REUSE_SUBSCRIPTION_TX_HASH"],
    TavernSubscriptionFactory,
    "TavernSubscription",
    signer,
    [usdc, operatorWallet, tavernRegistryDeploy.address]
  );

  console.log(`AdminPriceFeed ${adminPriceFeedDeploy.reused ? "reused" : "deployed"} at ${adminPriceFeedDeploy.address}`);
  console.log(`TavernToken ${tavernTokenDeploy.reused ? "reused" : "deployed"} at ${tavernTokenDeploy.address}`);
  console.log(`TavernRegistry ${tavernRegistryDeploy.reused ? "reused" : "deployed"} at ${tavernRegistryDeploy.address}`);
  console.log(`TavernEscrow ${tavernEscrowDeploy.reused ? "reused" : "deployed"} at ${tavernEscrowDeploy.address}`);
  console.log(`TavernStaking ${tavernStakingDeploy.reused ? "reused" : "deployed"} at ${tavernStakingDeploy.address}`);
  console.log(`TavernGovernance ${tavernGovernanceDeploy.reused ? "reused" : "deployed"} at ${tavernGovernanceDeploy.address}`);
  console.log(`TavernAutomationRouter ${tavernAutomationRouterDeploy.reused ? "reused" : "deployed"} at ${tavernAutomationRouterDeploy.address}`);
  console.log(`TavernClientRPG ${tavernClientRPGDeploy.reused ? "reused" : "deployed"} at ${tavernClientRPGDeploy.address}`);
  console.log(`TavernSubscription ${tavernSubscriptionDeploy.reused ? "reused" : "deployed"} at ${tavernSubscriptionDeploy.address}`);

  await assertRegistryReady(tavernRegistryDeploy.address);
  await assertEscrowReady(tavernEscrowDeploy.address);

  const adminPriceFeed = adminPriceFeedDeploy.instance;
  const tavernToken = await getWorkspaceContractAt("TavernToken", tavernTokenDeploy.address, signer);
  const tavernRegistry = await getWorkspaceContractAt("TavernRegistry", tavernRegistryDeploy.address, signer);
  const tavernEscrow = await getWorkspaceContractAt("TavernEscrow", tavernEscrowDeploy.address, signer);
  const tavernStaking = await getWorkspaceContractAt("TavernStaking", tavernStakingDeploy.address, signer);
  const tavernAutomationRouter = await getWorkspaceContractAt(
    "TavernAutomationRouter",
    tavernAutomationRouterDeploy.address,
    signer
  );
  const tavernClientRPG = await getWorkspaceContractAt("TavernClientRPG", tavernClientRPGDeploy.address, signer);
  const tavernSubscription = await getWorkspaceContractAt(
    "TavernSubscription",
    tavernSubscriptionDeploy.address,
    signer
  );

  const rolesGranted: RoleGrantRecord[] = [];

  await ensureRole(tavernToken, "TavernToken", await tavernToken.MINTER_ROLE(), tavernRegistryDeploy.address, rolesGranted);
  await ensureRole(tavernToken, "TavernToken", await tavernToken.MINTER_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(tavernToken, "TavernToken", await tavernToken.MINTER_ROLE(), tavernClientRPGDeploy.address, rolesGranted);
  await ensureRole(tavernToken, "TavernToken", await tavernToken.ESCROW_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(tavernToken, "TavernToken", await tavernToken.BURNER_ROLE(), tavernStakingDeploy.address, rolesGranted);
  await ensureRole(tavernToken, "TavernToken", await tavernToken.GOVERNANCE_ROLE(), tavernGovernanceDeploy.address, rolesGranted);

  await ensureRole(tavernRegistry, "TavernRegistry", await tavernRegistry.ARBITER_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(tavernRegistry, "TavernRegistry", await tavernRegistry.ARBITER_ROLE(), arbiterAddress, rolesGranted);
  await ensureRole(tavernRegistry, "TavernRegistry", await tavernRegistry.KEEPER_ROLE(), tavernAutomationRouterDeploy.address, rolesGranted);
  await ensureRole(tavernRegistry, "TavernRegistry", await tavernRegistry.KEEPER_ROLE(), deployer.address, rolesGranted);

  await ensureRole(tavernEscrow, "TavernEscrow", await tavernEscrow.KEEPER_ROLE(), tavernAutomationRouterDeploy.address, rolesGranted);
  await ensureRole(tavernEscrow, "TavernEscrow", await tavernEscrow.KEEPER_ROLE(), deployer.address, rolesGranted);
  await ensureRole(tavernEscrow, "TavernEscrow", await tavernEscrow.GOVERNANCE_ROLE(), tavernGovernanceDeploy.address, rolesGranted);

  await ensureRole(tavernStaking, "TavernStaking", await tavernStaking.SLASHER_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(tavernStaking, "TavernStaking", await tavernStaking.SLASHER_ROLE(), deployer.address, rolesGranted);

  await ensureRole(
    tavernAutomationRouter,
    "TavernAutomationRouter",
    await tavernAutomationRouter.KEEPER_ROLE(),
    deployer.address,
    rolesGranted
  );
  await ensureRole(
    tavernAutomationRouter,
    "TavernAutomationRouter",
    await tavernAutomationRouter.KEEPER_ROLE(),
    keeperAddress,
    rolesGranted
  );

  await ensureRole(tavernClientRPG, "TavernClientRPG", await tavernClientRPG.ESCROW_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(tavernClientRPG, "TavernClientRPG", await tavernClientRPG.KEEPER_ROLE(), tavernAutomationRouterDeploy.address, rolesGranted);
  await ensureRole(
    tavernClientRPG,
    "TavernClientRPG",
    await tavernClientRPG.SUBSCRIPTION_ROLE(),
    tavernSubscriptionDeploy.address,
    rolesGranted
  );
  await ensureRole(
    tavernSubscription,
    "TavernSubscription",
    await tavernSubscription.KEEPER_ROLE(),
    tavernAutomationRouterDeploy.address,
    rolesGranted
  );

  const transactionHashes: Record<string, string> = {
    adminPriceFeedDeploy: adminPriceFeedDeploy.txHash,
    tavernTokenDeploy: tavernTokenDeploy.txHash,
    tavernRegistryDeploy: tavernRegistryDeploy.txHash,
    tavernEscrowDeploy: tavernEscrowDeploy.txHash,
    tavernStakingDeploy: tavernStakingDeploy.txHash,
    tavernGovernanceDeploy: tavernGovernanceDeploy.txHash,
    tavernAutomationRouterDeploy: tavernAutomationRouterDeploy.txHash,
    tavernClientRPGDeploy: tavernClientRPGDeploy.txHash,
    tavernSubscriptionDeploy: tavernSubscriptionDeploy.txHash
  };

  const currentStakingAddress = await tavernRegistry.stakingContract();
  if (ethers.getAddress(currentStakingAddress) !== tavernStakingDeploy.address) {
    const tx = await tavernRegistry.setStakingContract(tavernStakingDeploy.address);
    await tx.wait();
    transactionHashes.stakingContractSet = tx.hash;
  } else {
    transactionHashes.stakingContractSet = "";
  }

  if (await adminPriceFeed.isRefresher(tavernAutomationRouterDeploy.address)) {
    rolesGranted.push({
      contract: "AdminPriceFeed",
      role: "REFRESHER",
      grantee: tavernAutomationRouterDeploy.address,
      txHash: null,
      status: "already-granted"
    });
    transactionHashes.adminPriceFeedRefresherSet = "";
  } else {
    const tx = await adminPriceFeed.setRefresher(tavernAutomationRouterDeploy.address, true);
    await tx.wait();
    rolesGranted.push({
      contract: "AdminPriceFeed",
      role: "REFRESHER",
      grantee: tavernAutomationRouterDeploy.address,
      txHash: tx.hash,
      status: "granted"
    });
    transactionHashes.adminPriceFeedRefresherSet = tx.hash;
  }

  const escrowSetClientRPGTx = await tavernEscrow.setClientRPG(tavernClientRPGDeploy.address);
  await escrowSetClientRPGTx.wait();
  transactionHashes.escrowSetClientRPG = escrowSetClientRPGTx.hash;

  const routerSetClientRPGTx = await tavernAutomationRouter.setClientRPG(tavernClientRPGDeploy.address);
  await routerSetClientRPGTx.wait();
  transactionHashes.routerSetClientRPG = routerSetClientRPGTx.hash;

  const subscriptionSetClientRPGTx = await tavernSubscription.setClientRPG(tavernClientRPGDeploy.address);
  await subscriptionSetClientRPGTx.wait();
  transactionHashes.subscriptionSetClientRPG = subscriptionSetClientRPGTx.hash;

  const routerSetSubscriptionTx = await tavernAutomationRouter.setSubscriptionContract(tavernSubscriptionDeploy.address);
  await routerSetSubscriptionTx.wait();
  transactionHashes.routerSetSubscription = routerSetSubscriptionTx.hash;

  const notes = new Set<string>();
  notes.add("Task 29 replaces the old incremental Phase 2 plan with a full 9-contract Base Sepolia redeploy.");
  notes.add("Task 29 wires TavernClientRPG and TavernSubscription into the same live set as TavernEscrow and TavernAutomationRouter.");
  notes.add("Task 28-A immediate settlement is live in this deploy path: TavernSubscription sends 95% to the agent and 5% to operatorWallet in subscribe().");
  notes.add("Old Sepolia automation upkeeps must be cancelled and replaced because the new router address supersedes the Task 25 router.");
  notes.add(`Task 29 operator wallet on Base Sepolia: ${operatorWallet}.`);

  const nextManifest: DeploymentManifest = {
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId),
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? DEFAULT_BASE_SEPOLIA_RPC_URL
    },
    deployer: deployer.address,
    addresses: {
      adminPriceFeed: adminPriceFeedDeploy.address,
      mockUsdc: previousManifest?.addresses.mockUsdc ?? null,
      tavernToken: tavernTokenDeploy.address,
      tavernRegistry: tavernRegistryDeploy.address,
      tavernEscrow: tavernEscrowDeploy.address,
      tavernStaking: tavernStakingDeploy.address,
      tavernGovernance: tavernGovernanceDeploy.address,
      tavernAutomationRouter: tavernAutomationRouterDeploy.address,
      tavernClientRPG: tavernClientRPGDeploy.address,
      tavernSubscription: tavernSubscriptionDeploy.address
    },
    constructorArgs: {
      adminPriceFeed: {
        initialPrice: ADMIN_TVRN_USD_INITIAL_PRICE
      },
      tavernToken: null,
      tavernRegistry: {
        guildToken: tavernTokenDeploy.address
      },
      tavernEscrow: {
        usdc,
        tavernToken: tavernTokenDeploy.address,
        registry: tavernRegistryDeploy.address,
        ethUsdFeed,
        tvrnUsdFeed: adminPriceFeedDeploy.address
      },
      tavernStaking: {
        tavernToken: tavernTokenDeploy.address,
        registry: tavernRegistryDeploy.address
      },
      tavernGovernance: {
        tavernToken: tavernTokenDeploy.address,
        registry: tavernRegistryDeploy.address
      },
      tavernAutomationRouter: {
        escrow: tavernEscrowDeploy.address,
        registry: tavernRegistryDeploy.address,
        priceFeed: adminPriceFeedDeploy.address
      },
      tavernClientRPG: {
        tavernToken: tavernTokenDeploy.address,
        escrow: tavernEscrowDeploy.address
      },
      tavernSubscription: {
        usdc,
        operatorWallet,
        registry: tavernRegistryDeploy.address
      }
    },
    optionalRoleTargets: {
      arbiterAddress,
      keeperAddress,
      operatorWallet
    },
    rolesGranted,
    notes: Array.from(notes),
    legacyAddresses: buildLegacyRecord(previousManifest),
    task29FullRedeploy: {
      executedAt: new Date().toISOString(),
      mode: "full-9-contract",
      transactionHashes,
      verification: {
        adminPriceFeed: false,
        tavernToken: false,
        tavernRegistry: false,
        tavernEscrow: false,
        tavernStaking: false,
        tavernGovernance: false,
        tavernAutomationRouter: false,
        tavernClientRPG: false,
        tavernSubscription: false
      },
      smokeTestPath: "test/phase2-smoke-baseSepolia.json",
      automationManifestPath: AUTOMATION_PATH,
      nextStep:
        "Cancel the old Sepolia upkeep, register a new router upkeep, grant the new forwarder KEEPER_ROLE on TavernAutomationRouter, then run phase2-readonly-smoke.ts."
    }
  };

  await mkdir(path.dirname(DEPLOYMENT_PATH), { recursive: true });
  await writeFile(DEPLOYMENT_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

  await updateFrontendAddresses([
    { oldAddress: oldAddresses.adminPriceFeed ?? null, newAddress: adminPriceFeedDeploy.address },
    { oldAddress: oldAddresses.tavernToken ?? null, newAddress: tavernTokenDeploy.address },
    { oldAddress: oldAddresses.tavernRegistry ?? null, newAddress: tavernRegistryDeploy.address },
    { oldAddress: oldAddresses.tavernEscrow ?? null, newAddress: tavernEscrowDeploy.address },
    { oldAddress: oldAddresses.tavernStaking ?? null, newAddress: tavernStakingDeploy.address },
    { oldAddress: oldAddresses.tavernGovernance ?? null, newAddress: tavernGovernanceDeploy.address },
    { oldAddress: oldAddresses.tavernAutomationRouter ?? null, newAddress: tavernAutomationRouterDeploy.address },
    { oldAddress: oldAddresses.tavernClientRPG ?? null, newAddress: tavernClientRPGDeploy.address },
    { oldAddress: oldAddresses.tavernSubscription ?? null, newAddress: tavernSubscriptionDeploy.address }
  ]);

  const verification = {
    adminPriceFeed: await verifyContract("AdminPriceFeed", adminPriceFeedDeploy.address, [ADMIN_TVRN_USD_INITIAL_PRICE]),
    tavernToken: await verifyContract("TavernToken", tavernTokenDeploy.address, []),
    tavernRegistry: await verifyContract("TavernRegistry", tavernRegistryDeploy.address, [tavernTokenDeploy.address]),
    tavernEscrow: await verifyContract("TavernEscrow", tavernEscrowDeploy.address, [
      usdc,
      tavernTokenDeploy.address,
      tavernRegistryDeploy.address,
      ethUsdFeed,
      adminPriceFeedDeploy.address
    ]),
    tavernStaking: await verifyContract("TavernStaking", tavernStakingDeploy.address, [
      tavernTokenDeploy.address,
      tavernRegistryDeploy.address
    ]),
    tavernGovernance: await verifyContract("TavernGovernance", tavernGovernanceDeploy.address, [
      tavernTokenDeploy.address,
      tavernRegistryDeploy.address
    ]),
    tavernAutomationRouter: await verifyContract("TavernAutomationRouter", tavernAutomationRouterDeploy.address, [
      tavernEscrowDeploy.address,
      tavernRegistryDeploy.address,
      adminPriceFeedDeploy.address
    ]),
    tavernClientRPG: await verifyContract("TavernClientRPG", tavernClientRPGDeploy.address, [
      tavernTokenDeploy.address,
      tavernEscrowDeploy.address
    ]),
    tavernSubscription: await verifyContract("TavernSubscription", tavernSubscriptionDeploy.address, [
      usdc,
      operatorWallet,
      tavernRegistryDeploy.address
    ])
  };

  nextManifest.task29FullRedeploy = {
    ...nextManifest.task29FullRedeploy!,
    verification
  };
  await writeFile(DEPLOYMENT_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

  console.log(`Task 29 Sepolia full redeploy complete on ${network.name}`);
  console.log(`AdminPriceFeed:          ${adminPriceFeedDeploy.address}`);
  console.log(`TavernToken:             ${tavernTokenDeploy.address}`);
  console.log(`TavernRegistry:          ${tavernRegistryDeploy.address}`);
  console.log(`TavernEscrow:            ${tavernEscrowDeploy.address}`);
  console.log(`TavernStaking:           ${tavernStakingDeploy.address}`);
  console.log(`TavernGovernance:        ${tavernGovernanceDeploy.address}`);
  console.log(`TavernAutomationRouter:  ${tavernAutomationRouterDeploy.address}`);
  console.log(`TavernClientRPG:         ${tavernClientRPGDeploy.address}`);
  console.log(`TavernSubscription:      ${tavernSubscriptionDeploy.address}`);
  console.log("Run `npm run register:automation` after cancelling the old upkeep, then `npm run verify:automation` and `npm run smoke:phase2:baseSepolia`.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
