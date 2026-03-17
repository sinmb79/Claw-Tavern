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

const NETWORKS = {
  baseSepolia: {
    chainId: 84532n,
    manifestPath: path.join(process.cwd(), "deployments", "baseSepolia.json"),
    outputPath: path.join(process.cwd(), "deployments", "baseSepolia.nft-system.json")
  },
  base: {
    chainId: 8453n,
    manifestPath: path.join(process.cwd(), "deployments", "base.json"),
    outputPath: path.join(process.cwd(), "deployments", "base.nft-system.json")
  }
} as const;

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

type DeploymentManifest = {
  addresses: {
    tavernToken?: string | null;
    tavernEscrow?: string | null;
    tavernAutomationRouter?: string | null;
    tavernClientRPG?: string | null;
    tavernEquipment?: string | null;
    tavernGuild?: string | null;
  };
};

function requireAddress(name: string, value: string | undefined | null): string {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value ?? "undefined"}`);
  }

  return ethers.getAddress(value);
}

function buildThresholds(): bigint[] {
  const thresholds: bigint[] = [0n];
  for (let level = 1; level <= 100; level += 1) {
    thresholds.push(BigInt(Math.floor(20 * Math.pow(level, 2.2))));
  }
  return thresholds;
}

async function ensureRole(contract: any, role: string, account: string): Promise<string | null> {
  if (await contract.hasRole(role, account)) {
    return null;
  }

  const tx = await contract.grantRole(role, account);
  await tx.wait();
  return tx.hash;
}

async function verifyContract(address: string, constructorArguments: unknown[]): Promise<boolean> {
  try {
    await run("verify:verify", {
      address,
      constructorArguments
    });
    return true;
  } catch (error: any) {
    const message = String(error?.message ?? error).toLowerCase();
    if (
      message.includes("already verified")
        || message.includes("source code already verified")
        || message.includes("contract source code already verified")
    ) {
      return true;
    }
    return false;
  }
}

async function ensureViewFunctionExists(
  address: string,
  fragment: string,
  label: string
): Promise<void> {
  const iface = new ethers.Interface([fragment]);
  const fn = fragment.match(/function\s+(\w+)/)?.[1];
  if (!fn) {
    throw new Error(`Unable to derive function name from fragment: ${fragment}`);
  }

  try {
    await ethers.provider.call({
      to: address,
      data: iface.encodeFunctionData(fn, [])
    });
  } catch {
    throw new Error(`${label} does not expose ${fn}(). Incremental NFT deployment is not possible on this live core set.`);
  }
}

async function main(): Promise<void> {
  if (!(network.name in NETWORKS)) {
    throw new Error(`deploy/09_nft_system.ts only supports baseSepolia or base. Current network: ${network.name}`);
  }

  const config = NETWORKS[network.name as keyof typeof NETWORKS];
  const chain = await ethers.provider.getNetwork();
  if (chain.chainId !== config.chainId) {
    throw new Error(`Expected chainId ${config.chainId.toString()}, received ${chain.chainId.toString()}`);
  }

  const execute = (process.env.NFT_DEPLOY_EXECUTE ?? "").trim().toLowerCase() === "true";
  const configuredMetadataUri = process.env.NFT_BASE_URI?.trim();
  const metadataUri = configuredMetadataUri || "ipfs://REPLACE_METADATA_CID/";
  const manifest = JSON.parse(await readFile(config.manifestPath, "utf8")) as DeploymentManifest;
  const catalog = await buildCatalog();
  const thresholds = buildThresholds();

  if (execute && !configuredMetadataUri) {
    throw new Error("NFT_BASE_URI must be set before running a live NFT deployment.");
  }

  const addresses = {
    tavernEscrow: requireAddress("addresses.tavernEscrow", manifest.addresses.tavernEscrow),
    tavernAutomationRouter: requireAddress(
      "addresses.tavernAutomationRouter",
      manifest.addresses.tavernAutomationRouter
    ),
    tavernClientRPG: requireAddress("addresses.tavernClientRPG", manifest.addresses.tavernClientRPG)
  };

  if (execute) {
    await ensureViewFunctionExists(addresses.tavernClientRPG, "function equipmentContract() view returns (address)", "TavernClientRPG");
    await ensureViewFunctionExists(addresses.tavernClientRPG, "function guildContract() view returns (address)", "TavernClientRPG");
    await ensureViewFunctionExists(addresses.tavernAutomationRouter, "function guildContract() view returns (address)", "TavernAutomationRouter");
  }

  const plan = {
    generatedAt: new Date().toISOString(),
    network: network.name,
    execute,
    metadataUri,
    existingAddresses: addresses,
    steps: [
      "Deploy TavernEquipment",
      "Deploy TavernGuild",
      "Wire RPG equipment/guild references",
      "Wire Router guild reference",
      "Grant equipment/guild roles",
      "Register 145 items",
      "Set level rewards for levels 1-10",
      "Set Lv100 threshold table"
    ],
    levelRewardMap: LEVEL_REWARD_MAP
  };

  if (!execute) {
    await mkdir(path.dirname(config.outputPath), { recursive: true });
    await writeFile(config.outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    console.log(`Dry-run plan written to ${config.outputPath}`);
    return;
  }

  await run("compile", { quiet: true });
  const [deployer] = await ethers.getSigners();
  const signer = new ethers.NonceManager(deployer);

  const TavernEquipment = await getWorkspaceContractFactory("TavernEquipment", signer);
  const TavernGuild = await getWorkspaceContractFactory("TavernGuild", signer);
  const equipment: any = await TavernEquipment.deploy(metadataUri);
  await equipment.waitForDeployment();
  const guild: any = await TavernGuild.deploy(await equipment.getAddress());
  await guild.waitForDeployment();

  const escrow = await getWorkspaceContractAt("TavernEscrow", addresses.tavernEscrow, signer);
  const router = await getWorkspaceContractAt("TavernAutomationRouter", addresses.tavernAutomationRouter, signer);
  const rpg = await getWorkspaceContractAt("TavernClientRPG", addresses.tavernClientRPG, signer);

  const roleHashes = {
    equipmentMinter: await ensureRole(equipment, await equipment.MINTER_ROLE(), addresses.tavernClientRPG),
    equipmentGuild: await ensureRole(equipment, await equipment.GUILD_ROLE(), await guild.getAddress()),
    guildEscrow: await ensureRole(guild, await guild.ESCROW_ROLE(), addresses.tavernEscrow),
    guildKeeper: await ensureRole(guild, await guild.KEEPER_ROLE(), addresses.tavernAutomationRouter)
  };

  const rpgSetEquipmentTx = await rpg.setEquipmentContract(await equipment.getAddress());
  await rpgSetEquipmentTx.wait();
  const rpgSetGuildTx = await rpg.setGuildContract(await guild.getAddress());
  await rpgSetGuildTx.wait();
  const routerSetGuildTx = await router.setGuildContract(await guild.getAddress());
  await routerSetGuildTx.wait();

  const batchSize = 30;
  for (let start = 0; start < catalog.length; start += batchSize) {
    const items = catalog.slice(start, start + batchSize);
    const tx = await equipment.registerItemBatch(
      items.map((item) => item.tokenId),
      items.map((item) => categoryEnumValue(item.category)),
      items.map((item) => rarityEnumValue(item.rarity)),
      items.map((item) => slotEnumValue(item.slot)),
      items.map((item) => item.maxSupply),
      items.map((item) => item.soulbound),
      items.map((item) => item.name)
    );
    await tx.wait();
  }

  for (const [level, tokenIds] of Object.entries(LEVEL_REWARD_MAP)) {
    const tx = await equipment.setLevelRewards(Number(level), tokenIds);
    await tx.wait();
  }

  const thresholdTx = await rpg.setThresholds(thresholds);
  await thresholdTx.wait();

  const verification = {
    tavernEquipment: await verifyContract(await equipment.getAddress(), [metadataUri]),
    tavernGuild: await verifyContract(await guild.getAddress(), [await equipment.getAddress()])
  };

  const output = {
    ...plan,
    executedBy: deployer.address,
    deployedAddresses: {
      tavernEquipment: await equipment.getAddress(),
      tavernGuild: await guild.getAddress()
    },
    txHashes: {
      tavernEquipmentDeploy: equipment.deploymentTransaction()?.hash ?? null,
      tavernGuildDeploy: guild.deploymentTransaction()?.hash ?? null,
      rpgSetEquipment: rpgSetEquipmentTx.hash,
      rpgSetGuild: rpgSetGuildTx.hash,
      routerSetGuild: routerSetGuildTx.hash,
      setThresholds: thresholdTx.hash,
      ...roleHashes
    },
    verification
  };

  await mkdir(path.dirname(config.outputPath), { recursive: true });
  await writeFile(config.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  const updatedManifest: DeploymentManifest = {
    ...manifest,
    addresses: {
      ...manifest.addresses,
      tavernEquipment: await equipment.getAddress(),
      tavernGuild: await guild.getAddress()
    }
  };
  await writeFile(config.manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, "utf8");
  console.log(`NFT system deployment manifest written to ${config.outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
