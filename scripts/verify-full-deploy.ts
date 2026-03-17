import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt } from "./utils/hardhatContracts";

const { ethers, network, run } = hre;

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
    manifestPath: path.join(process.cwd(), "deployments", "baseSepolia.json")
  },
  base: {
    chainId: 8453n,
    manifestPath: path.join(process.cwd(), "deployments", "base.json")
  }
} as const;

type DeployNetworkName = keyof typeof NETWORKS;
type ContractAddressKey = (typeof ADDRESS_KEYS)[number];

type DeploymentManifest = {
  addresses: Partial<Record<ContractAddressKey, string | null>>;
  optionalRoleTargets?: {
    arbiterAddress?: string | null;
    keeperAddress?: string | null;
    operatorWallet?: string | null;
  };
};

function requireAddress(label: string, value: string | null | undefined): string {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${label} is missing from the deployment manifest.`);
  }
  return ethers.getAddress(value);
}

async function assertCode(address: string, label: string): Promise<void> {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(`${label} has no code at ${address}`);
  }
}

function recordResult(results: Array<{ ok: boolean; label: string; detail: string }>, ok: boolean, label: string, detail: string): void {
  results.push({ ok, label, detail });
}

function asNamedString(value: any, key: string, fallbackIndex = 0): string {
  if (typeof value?.[key] === "string") {
    return value[key];
  }
  if (typeof value?.[fallbackIndex] === "string") {
    return value[fallbackIndex];
  }
  return String(value?.[key] ?? value?.[fallbackIndex] ?? "");
}

async function main(): Promise<void> {
  if (!(network.name in NETWORKS)) {
    throw new Error(`verify-full-deploy.ts only supports baseSepolia or base. Current network: ${network.name}`);
  }

  const config = NETWORKS[network.name as DeployNetworkName];
  const currentNetwork = await ethers.provider.getNetwork();
  if (currentNetwork.chainId !== config.chainId) {
    throw new Error(`Expected chainId ${config.chainId.toString()}, received ${currentNetwork.chainId.toString()}`);
  }

  await run("compile", { quiet: true });

  const manifest = JSON.parse(await readFile(config.manifestPath, "utf8")) as DeploymentManifest;
  const addresses = Object.fromEntries(
    ADDRESS_KEYS.map((key) => [key, requireAddress(`addresses.${key}`, manifest.addresses[key])])
  ) as Record<ContractAddressKey, string>;

  for (const key of ADDRESS_KEYS) {
    await assertCode(addresses[key], key);
  }

  const adminPriceFeed = await getWorkspaceContractAt("AdminPriceFeed", addresses.adminPriceFeed);
  const tavernRegistry = await getWorkspaceContractAt("TavernRegistry", addresses.tavernRegistry);
  const tavernEscrow = await getWorkspaceContractAt("TavernEscrow", addresses.tavernEscrow);
  const tavernAutomationRouter = await getWorkspaceContractAt("TavernAutomationRouter", addresses.tavernAutomationRouter);
  const tavernClientRPG = await getWorkspaceContractAt("TavernClientRPG", addresses.tavernClientRPG);
  const tavernSubscription = await getWorkspaceContractAt("TavernSubscription", addresses.tavernSubscription);
  const tavernEquipment = await getWorkspaceContractAt("TavernEquipment", addresses.tavernEquipment);
  const tavernGuild = await getWorkspaceContractAt("TavernGuild", addresses.tavernGuild);
  const tavernServiceRegistry = await getWorkspaceContractAt("TavernServiceRegistry", addresses.tavernServiceRegistry);
  const tavernMatchmaker = await getWorkspaceContractAt("TavernMatchmaker", addresses.tavernMatchmaker);

  const arbiterAddress = manifest.optionalRoleTargets?.arbiterAddress
    ? requireAddress("optionalRoleTargets.arbiterAddress", manifest.optionalRoleTargets.arbiterAddress)
    : null;
  const keeperAddress = manifest.optionalRoleTargets?.keeperAddress
    ? requireAddress("optionalRoleTargets.keeperAddress", manifest.optionalRoleTargets.keeperAddress)
    : null;

  const results: Array<{ ok: boolean; label: string; detail: string }> = [];

  recordResult(
    results,
    await tavernEscrow.hasRole(await tavernEscrow.KEEPER_ROLE(), addresses.tavernAutomationRouter),
    "Escrow KEEPER_ROLE -> Router",
    addresses.tavernAutomationRouter
  );
  if (keeperAddress) {
    recordResult(
      results,
      await tavernEscrow.hasRole(await tavernEscrow.KEEPER_ROLE(), keeperAddress),
      "Escrow KEEPER_ROLE -> keeper",
      keeperAddress
    );
  }
  recordResult(
    results,
    await tavernEscrow.hasRole(await tavernEscrow.SERVICE_REGISTRY_ROLE(), addresses.tavernServiceRegistry),
    "Escrow SERVICE_REGISTRY_ROLE -> ServiceRegistry",
    addresses.tavernServiceRegistry
  );

  recordResult(
    results,
    await tavernRegistry.hasRole(await tavernRegistry.ARBITER_ROLE(), addresses.tavernEscrow),
    "Registry ARBITER_ROLE -> Escrow",
    addresses.tavernEscrow
  );
  if (arbiterAddress) {
    recordResult(
      results,
      await tavernRegistry.hasRole(await tavernRegistry.ARBITER_ROLE(), arbiterAddress),
      "Registry ARBITER_ROLE -> arbiter",
      arbiterAddress
    );
  }
  recordResult(
    results,
    await tavernRegistry.hasRole(await tavernRegistry.KEEPER_ROLE(), addresses.tavernAutomationRouter),
    "Registry KEEPER_ROLE -> Router",
    addresses.tavernAutomationRouter
  );

  recordResult(
    results,
    await tavernGuild.hasRole(await tavernGuild.ESCROW_ROLE(), addresses.tavernEscrow),
    "Guild ESCROW_ROLE -> Escrow",
    addresses.tavernEscrow
  );
  recordResult(
    results,
    await tavernGuild.hasRole(await tavernGuild.SERVICE_REGISTRY_ROLE(), addresses.tavernServiceRegistry),
    "Guild SERVICE_REGISTRY_ROLE -> ServiceRegistry",
    addresses.tavernServiceRegistry
  );
  recordResult(
    results,
    await tavernGuild.hasRole(await tavernGuild.KEEPER_ROLE(), addresses.tavernAutomationRouter),
    "Guild KEEPER_ROLE -> Router",
    addresses.tavernAutomationRouter
  );

  recordResult(
    results,
    await tavernServiceRegistry.hasRole(await tavernServiceRegistry.ESCROW_ROLE(), addresses.tavernEscrow),
    "ServiceRegistry ESCROW_ROLE -> Escrow",
    addresses.tavernEscrow
  );
  recordResult(
    results,
    await tavernClientRPG.hasRole(await tavernClientRPG.ESCROW_ROLE(), addresses.tavernEscrow),
    "RPG ESCROW_ROLE -> Escrow",
    addresses.tavernEscrow
  );
  recordResult(
    results,
    await tavernClientRPG.hasRole(await tavernClientRPG.KEEPER_ROLE(), addresses.tavernAutomationRouter),
    "RPG KEEPER_ROLE -> Router",
    addresses.tavernAutomationRouter
  );
  recordResult(
    results,
    await tavernClientRPG.hasRole(await tavernClientRPG.SUBSCRIPTION_ROLE(), addresses.tavernSubscription),
    "RPG SUBSCRIPTION_ROLE -> Subscription",
    addresses.tavernSubscription
  );
  recordResult(
    results,
    await tavernSubscription.hasRole(await tavernSubscription.KEEPER_ROLE(), addresses.tavernAutomationRouter),
    "Subscription KEEPER_ROLE -> Router",
    addresses.tavernAutomationRouter
  );
  recordResult(
    results,
    await tavernEquipment.hasRole(await tavernEquipment.MINTER_ROLE(), addresses.tavernClientRPG),
    "Equipment MINTER_ROLE -> RPG",
    addresses.tavernClientRPG
  );
  recordResult(
    results,
    await tavernEquipment.hasRole(await tavernEquipment.GUILD_ROLE(), addresses.tavernGuild),
    "Equipment GUILD_ROLE -> Guild",
    addresses.tavernGuild
  );
  recordResult(
    results,
    await adminPriceFeed.isRefresher(addresses.tavernAutomationRouter),
    "AdminPriceFeed refresher -> Router",
    addresses.tavernAutomationRouter
  );

  recordResult(
    results,
    ethers.getAddress(await tavernClientRPG.equipmentContract()) === addresses.tavernEquipment,
    "RPG equipmentContract",
    await tavernClientRPG.equipmentContract()
  );
  recordResult(
    results,
    ethers.getAddress(await tavernClientRPG.guildContract()) === addresses.tavernGuild,
    "RPG guildContract",
    await tavernClientRPG.guildContract()
  );
  recordResult(
    results,
    ethers.getAddress(await tavernAutomationRouter.guildContract()) === addresses.tavernGuild,
    "Router guildContract",
    await tavernAutomationRouter.guildContract()
  );
  recordResult(
    results,
    ethers.getAddress(await tavernAutomationRouter.clientRPG()) === addresses.tavernClientRPG,
    "Router clientRPG",
    await tavernAutomationRouter.clientRPG()
  );
  recordResult(
    results,
    ethers.getAddress(await tavernAutomationRouter.subscriptionContract()) === addresses.tavernSubscription,
    "Router subscriptionContract",
    await tavernAutomationRouter.subscriptionContract()
  );
  recordResult(
    results,
    ethers.getAddress(await tavernSubscription.clientRPG()) === addresses.tavernClientRPG,
    "Subscription clientRPG",
    await tavernSubscription.clientRPG()
  );

  recordResult(
    results,
    Number(await tavernGuild.GUILD_COUNT()) === 8,
    "Guild count",
    (await tavernGuild.GUILD_COUNT()).toString()
  );
  const guildZero = await tavernGuild.guilds(0);
  recordResult(
    results,
    asNamedString(guildZero, "name") === "Artificers Guild",
    "Guild[0] name",
    asNamedString(guildZero, "name")
  );
  recordResult(
    results,
    Number(await tavernMatchmaker.weightRating()) === 40,
    "Matchmaker weightRating",
    (await tavernMatchmaker.weightRating()).toString()
  );
  recordResult(
    results,
    Number(await tavernEquipment.itemCount()) === 145,
    "Equipment itemCount",
    (await tavernEquipment.itemCount()).toString()
  );

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}: ${entry.detail}`);
  }

  if (failed.length > 0) {
    throw new Error(`Full deploy verification failed with ${failed.length} issue(s).`);
  }

  console.log(`Verified ${ADDRESS_KEYS.length} contracts from ${config.manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
