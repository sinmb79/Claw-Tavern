import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt, getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";
import {
  buildCatalog,
  categoryEnumValue,
  rarityEnumValue,
  slotEnumValue
} from "../scripts/nft/shared";

const { ethers, network, run } = hre;

const ADMIN_TVRN_USD_INITIAL_PRICE = 1_000_000;
const APP_FRONTEND_PATH = path.join(process.cwd(), "app.html");
const ADMIN_FRONTEND_PATH = path.join(process.cwd(), "admin.html");

const ORPHAN_CONTRACTS = [
  {
    name: "TavernEquipment",
    address: "0xB2bC6f79c438449989a8676cB6d528DcBa152f34",
    note: "Ignored orphan from failed incremental NFT deploy attempt."
  },
  {
    name: "TavernGuild",
    address: "0x88DE4bc7bAb20a3B558887Eb528c148cEeE39909",
    note: "Ignored orphan from failed incremental NFT deploy attempt."
  }
] as const;

const LEVEL_REWARD_MAP: Record<number, number[]> = {
  1: [1, 11, 21, 31, 41, 51, 61],
  2: [3, 13, 23, 33, 53, 63],
  3: [5, 25, 43, 65],
  4: [15, 35, 45, 55],
  5: [7, 27, 67],
  6: [17, 37],
  7: [47, 57],
  8: [9, 29, 69],
  9: [19, 39],
  10: [50, 70]
};

const ADDRESS_KEYS = [
  "adminPriceFeed",
  "tavernToken",
  "tavernRegistry",
  "tavernEscrow",
  "tavernStaking",
  "tavernGovernance",
  "tavernAutomationRouter",
  "tavernClientRPG",
  "tavernSubscription",
  "tavernEquipment",
  "tavernGuild",
  "tavernServiceRegistry",
  "tavernMatchmaker"
] as const;

const NETWORKS = {
  baseSepolia: {
    chainId: 84532n,
    manifestPath: path.join(process.cwd(), "deployments", "baseSepolia.json"),
    automationPath: path.join(process.cwd(), "deployments", "baseSepolia.automation.json"),
    backupFileName: "baseSepolia.task36-backup.json",
    automationBackupFileName: "baseSepolia.automation.task36-backup.json",
    rpcUrlEnvName: "BASE_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://base-sepolia-rpc.publicnode.com",
    frontendKey: "baseSepolia",
    scriptSuffix: "baseSepolia",
    requireConfirm: false,
    minBalanceWei: 0n,
    env: {
      usdc: ["BASE_SEPOLIA_USDC_ADDRESS"],
      ethUsdFeed: ["BASE_SEPOLIA_ETH_USD_FEED"],
      keeper: ["BASE_SEPOLIA_KEEPER_ADDRESS", "KEEPER_ADDRESS"],
      arbiter: ["BASE_SEPOLIA_ARBITER_ADDRESS", "ARBITER_ADDRESS"],
      operatorWallet: [
        "BASE_SEPOLIA_SUBSCRIPTION_OPERATOR_WALLET",
        "BASE_SEPOLIA_OPERATOR_WALLET",
        "OPERATOR_WALLET",
        "SUBSCRIPTION_OPERATOR_WALLET"
      ],
      reuse: {
        adminPriceFeed: ["REUSE_ADMIN_PRICE_FEED", "REUSE_ADMIN_PRICE_FEED_ADDRESS"],
        tavernToken: ["REUSE_TAVERN_TOKEN", "REUSE_TAVERN_TOKEN_ADDRESS", "REUSE_TOKEN_ADDRESS"],
        tavernRegistry: ["REUSE_TAVERN_REGISTRY", "REUSE_TAVERN_REGISTRY_ADDRESS", "REUSE_REGISTRY_ADDRESS"],
        tavernEscrow: ["REUSE_TAVERN_ESCROW", "REUSE_TAVERN_ESCROW_ADDRESS", "REUSE_ESCROW_ADDRESS"],
        tavernStaking: ["REUSE_TAVERN_STAKING", "REUSE_TAVERN_STAKING_ADDRESS", "REUSE_STAKING_ADDRESS"],
        tavernGovernance: [
          "REUSE_TAVERN_GOVERNANCE",
          "REUSE_TAVERN_GOVERNANCE_ADDRESS",
          "REUSE_GOVERNANCE_ADDRESS"
        ],
        tavernAutomationRouter: [
          "REUSE_TAVERN_AUTOMATION_ROUTER",
          "REUSE_TAVERN_AUTOMATION_ROUTER_ADDRESS",
          "REUSE_ROUTER_ADDRESS"
        ],
        tavernClientRPG: ["REUSE_TAVERN_CLIENT_RPG", "REUSE_TAVERN_CLIENT_RPG_ADDRESS", "REUSE_CLIENT_RPG_ADDRESS"],
        tavernSubscription: [
          "REUSE_TAVERN_SUBSCRIPTION",
          "REUSE_TAVERN_SUBSCRIPTION_ADDRESS",
          "REUSE_SUBSCRIPTION_ADDRESS"
        ],
        tavernEquipment: ["REUSE_TAVERN_EQUIPMENT", "REUSE_TAVERN_EQUIPMENT_ADDRESS", "REUSE_EQUIPMENT_ADDRESS"],
        tavernGuild: ["REUSE_TAVERN_GUILD", "REUSE_TAVERN_GUILD_ADDRESS", "REUSE_GUILD_ADDRESS"],
        tavernServiceRegistry: [
          "REUSE_TAVERN_SERVICE_REGISTRY",
          "REUSE_TAVERN_SERVICE_REGISTRY_ADDRESS",
          "REUSE_SERVICE_REGISTRY_ADDRESS"
        ],
        tavernMatchmaker: ["REUSE_TAVERN_MATCHMAKER", "REUSE_TAVERN_MATCHMAKER_ADDRESS", "REUSE_MATCHMAKER_ADDRESS"]
      }
    }
  },
  base: {
    chainId: 8453n,
    manifestPath: path.join(process.cwd(), "deployments", "base.json"),
    automationPath: path.join(process.cwd(), "deployments", "base.automation.json"),
    backupFileName: "base.task36-backup.json",
    automationBackupFileName: "base.automation.task36-backup.json",
    rpcUrlEnvName: "BASE_MAINNET_RPC_URL",
    defaultRpcUrl: "https://mainnet.base.org",
    frontendKey: "base",
    scriptSuffix: "base",
    requireConfirm: true,
    minBalanceWei: ethers.parseEther("0.01"),
    env: {
      usdc: ["MAINNET_USDC_ADDRESS"],
      ethUsdFeed: ["MAINNET_ETH_USD_FEED"],
      keeper: ["MAINNET_KEEPER_ADDRESS"],
      arbiter: ["MAINNET_ARBITER_ADDRESS"],
      operatorWallet: [
        "MAINNET_SUBSCRIPTION_OPERATOR_WALLET",
        "MAINNET_OPERATOR_WALLET",
        "OPERATOR_WALLET",
        "SUBSCRIPTION_OPERATOR_WALLET"
      ],
      reuse: {
        adminPriceFeed: [
          "REUSE_ADMIN_PRICE_FEED",
          "REUSE_ADMIN_PRICE_FEED_ADDRESS",
          "MAINNET_REUSE_TVRN_FEED_ADDRESS"
        ],
        tavernToken: ["REUSE_TAVERN_TOKEN", "REUSE_TAVERN_TOKEN_ADDRESS", "MAINNET_REUSE_TOKEN_ADDRESS"],
        tavernRegistry: [
          "REUSE_TAVERN_REGISTRY",
          "REUSE_TAVERN_REGISTRY_ADDRESS",
          "MAINNET_REUSE_REGISTRY_ADDRESS"
        ],
        tavernEscrow: ["REUSE_TAVERN_ESCROW", "REUSE_TAVERN_ESCROW_ADDRESS", "MAINNET_REUSE_ESCROW_ADDRESS"],
        tavernStaking: [
          "REUSE_TAVERN_STAKING",
          "REUSE_TAVERN_STAKING_ADDRESS",
          "MAINNET_REUSE_STAKING_ADDRESS"
        ],
        tavernGovernance: [
          "REUSE_TAVERN_GOVERNANCE",
          "REUSE_TAVERN_GOVERNANCE_ADDRESS",
          "MAINNET_REUSE_GOVERNANCE_ADDRESS"
        ],
        tavernAutomationRouter: [
          "REUSE_TAVERN_AUTOMATION_ROUTER",
          "REUSE_TAVERN_AUTOMATION_ROUTER_ADDRESS",
          "MAINNET_REUSE_ROUTER_ADDRESS"
        ],
        tavernClientRPG: [
          "REUSE_TAVERN_CLIENT_RPG",
          "REUSE_TAVERN_CLIENT_RPG_ADDRESS",
          "MAINNET_REUSE_CLIENT_RPG_ADDRESS"
        ],
        tavernSubscription: [
          "REUSE_TAVERN_SUBSCRIPTION",
          "REUSE_TAVERN_SUBSCRIPTION_ADDRESS",
          "MAINNET_REUSE_SUBSCRIPTION_ADDRESS"
        ],
        tavernEquipment: ["REUSE_TAVERN_EQUIPMENT", "REUSE_TAVERN_EQUIPMENT_ADDRESS", "MAINNET_REUSE_EQUIPMENT_ADDRESS"],
        tavernGuild: ["REUSE_TAVERN_GUILD", "REUSE_TAVERN_GUILD_ADDRESS", "MAINNET_REUSE_GUILD_ADDRESS"],
        tavernServiceRegistry: [
          "REUSE_TAVERN_SERVICE_REGISTRY",
          "REUSE_TAVERN_SERVICE_REGISTRY_ADDRESS",
          "MAINNET_REUSE_SERVICE_REGISTRY_ADDRESS"
        ],
        tavernMatchmaker: [
          "REUSE_TAVERN_MATCHMAKER",
          "REUSE_TAVERN_MATCHMAKER_ADDRESS",
          "MAINNET_REUSE_MATCHMAKER_ADDRESS"
        ]
      }
    }
  }
} as const;

type DeployNetworkName = keyof typeof NETWORKS;
type ContractAddressKey = (typeof ADDRESS_KEYS)[number];
type ContractAddresses = Partial<Record<ContractAddressKey, string | null>>;

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
  tavernEquipment?: string | null;
  tavernGuild?: string | null;
  tavernServiceRegistry?: string | null;
  tavernMatchmaker?: string | null;
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
  addresses: ContractAddresses;
  constructorArgs?: Record<string, unknown>;
  optionalRoleTargets?: {
    arbiterAddress?: string | null;
    keeperAddress?: string | null;
    operatorWallet?: string | null;
  };
  rolesGranted?: RoleGrantRecord[];
  notes?: string[];
  legacyAddresses?: LegacyAddressRecord[];
  task36FullRedeploy?: {
    executedAt: string;
    mode: "full-13-contract";
    orphanContracts: Array<{ name: string; address: string; note: string }>;
    transactionHashes: Record<string, string>;
    verification: Record<ContractAddressKey, boolean>;
    verifyScriptPath: string;
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

function readFirstEnv(names: readonly string[]): string | null {
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

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function backupFile(filePath: string, backupName: string): Promise<string | null> {
  try {
    const contents = await readFile(filePath, "utf8");
    const backupPath = path.join(path.dirname(filePath), backupName);
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

async function ensureRefresher(
  adminPriceFeed: any,
  routerAddress: string,
  records: RoleGrantRecord[],
  txHashes: Record<string, string>
): Promise<void> {
  if (await adminPriceFeed.isRefresher(routerAddress)) {
    records.push({
      contract: "AdminPriceFeed",
      role: "REFRESHER",
      grantee: routerAddress,
      txHash: null,
      status: "already-granted"
    });
    txHashes.adminPriceFeedRefresherSet = "";
    return;
  }

  const tx = await adminPriceFeed.setRefresher(routerAddress, true);
  await tx.wait();
  records.push({
    contract: "AdminPriceFeed",
    role: "REFRESHER",
    grantee: routerAddress,
    txHash: tx.hash,
    status: "granted"
  });
  txHashes.adminPriceFeedRefresherSet = tx.hash;
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

async function resolveFreshOrReused(
  envAddressNames: readonly string[],
  factory: any,
  contractName: string,
  signer: any,
  deployArgs: unknown[],
  estimateFrom: string
): Promise<DeploymentResult> {
  const reusedAddressRaw = readFirstEnv(envAddressNames);

  if (reusedAddressRaw) {
    const address = validateAddress(envAddressNames[0] ?? contractName, reusedAddressRaw);
    await assertContractCode(address, envAddressNames[0] ?? contractName);
    return {
      instance: await getWorkspaceContractAt(contractName, address, signer),
      address,
      txHash: "",
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

function buildThresholds(): bigint[] {
  const thresholds: bigint[] = [0n];
  for (let level = 1; level <= 100; level += 1) {
    thresholds.push(BigInt(Math.floor(20 * Math.pow(level, 2.2))));
  }
  return thresholds;
}

function normalizeGetterAddress(value: unknown): string | null {
  if (typeof value === "string" && ethers.isAddress(value)) {
    return ethers.getAddress(value);
  }
  return null;
}

async function ensureConfiguredAddress(
  currentAddress: (() => Promise<unknown>) | null,
  expectedAddress: string,
  setter: (value: string) => Promise<any>,
  txHashes: Record<string, string>,
  txKey: string
): Promise<void> {
  if (currentAddress) {
    try {
      const currentValue = normalizeGetterAddress(await currentAddress());
      if (currentValue && currentValue === expectedAddress) {
        txHashes[txKey] = "";
        return;
      }
    } catch {
      // fall through and set the new address
    }
  }

  const tx = await setter(expectedAddress);
  await tx.wait();
  txHashes[txKey] = tx.hash;
}

function buildLegacyRecord(previousManifest: DeploymentManifest | null): LegacyAddressRecord[] {
  const previousEntries = previousManifest?.legacyAddresses ?? [];
  if (!previousManifest?.addresses) {
    return previousEntries;
  }

  return [
    ...previousEntries,
    {
      label: previousManifest.task36FullRedeploy?.mode === "full-13-contract"
        ? "Previous Task 36 live set"
        : "Previous live set",
      adminPriceFeed: previousManifest.addresses.adminPriceFeed ?? null,
      tavernToken: previousManifest.addresses.tavernToken ?? null,
      tavernRegistry: previousManifest.addresses.tavernRegistry ?? null,
      tavernEscrow: previousManifest.addresses.tavernEscrow ?? null,
      tavernStaking: previousManifest.addresses.tavernStaking ?? null,
      tavernGovernance: previousManifest.addresses.tavernGovernance ?? null,
      tavernAutomationRouter: previousManifest.addresses.tavernAutomationRouter ?? null,
      tavernClientRPG: previousManifest.addresses.tavernClientRPG ?? null,
      tavernSubscription: previousManifest.addresses.tavernSubscription ?? null,
      tavernEquipment: previousManifest.addresses.tavernEquipment ?? null,
      tavernGuild: previousManifest.addresses.tavernGuild ?? null,
      tavernServiceRegistry: previousManifest.addresses.tavernServiceRegistry ?? null,
      tavernMatchmaker: previousManifest.addresses.tavernMatchmaker ?? null,
      supersededAt: new Date().toISOString(),
      note: "Superseded by Task 36 full 13-contract redeploy."
    }
  ];
}

function formatAppAddressBlock(addresses: Record<ContractAddressKey, string>, usdc: string): string {
  return [
    `          adminPriceFeed: "${addresses.adminPriceFeed}",`,
    `          tavernToken: "${addresses.tavernToken}",`,
    `          tavernRegistry: "${addresses.tavernRegistry}",`,
    `          tavernEscrow: "${addresses.tavernEscrow}",`,
    `          tavernStaking: "${addresses.tavernStaking}",`,
    `          tavernGovernance: "${addresses.tavernGovernance}",`,
    `          tavernAutomationRouter: "${addresses.tavernAutomationRouter}",`,
    `          tavernClientRPG: "${addresses.tavernClientRPG}",`,
    `          tavernSubscription: "${addresses.tavernSubscription}",`,
    `          tavernEquipment: "${addresses.tavernEquipment}",`,
    `          tavernGuild: "${addresses.tavernGuild}",`,
    `          tavernServiceRegistry: "${addresses.tavernServiceRegistry}",`,
    `          tavernMatchmaker: "${addresses.tavernMatchmaker}",`,
    `          usdc: "${usdc}"`
  ].join("\n");
}

function formatAdminAddressBlock(
  addresses: Record<ContractAddressKey, string>,
  usdc: string,
  operatorWallet: string
): string {
  return [
    `          adminPriceFeed: "${addresses.adminPriceFeed}",`,
    `          tavernToken: "${addresses.tavernToken}",`,
    `          tavernRegistry: "${addresses.tavernRegistry}",`,
    `          tavernEscrow: "${addresses.tavernEscrow}",`,
    `          tavernStaking: "${addresses.tavernStaking}",`,
    `          tavernGovernance: "${addresses.tavernGovernance}",`,
    `          tavernAutomationRouter: "${addresses.tavernAutomationRouter}",`,
    `          tavernClientRPG: "${addresses.tavernClientRPG}",`,
    `          tavernSubscription: "${addresses.tavernSubscription}",`,
    `          tavernEquipment: "${addresses.tavernEquipment}",`,
    `          tavernGuild: "${addresses.tavernGuild}",`,
    `          tavernServiceRegistry: "${addresses.tavernServiceRegistry}",`,
    `          tavernMatchmaker: "${addresses.tavernMatchmaker}",`,
    `          usdc: "${usdc}",`,
    `          operatorWallet: "${operatorWallet}"`
  ].join("\n");
}

async function updateAppHtml(
  frontendKey: "base" | "baseSepolia",
  addresses: Record<ContractAddressKey, string>,
  usdc: string
): Promise<void> {
  try {
    let html = await readFile(APP_FRONTEND_PATH, "utf8");
    const pattern = frontendKey === "baseSepolia"
      ? /(baseSepolia:\s*{[\s\S]*?addresses:\s*{)([\s\S]*?)(\n\s*}\n\s*},)/
      : /(base:\s*{[\s\S]*?addresses:\s*{)([\s\S]*?)(\n\s*}\n\s*})/;

    if (!pattern.test(html)) {
      throw new Error(`Unable to locate ${frontendKey} app address block.`);
    }

    html = html.replace(pattern, (_match, start, _current, end) => {
      return `${start}\n${formatAppAddressBlock(addresses, usdc)}${end}`;
    });

    await writeFile(APP_FRONTEND_PATH, html, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function updateAdminHtml(
  frontendKey: "base" | "baseSepolia",
  addresses: Record<ContractAddressKey, string>,
  usdc: string,
  operatorWallet: string
): Promise<void> {
  try {
    let html = await readFile(ADMIN_FRONTEND_PATH, "utf8");
    const pattern = frontendKey === "baseSepolia"
      ? /(baseSepolia:\s*{[\s\S]*?addresses:\s*{)([\s\S]*?)(\n\s*},\n\s*automation:)/
      : /(base:\s*{[\s\S]*?addresses:\s*{)([\s\S]*?)(\n\s*},\n\s*automation:)/;

    if (!pattern.test(html)) {
      throw new Error(`Unable to locate ${frontendKey} admin address block.`);
    }

    html = html.replace(pattern, (_match, start, _current, end) => {
      return `${start}\n${formatAdminAddressBlock(addresses, usdc, operatorWallet)}${end}`;
    });

    await writeFile(ADMIN_FRONTEND_PATH, html, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function updateFrontends(
  frontendKey: "base" | "baseSepolia",
  addresses: Record<ContractAddressKey, string>,
  usdc: string,
  operatorWallet: string
): Promise<void> {
  await updateAppHtml(frontendKey, addresses, usdc);
  await updateAdminHtml(frontendKey, addresses, usdc, operatorWallet);
}

async function main(): Promise<void> {
  if (!(network.name in NETWORKS)) {
    throw new Error(`deploy/11_full_redeploy_v2.ts only supports baseSepolia or base. Current network: ${network.name}`);
  }

  const config = NETWORKS[network.name as DeployNetworkName];

  if (config.requireConfirm && !flagEnabled(process.env.MAINNET_CONFIRM)) {
    throw new Error("Refusing to send Base mainnet transactions. Set MAINNET_CONFIRM=true to continue.");
  }

  const nftBaseUriRaw = process.env.NFT_BASE_URI?.trim();
  if (!nftBaseUriRaw) {
    throw new Error("NFT_BASE_URI must be set before running the full v2 redeploy.");
  }
  const nftBaseUri = nftBaseUriRaw.endsWith("/") ? nftBaseUriRaw : `${nftBaseUriRaw}/`;

  await run("compile", { quiet: true, force: true });

  const [deployer] = await ethers.getSigners();
  const signer = new ethers.NonceManager(deployer);
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== config.chainId) {
    throw new Error(
      `deploy/11_full_redeploy_v2.ts expected chainId ${config.chainId.toString()}, connected chainId ${currentNetwork.chainId.toString()}`
    );
  }

  const previousManifest = await readJsonFile<DeploymentManifest>(config.manifestPath);
  const deploymentBackup = await backupFile(config.manifestPath, config.backupFileName);
  const automationBackup = await backupFile(config.automationPath, config.automationBackupFileName);

  if (deploymentBackup) {
    console.log(`Backed up deployment manifest to ${deploymentBackup}`);
  }
  if (automationBackup) {
    console.log(`Backed up automation manifest to ${automationBackup}`);
  }

  const deployerAddress = await signer.getAddress();
  const deployerBalance = await ethers.provider.getBalance(deployerAddress);
  if (deployerBalance < config.minBalanceWei) {
    throw new Error(
      `Deployer balance ${ethers.formatEther(deployerBalance)} ETH is below required minimum ${ethers.formatEther(config.minBalanceWei)} ETH.`
    );
  }

  console.log(`Deploying Task 36 full set to ${network.name} as ${deployerAddress}`);
  console.log(`Deployer balance: ${ethers.formatEther(deployerBalance)} ETH`);

  const keeperAddress = validateAddress(
    config.env.keeper[0] ?? "KEEPER_ADDRESS",
    readFirstEnv(config.env.keeper) ?? previousManifest?.optionalRoleTargets?.keeperAddress ?? deployerAddress
  );
  const arbiterAddress = validateAddress(
    config.env.arbiter[0] ?? "ARBITER_ADDRESS",
    readFirstEnv(config.env.arbiter) ?? previousManifest?.optionalRoleTargets?.arbiterAddress ?? deployerAddress
  );
  const operatorWallet = validateAddress(
    config.env.operatorWallet[0] ?? "OPERATOR_WALLET",
    readFirstEnv(config.env.operatorWallet) ?? previousManifest?.optionalRoleTargets?.operatorWallet ?? deployerAddress
  );

  const previousEscrowArgs = previousManifest?.constructorArgs?.tavernEscrow as
    | { usdc?: string; ethUsdFeed?: string }
    | undefined;
  const usdc = validateAddress(
    config.env.usdc[0] ?? "USDC_ADDRESS",
    readFirstEnv(config.env.usdc) ?? previousEscrowArgs?.usdc
  );
  const ethUsdFeed = validateAddress(
    config.env.ethUsdFeed[0] ?? "ETH_USD_FEED",
    readFirstEnv(config.env.ethUsdFeed) ?? previousEscrowArgs?.ethUsdFeed
  );

  await assertContractCode(usdc, config.env.usdc[0] ?? "USDC_ADDRESS");
  await assertContractCode(ethUsdFeed, config.env.ethUsdFeed[0] ?? "ETH_USD_FEED");

  const AdminPriceFeedFactory = await getWorkspaceContractFactory("AdminPriceFeed", signer);
  const TavernTokenFactory = await getWorkspaceContractFactory("TavernToken", signer);
  const TavernRegistryFactory = await getWorkspaceContractFactory("TavernRegistry", signer);
  const TavernEscrowFactory = await getWorkspaceContractFactory("TavernEscrow", signer);
  const TavernStakingFactory = await getWorkspaceContractFactory("TavernStaking", signer);
  const TavernGovernanceFactory = await getWorkspaceContractFactory("TavernGovernance", signer);
  const TavernAutomationRouterFactory = await getWorkspaceContractFactory("TavernAutomationRouter", signer);
  const TavernClientRPGFactory = await getWorkspaceContractFactory("TavernClientRPG", signer);
  const TavernSubscriptionFactory = await getWorkspaceContractFactory("TavernSubscription", signer);
  const TavernEquipmentFactory = await getWorkspaceContractFactory("TavernEquipment", signer);
  const TavernGuildFactory = await getWorkspaceContractFactory("TavernGuild", signer);
  const TavernServiceRegistryFactory = await getWorkspaceContractFactory("TavernServiceRegistry", signer);
  const TavernMatchmakerFactory = await getWorkspaceContractFactory("TavernMatchmaker", signer);

  const adminPriceFeedDeploy = await resolveFreshOrReused(
    config.env.reuse.adminPriceFeed,
    AdminPriceFeedFactory,
    "AdminPriceFeed",
    signer,
    [ADMIN_TVRN_USD_INITIAL_PRICE],
    deployerAddress
  );
  const tavernTokenDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernToken,
    TavernTokenFactory,
    "TavernToken",
    signer,
    [],
    deployerAddress
  );
  const tavernRegistryDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernRegistry,
    TavernRegistryFactory,
    "TavernRegistry",
    signer,
    [tavernTokenDeploy.address],
    deployerAddress
  );
  const tavernEscrowDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernEscrow,
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
    config.env.reuse.tavernStaking,
    TavernStakingFactory,
    "TavernStaking",
    signer,
    [tavernTokenDeploy.address, tavernRegistryDeploy.address],
    deployerAddress
  );
  const tavernGovernanceDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernGovernance,
    TavernGovernanceFactory,
    "TavernGovernance",
    signer,
    [tavernTokenDeploy.address, tavernRegistryDeploy.address],
    deployerAddress
  );
  const tavernAutomationRouterDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernAutomationRouter,
    TavernAutomationRouterFactory,
    "TavernAutomationRouter",
    signer,
    [tavernEscrowDeploy.address, tavernRegistryDeploy.address, adminPriceFeedDeploy.address],
    deployerAddress
  );
  const tavernClientRPGDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernClientRPG,
    TavernClientRPGFactory,
    "TavernClientRPG",
    signer,
    [tavernTokenDeploy.address, tavernEscrowDeploy.address],
    deployerAddress
  );
  const tavernSubscriptionDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernSubscription,
    TavernSubscriptionFactory,
    "TavernSubscription",
    signer,
    [usdc, operatorWallet, tavernRegistryDeploy.address],
    deployerAddress
  );
  const tavernEquipmentDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernEquipment,
    TavernEquipmentFactory,
    "TavernEquipment",
    signer,
    [nftBaseUri],
    deployerAddress
  );
  const tavernGuildDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernGuild,
    TavernGuildFactory,
    "TavernGuild",
    signer,
    [tavernEquipmentDeploy.address],
    deployerAddress
  );
  const tavernServiceRegistryDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernServiceRegistry,
    TavernServiceRegistryFactory,
    "TavernServiceRegistry",
    signer,
    [tavernGuildDeploy.address, tavernEscrowDeploy.address, tavernRegistryDeploy.address, usdc],
    deployerAddress
  );
  const tavernMatchmakerDeploy = await resolveFreshOrReused(
    config.env.reuse.tavernMatchmaker,
    TavernMatchmakerFactory,
    "TavernMatchmaker",
    signer,
    [tavernServiceRegistryDeploy.address, tavernClientRPGDeploy.address],
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
  console.log(`TavernEquipment ${tavernEquipmentDeploy.reused ? "reused" : "deployed"} at ${tavernEquipmentDeploy.address}`);
  console.log(`TavernGuild ${tavernGuildDeploy.reused ? "reused" : "deployed"} at ${tavernGuildDeploy.address}`);
  console.log(`TavernServiceRegistry ${tavernServiceRegistryDeploy.reused ? "reused" : "deployed"} at ${tavernServiceRegistryDeploy.address}`);
  console.log(`TavernMatchmaker ${tavernMatchmakerDeploy.reused ? "reused" : "deployed"} at ${tavernMatchmakerDeploy.address}`);

  const adminPriceFeed = await getWorkspaceContractAt("AdminPriceFeed", adminPriceFeedDeploy.address, signer);
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
  const tavernSubscription = await getWorkspaceContractAt("TavernSubscription", tavernSubscriptionDeploy.address, signer);
  const tavernEquipment = await getWorkspaceContractAt("TavernEquipment", tavernEquipmentDeploy.address, signer);
  const tavernGuild = await getWorkspaceContractAt("TavernGuild", tavernGuildDeploy.address, signer);
  const tavernServiceRegistry = await getWorkspaceContractAt(
    "TavernServiceRegistry",
    tavernServiceRegistryDeploy.address,
    signer
  );

  const rolesGranted: RoleGrantRecord[] = [];

  await ensureRole(tavernToken, "TavernToken", await tavernToken.MINTER_ROLE(), tavernRegistryDeploy.address, rolesGranted);
  await ensureRole(tavernToken, "TavernToken", await tavernToken.MINTER_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(tavernToken, "TavernToken", await tavernToken.MINTER_ROLE(), tavernClientRPGDeploy.address, rolesGranted);
  await ensureRole(tavernToken, "TavernToken", await tavernToken.ESCROW_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(tavernToken, "TavernToken", await tavernToken.BURNER_ROLE(), tavernStakingDeploy.address, rolesGranted);
  await ensureRole(
    tavernToken,
    "TavernToken",
    await tavernToken.GOVERNANCE_ROLE(),
    tavernGovernanceDeploy.address,
    rolesGranted
  );

  await ensureRole(tavernRegistry, "TavernRegistry", await tavernRegistry.ARBITER_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(tavernRegistry, "TavernRegistry", await tavernRegistry.ARBITER_ROLE(), arbiterAddress, rolesGranted);
  await ensureRole(
    tavernRegistry,
    "TavernRegistry",
    await tavernRegistry.KEEPER_ROLE(),
    tavernAutomationRouterDeploy.address,
    rolesGranted
  );
  await ensureRole(tavernRegistry, "TavernRegistry", await tavernRegistry.KEEPER_ROLE(), keeperAddress, rolesGranted);
  await ensureRole(tavernRegistry, "TavernRegistry", await tavernRegistry.KEEPER_ROLE(), deployerAddress, rolesGranted);

  await ensureRole(
    tavernEscrow,
    "TavernEscrow",
    await tavernEscrow.KEEPER_ROLE(),
    tavernAutomationRouterDeploy.address,
    rolesGranted
  );
  await ensureRole(tavernEscrow, "TavernEscrow", await tavernEscrow.KEEPER_ROLE(), keeperAddress, rolesGranted);
  await ensureRole(tavernEscrow, "TavernEscrow", await tavernEscrow.KEEPER_ROLE(), deployerAddress, rolesGranted);
  await ensureRole(
    tavernEscrow,
    "TavernEscrow",
    await tavernEscrow.GOVERNANCE_ROLE(),
    tavernGovernanceDeploy.address,
    rolesGranted
  );
  await ensureRole(
    tavernEscrow,
    "TavernEscrow",
    await tavernEscrow.SERVICE_REGISTRY_ROLE(),
    tavernServiceRegistryDeploy.address,
    rolesGranted
  );

  await ensureRole(tavernStaking, "TavernStaking", await tavernStaking.SLASHER_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(tavernStaking, "TavernStaking", await tavernStaking.SLASHER_ROLE(), deployerAddress, rolesGranted);

  await ensureRole(
    tavernAutomationRouter,
    "TavernAutomationRouter",
    await tavernAutomationRouter.KEEPER_ROLE(),
    keeperAddress,
    rolesGranted
  );
  await ensureRole(
    tavernAutomationRouter,
    "TavernAutomationRouter",
    await tavernAutomationRouter.KEEPER_ROLE(),
    deployerAddress,
    rolesGranted
  );

  await ensureRole(
    tavernClientRPG,
    "TavernClientRPG",
    await tavernClientRPG.ESCROW_ROLE(),
    tavernEscrowDeploy.address,
    rolesGranted
  );
  await ensureRole(
    tavernClientRPG,
    "TavernClientRPG",
    await tavernClientRPG.KEEPER_ROLE(),
    tavernAutomationRouterDeploy.address,
    rolesGranted
  );
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

  await ensureRole(
    tavernEquipment,
    "TavernEquipment",
    await tavernEquipment.MINTER_ROLE(),
    tavernClientRPGDeploy.address,
    rolesGranted
  );
  await ensureRole(
    tavernEquipment,
    "TavernEquipment",
    await tavernEquipment.GUILD_ROLE(),
    tavernGuildDeploy.address,
    rolesGranted
  );

  await ensureRole(tavernGuild, "TavernGuild", await tavernGuild.ESCROW_ROLE(), tavernEscrowDeploy.address, rolesGranted);
  await ensureRole(
    tavernGuild,
    "TavernGuild",
    await tavernGuild.SERVICE_REGISTRY_ROLE(),
    tavernServiceRegistryDeploy.address,
    rolesGranted
  );
  await ensureRole(
    tavernGuild,
    "TavernGuild",
    await tavernGuild.KEEPER_ROLE(),
    tavernAutomationRouterDeploy.address,
    rolesGranted
  );
  await ensureRole(tavernGuild, "TavernGuild", await tavernGuild.KEEPER_ROLE(), keeperAddress, rolesGranted);

  await ensureRole(
    tavernServiceRegistry,
    "TavernServiceRegistry",
    await tavernServiceRegistry.ESCROW_ROLE(),
    tavernEscrowDeploy.address,
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
    tavernSubscriptionDeploy: tavernSubscriptionDeploy.txHash,
    tavernEquipmentDeploy: tavernEquipmentDeploy.txHash,
    tavernGuildDeploy: tavernGuildDeploy.txHash,
    tavernServiceRegistryDeploy: tavernServiceRegistryDeploy.txHash,
    tavernMatchmakerDeploy: tavernMatchmakerDeploy.txHash
  };

  await ensureConfiguredAddress(
    () => tavernRegistry.stakingContract(),
    tavernStakingDeploy.address,
    (value) => tavernRegistry.setStakingContract(value),
    transactionHashes,
    "registrySetStakingContract"
  );
  await ensureConfiguredAddress(
    null,
    tavernClientRPGDeploy.address,
    (value) => tavernEscrow.setClientRPG(value),
    transactionHashes,
    "escrowSetClientRPG"
  );
  await ensureConfiguredAddress(
    null,
    tavernServiceRegistryDeploy.address,
    (value) => tavernEscrow.setServiceRegistry(value),
    transactionHashes,
    "escrowSetServiceRegistry"
  );
  await ensureConfiguredAddress(
    () => tavernAutomationRouter.clientRPG(),
    tavernClientRPGDeploy.address,
    (value) => tavernAutomationRouter.setClientRPG(value),
    transactionHashes,
    "routerSetClientRPG"
  );
  await ensureConfiguredAddress(
    () => tavernAutomationRouter.subscriptionContract(),
    tavernSubscriptionDeploy.address,
    (value) => tavernAutomationRouter.setSubscriptionContract(value),
    transactionHashes,
    "routerSetSubscriptionContract"
  );
  await ensureConfiguredAddress(
    () => tavernAutomationRouter.guildContract(),
    tavernGuildDeploy.address,
    (value) => tavernAutomationRouter.setGuildContract(value),
    transactionHashes,
    "routerSetGuildContract"
  );
  await ensureConfiguredAddress(
    () => tavernSubscription.clientRPG(),
    tavernClientRPGDeploy.address,
    (value) => tavernSubscription.setClientRPG(value),
    transactionHashes,
    "subscriptionSetClientRPG"
  );
  await ensureConfiguredAddress(
    () => tavernClientRPG.equipmentContract(),
    tavernEquipmentDeploy.address,
    (value) => tavernClientRPG.setEquipmentContract(value),
    transactionHashes,
    "rpgSetEquipmentContract"
  );
  await ensureConfiguredAddress(
    () => tavernClientRPG.guildContract(),
    tavernGuildDeploy.address,
    (value) => tavernClientRPG.setGuildContract(value),
    transactionHashes,
    "rpgSetGuildContract"
  );

  await ensureRefresher(adminPriceFeed, tavernAutomationRouterDeploy.address, rolesGranted, transactionHashes);

  const catalog = await buildCatalog();
  const itemCount = Number(await tavernEquipment.itemCount());
  if (itemCount === 0) {
    const batchSize = 30;
    for (let start = 0; start < catalog.length; start += batchSize) {
      const items = catalog.slice(start, start + batchSize);
      const tx = await tavernEquipment.registerItemBatch(
        items.map((item) => item.tokenId),
        items.map((item) => categoryEnumValue(item.category)),
        items.map((item) => rarityEnumValue(item.rarity)),
        items.map((item) => slotEnumValue(item.slot)),
        items.map((item) => item.maxSupply),
        items.map((item) => item.soulbound),
        items.map((item) => item.name)
      );
      await tx.wait();
      transactionHashes[`equipmentRegisterBatch${Math.floor(start / batchSize) + 1}`] = tx.hash;
    }
  } else if (itemCount !== catalog.length) {
    throw new Error(
      `TavernEquipment itemCount is ${itemCount}, expected 0 or ${catalog.length}. Refusing to continue with partial catalog state.`
    );
  } else {
    transactionHashes.equipmentRegisterBatch1 = "";
  }

  for (const [level, tokenIds] of Object.entries(LEVEL_REWARD_MAP)) {
    const tx = await tavernEquipment.setLevelRewards(Number(level), tokenIds);
    await tx.wait();
    transactionHashes[`equipmentSetLevelRewards${level}`] = tx.hash;
  }

  const thresholdTx = await tavernClientRPG.setThresholds(buildThresholds());
  await thresholdTx.wait();
  transactionHashes.rpgSetThresholds = thresholdTx.hash;

  const currentAddresses: Record<ContractAddressKey, string> = {
    adminPriceFeed: adminPriceFeedDeploy.address,
    tavernToken: tavernTokenDeploy.address,
    tavernRegistry: tavernRegistryDeploy.address,
    tavernEscrow: tavernEscrowDeploy.address,
    tavernStaking: tavernStakingDeploy.address,
    tavernGovernance: tavernGovernanceDeploy.address,
    tavernAutomationRouter: tavernAutomationRouterDeploy.address,
    tavernClientRPG: tavernClientRPGDeploy.address,
    tavernSubscription: tavernSubscriptionDeploy.address,
    tavernEquipment: tavernEquipmentDeploy.address,
    tavernGuild: tavernGuildDeploy.address,
    tavernServiceRegistry: tavernServiceRegistryDeploy.address,
    tavernMatchmaker: tavernMatchmakerDeploy.address
  };

  const notes = new Set<string>();
  notes.add("Task 36 replaces the earlier incremental NFT/service deploy path with a full 13-contract redeploy.");
  notes.add("TavernRegistry does not expose REGISTRAR_ROLE on this codebase; Task 36 uses the live ARBITER_ROLE/KEEPER_ROLE wiring instead.");
  notes.add(`NFT base URI for this deploy: ${nftBaseUri}`);
  for (const orphan of ORPHAN_CONTRACTS) {
    notes.add(`${orphan.name} orphan ignored: ${orphan.address}. ${orphan.note}`);
  }

  const nextManifest: DeploymentManifest = {
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId),
      rpcUrl: process.env[config.rpcUrlEnvName] ?? config.defaultRpcUrl
    },
    deployer: deployerAddress,
    addresses: currentAddresses,
    constructorArgs: {
      adminPriceFeed: { initialPrice: ADMIN_TVRN_USD_INITIAL_PRICE },
      tavernToken: null,
      tavernRegistry: { guildToken: tavernTokenDeploy.address },
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
      },
      tavernEquipment: {
        baseUri: nftBaseUri
      },
      tavernGuild: {
        equipment: tavernEquipmentDeploy.address
      },
      tavernServiceRegistry: {
        guild: tavernGuildDeploy.address,
        escrow: tavernEscrowDeploy.address,
        registry: tavernRegistryDeploy.address,
        usdc
      },
      tavernMatchmaker: {
        serviceRegistry: tavernServiceRegistryDeploy.address,
        rpg: tavernClientRPGDeploy.address
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
    task36FullRedeploy: {
      executedAt: new Date().toISOString(),
      mode: "full-13-contract",
      orphanContracts: ORPHAN_CONTRACTS.map((entry) => ({ ...entry })),
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
        tavernSubscription: false,
        tavernEquipment: false,
        tavernGuild: false,
        tavernServiceRegistry: false,
        tavernMatchmaker: false
      },
      verifyScriptPath: "scripts/verify-full-deploy.ts",
      automationManifestPath: config.automationPath,
      nextStep:
        `Run npm run verify:full-deploy:${config.scriptSuffix}, then cancel the old upkeep and register a new upkeep for ${tavernAutomationRouterDeploy.address}.`
    }
  };

  await mkdir(path.dirname(config.manifestPath), { recursive: true });
  await writeFile(config.manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
  await updateFrontends(config.frontendKey, currentAddresses, usdc, operatorWallet);

  const verification: Record<ContractAddressKey, boolean> = {
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
    ]),
    tavernEquipment: await verifyContract("TavernEquipment", tavernEquipmentDeploy.address, [nftBaseUri]),
    tavernGuild: await verifyContract("TavernGuild", tavernGuildDeploy.address, [tavernEquipmentDeploy.address]),
    tavernServiceRegistry: await verifyContract("TavernServiceRegistry", tavernServiceRegistryDeploy.address, [
      tavernGuildDeploy.address,
      tavernEscrowDeploy.address,
      tavernRegistryDeploy.address,
      usdc
    ]),
    tavernMatchmaker: await verifyContract("TavernMatchmaker", tavernMatchmakerDeploy.address, [
      tavernServiceRegistryDeploy.address,
      tavernClientRPGDeploy.address
    ])
  };

  nextManifest.task36FullRedeploy = {
    ...nextManifest.task36FullRedeploy!,
    verification
  };
  await writeFile(config.manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

  console.log(`Task 36 full redeploy manifest written to ${config.manifestPath}`);
  for (const key of ADDRESS_KEYS) {
    console.log(`${key}: ${currentAddresses[key]} (${shortAddress(currentAddresses[key])})`);
  }
  console.log(`Next step: ${nextManifest.task36FullRedeploy.nextStep}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
