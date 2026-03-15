import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt, getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const { ethers, network, run } = hre;

const BASE_MAINNET_CHAIN_ID = 8453n;
const DEFAULT_BASE_MAINNET_RPC_URL = "https://mainnet.base.org";
const DEPLOYMENT_PATH = path.join(process.cwd(), "deployments", "base.json");
const AUTOMATION_PATH = path.join(process.cwd(), "deployments", "base.automation.json");
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

function flagEnabled(value: string | undefined | null): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
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

async function assertContractCode(address: string, label: string): Promise<void> {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(`${label} points to an address with no deployed code: ${address}`);
  }
}

async function estimateDeployment(
  label: string,
  factory: any,
  deployArgs: unknown[],
  from: string
): Promise<void> {
  const txRequest = await factory.getDeployTransaction(...deployArgs);
  txRequest.from = from;

  const [gasEstimate, feeData] = await Promise.all([
    ethers.provider.estimateGas(txRequest),
    ethers.provider.getFeeData()
  ]);

  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("1", "gwei");
  const estimatedCostWei = gasEstimate * gasPrice;

  console.log(
    `${label} estimate: gas=${gasEstimate.toString()} price=${ethers.formatUnits(gasPrice, "gwei")} gwei approxCost=${ethers.formatEther(estimatedCostWei)} ETH`
  );
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
  deployArgs: unknown[],
  estimateFrom: string
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

  await estimateDeployment(contractName, factory, deployArgs, estimateFrom);
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
      label: "Task 26 live Base mainnet set",
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
      note: "Superseded by Task 29 full 9-contract Base mainnet redeploy."
    }
  ];
}

async function main(): Promise<void> {
  if (!flagEnabled(process.env.MAINNET_CONFIRM)) {
    throw new Error("Refusing to send Base mainnet transactions. Set MAINNET_CONFIRM=true to continue.");
  }

  await run("compile", { quiet: true, force: true });

  const [deployer] = await ethers.getSigners();
  const signer = new ethers.NonceManager(deployer);
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== BASE_MAINNET_CHAIN_ID) {
    throw new Error(
      `deploy/08_mainnet_deploy.ts only supports Base mainnet (8453). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const previousManifest = await readDeploymentManifest();
  const deploymentBackup = await backupFile(DEPLOYMENT_PATH, "base.v1-backup.json");
  const automationBackup = await backupFile(AUTOMATION_PATH, "base.automation.v1-backup.json");

  if (deploymentBackup) {
    console.log(`Backed up deployment manifest to ${deploymentBackup}`);
  }
  if (automationBackup) {
    console.log(`Backed up automation manifest to ${automationBackup}`);
  }

  const deployerAddress = await signer.getAddress();
  const deployerBalance = await ethers.provider.getBalance(deployerAddress);
  console.log(`Deploying to Base mainnet as ${deployerAddress}`);
  console.log(`Deployer balance: ${ethers.formatEther(deployerBalance)} ETH`);

  const keeperAddress = validateAddress(
    "MAINNET_KEEPER_ADDRESS",
    readFirstEnv(["MAINNET_KEEPER_ADDRESS"]) ?? previousManifest?.optionalRoleTargets?.keeperAddress ?? deployerAddress
  );
  const arbiterAddress = validateAddress(
    "MAINNET_ARBITER_ADDRESS",
    readFirstEnv(["MAINNET_ARBITER_ADDRESS"]) ?? previousManifest?.optionalRoleTargets?.arbiterAddress ?? deployerAddress
  );
  const operatorWallet = validateAddress(
    "MAINNET_SUBSCRIPTION_OPERATOR_WALLET",
    readFirstEnv([
      "MAINNET_SUBSCRIPTION_OPERATOR_WALLET",
      "MAINNET_OPERATOR_WALLET",
      "OPERATOR_WALLET",
      "SUBSCRIPTION_OPERATOR_WALLET"
    ]) ?? previousManifest?.optionalRoleTargets?.operatorWallet ?? deployerAddress
  );

  const previousEscrowArgs = previousManifest?.constructorArgs?.tavernEscrow;
  const usdc = validateAddress(
    "MAINNET_USDC_ADDRESS",
    readFirstEnv(["MAINNET_USDC_ADDRESS"]) ?? previousEscrowArgs?.usdc
  );
  const ethUsdFeed = validateAddress(
    "MAINNET_ETH_USD_FEED",
    readFirstEnv(["MAINNET_ETH_USD_FEED"]) ?? previousEscrowArgs?.ethUsdFeed
  );

  await assertContractCode(usdc, "MAINNET_USDC_ADDRESS");
  await assertContractCode(ethUsdFeed, "MAINNET_ETH_USD_FEED");

  const shouldDeployAdminPriceFeed = flagEnabled(process.env.MAINNET_DEPLOY_TVRN_FEED)
    || Boolean(readFirstEnv(["MAINNET_REUSE_TVRN_FEED_ADDRESS"]));

  if (!shouldDeployAdminPriceFeed) {
    throw new Error(
      "Task 29 full redeploy requires a deployed or reused AdminPriceFeed. Set MAINNET_DEPLOY_TVRN_FEED=true or MAINNET_REUSE_TVRN_FEED_ADDRESS."
    );
  }

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
    ["MAINNET_REUSE_TVRN_FEED_ADDRESS"],
    ["MAINNET_REUSE_TVRN_FEED_TX_HASH"],
    AdminPriceFeedFactory,
    "AdminPriceFeed",
    signer,
    [ADMIN_TVRN_USD_INITIAL_PRICE],
    deployerAddress
  );
  const tavernTokenDeploy = await resolveFreshOrReused(
    ["MAINNET_REUSE_TOKEN_ADDRESS"],
    ["MAINNET_REUSE_TOKEN_TX_HASH"],
    TavernTokenFactory,
    "TavernToken",
    signer,
    [],
    deployerAddress
  );
  const tavernRegistryDeploy = await resolveFreshOrReused(
    ["MAINNET_REUSE_REGISTRY_ADDRESS"],
    ["MAINNET_REUSE_REGISTRY_TX_HASH"],
    TavernRegistryFactory,
    "TavernRegistry",
    signer,
    [tavernTokenDeploy.address],
    deployerAddress
  );
  const tavernEscrowDeploy = await resolveFreshOrReused(
    ["MAINNET_REUSE_ESCROW_ADDRESS"],
    ["MAINNET_REUSE_ESCROW_TX_HASH"],
    TavernEscrowFactory,
    "TavernEscrow",
    signer,
    [
      usdc,
      tavernTokenDeploy.address,
      tavernRegistryDeploy.address,
      ethUsdFeed,
      adminPriceFeedDeploy.address
    ],
    deployerAddress
  );
  const tavernStakingDeploy = await resolveFreshOrReused(
    ["MAINNET_REUSE_STAKING_ADDRESS"],
    ["MAINNET_REUSE_STAKING_TX_HASH"],
    TavernStakingFactory,
    "TavernStaking",
    signer,
    [tavernTokenDeploy.address, tavernRegistryDeploy.address],
    deployerAddress
  );
  const tavernGovernanceDeploy = await resolveFreshOrReused(
    ["MAINNET_REUSE_GOVERNANCE_ADDRESS"],
    ["MAINNET_REUSE_GOVERNANCE_TX_HASH"],
    TavernGovernanceFactory,
    "TavernGovernance",
    signer,
    [tavernTokenDeploy.address, tavernRegistryDeploy.address],
    deployerAddress
  );
  const tavernAutomationRouterDeploy = await resolveFreshOrReused(
    ["MAINNET_REUSE_ROUTER_ADDRESS"],
    ["MAINNET_REUSE_ROUTER_TX_HASH"],
    TavernAutomationRouterFactory,
    "TavernAutomationRouter",
    signer,
    [tavernEscrowDeploy.address, tavernRegistryDeploy.address, adminPriceFeedDeploy.address],
    deployerAddress
  );
  const tavernClientRPGDeploy = await resolveFreshOrReused(
    ["MAINNET_REUSE_CLIENT_RPG_ADDRESS"],
    ["MAINNET_REUSE_CLIENT_RPG_TX_HASH"],
    TavernClientRPGFactory,
    "TavernClientRPG",
    signer,
    [tavernTokenDeploy.address, tavernEscrowDeploy.address],
    deployerAddress
  );
  const tavernSubscriptionDeploy = await resolveFreshOrReused(
    ["MAINNET_REUSE_SUBSCRIPTION_ADDRESS"],
    ["MAINNET_REUSE_SUBSCRIPTION_TX_HASH"],
    TavernSubscriptionFactory,
    "TavernSubscription",
    signer,
    [usdc, operatorWallet, tavernRegistryDeploy.address],
    deployerAddress
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
  await ensureRole(tavernRegistry, "TavernRegistry", await tavernRegistry.KEEPER_ROLE(), deployerAddress, rolesGranted);

  await ensureRole(tavernEscrow, "TavernEscrow", await tavernEscrow.KEEPER_ROLE(), tavernAutomationRouterDeploy.address, rolesGranted);
  await ensureRole(tavernEscrow, "TavernEscrow", await tavernEscrow.KEEPER_ROLE(), deployerAddress, rolesGranted);
  await ensureRole(tavernEscrow, "TavernEscrow", await tavernEscrow.GOVERNANCE_ROLE(), tavernGovernanceDeploy.address, rolesGranted);

  await ensureRole(tavernStaking, "TavernStaking", await tavernStaking.SLASHER_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(tavernStaking, "TavernStaking", await tavernStaking.SLASHER_ROLE(), deployerAddress, rolesGranted);

  await ensureRole(
    tavernAutomationRouter,
    "TavernAutomationRouter",
    await tavernAutomationRouter.KEEPER_ROLE(),
    deployerAddress,
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
  notes.add("Task 29 replaces the old incremental Phase 2 plan with a full 9-contract Base mainnet redeploy.");
  notes.add("Task 29 wires TavernClientRPG and TavernSubscription into the same live set as TavernEscrow and TavernAutomationRouter.");
  notes.add("Task 28-A immediate settlement is live in this deploy path: TavernSubscription sends 95% to the agent and 5% to operatorWallet in subscribe().");
  notes.add("Old Base mainnet automation upkeeps must be cancelled and replaced because the new router address supersedes the Task 26 router.");
  notes.add(`Task 29 operator wallet on Base mainnet: ${operatorWallet}.`);

  const nextManifest: DeploymentManifest = {
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId),
      rpcUrl: process.env.BASE_MAINNET_RPC_URL ?? DEFAULT_BASE_MAINNET_RPC_URL
    },
    deployer: deployerAddress,
    addresses: {
      adminPriceFeed: adminPriceFeedDeploy.address,
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
      smokeTestPath: "test/phase2-smoke-base.json",
      automationManifestPath: AUTOMATION_PATH,
      nextStep:
        "Cancel the old mainnet upkeep, register a new router upkeep, grant the new forwarder KEEPER_ROLE on TavernAutomationRouter, then run phase2-readonly-smoke.ts."
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

  console.log(`Task 29 Base mainnet full redeploy complete on ${network.name}`);
  console.log(`AdminPriceFeed:          ${adminPriceFeedDeploy.address}`);
  console.log(`TavernToken:             ${tavernTokenDeploy.address}`);
  console.log(`TavernRegistry:          ${tavernRegistryDeploy.address}`);
  console.log(`TavernEscrow:            ${tavernEscrowDeploy.address}`);
  console.log(`TavernStaking:           ${tavernStakingDeploy.address}`);
  console.log(`TavernGovernance:        ${tavernGovernanceDeploy.address}`);
  console.log(`TavernAutomationRouter:  ${tavernAutomationRouterDeploy.address}`);
  console.log(`TavernClientRPG:         ${tavernClientRPGDeploy.address}`);
  console.log(`TavernSubscription:      ${tavernSubscriptionDeploy.address}`);
  console.log("Cancel the old upkeep, then run `npm run register:automation:base`, `npm run verify:automation:base`, and `npm run smoke:phase2:base`.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
