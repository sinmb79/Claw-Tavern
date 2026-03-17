import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt, getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const { ethers, network, run } = hre;

const NETWORKS = {
  baseSepolia: {
    chainId: 84532n,
    manifestPath: path.join(process.cwd(), "deployments", "baseSepolia.json"),
    nftSystemPath: path.join(process.cwd(), "deployments", "baseSepolia.nft-system.json"),
    outputPath: path.join(process.cwd(), "deployments", "baseSepolia.service-marketplace.json")
  },
  base: {
    chainId: 8453n,
    manifestPath: path.join(process.cwd(), "deployments", "base.json"),
    nftSystemPath: path.join(process.cwd(), "deployments", "base.nft-system.json"),
    outputPath: path.join(process.cwd(), "deployments", "base.service-marketplace.json")
  }
} as const;

type DeploymentManifest = {
  addresses: {
    tavernRegistry?: string | null;
    tavernEscrow?: string | null;
    tavernClientRPG?: string | null;
    tavernGuild?: string | null;
    usdc?: string | null;
    tavernServiceRegistry?: string | null;
    tavernMatchmaker?: string | null;
  };
};

function requireAddress(name: string, value: string | undefined | null): string {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value ?? "undefined"}`);
  }

  return ethers.getAddress(value);
}

async function verifyContract(address: string, constructorArguments: unknown[]): Promise<boolean> {
  try {
    await run("verify:verify", { address, constructorArguments });
    return true;
  } catch (error: any) {
    const message = String(error?.message ?? error).toLowerCase();
    if (message.includes("already verified") || message.includes("source code already verified")) {
      return true;
    }
    return false;
  }
}

async function ensureRole(contract: any, role: string, account: string): Promise<string | null> {
  if (await contract.hasRole(role, account)) {
    return null;
  }

  const tx = await contract.grantRole(role, account);
  await tx.wait();
  return tx.hash;
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
    throw new Error(`${label} does not expose ${fn}(). Incremental service marketplace deployment is not possible on this live core set.`);
  }
}

async function main(): Promise<void> {
  if (!(network.name in NETWORKS)) {
    throw new Error(`deploy/10_service_marketplace.ts only supports baseSepolia or base. Current network: ${network.name}`);
  }

  const config = NETWORKS[network.name as keyof typeof NETWORKS];
  const chain = await ethers.provider.getNetwork();
  if (chain.chainId !== config.chainId) {
    throw new Error(`Expected chainId ${config.chainId.toString()}, received ${chain.chainId.toString()}`);
  }

  const execute = (process.env.SERVICE_MARKETPLACE_EXECUTE ?? "").trim().toLowerCase() === "true";
  const manifest = JSON.parse(await readFile(config.manifestPath, "utf8")) as DeploymentManifest;
  const nftSystemManifest = await readFile(config.nftSystemPath, "utf8")
    .then((value) => JSON.parse(value) as { deployedAddresses?: { tavernGuild?: string | null } })
    .catch(() => null);

  const addresses = {
    tavernRegistry: requireAddress("addresses.tavernRegistry", manifest.addresses.tavernRegistry),
    tavernEscrow: requireAddress("addresses.tavernEscrow", manifest.addresses.tavernEscrow),
    tavernClientRPG: requireAddress("addresses.tavernClientRPG", manifest.addresses.tavernClientRPG),
    tavernGuild: requireAddress(
      "addresses.tavernGuild",
      manifest.addresses.tavernGuild ?? nftSystemManifest?.deployedAddresses?.tavernGuild
    ),
    usdc: requireAddress("addresses.usdc", manifest.addresses.usdc)
  };

  if (execute) {
    await ensureViewFunctionExists(addresses.tavernEscrow, "function serviceRegistry() view returns (address)", "TavernEscrow");
  }

  const plan = {
    generatedAt: new Date().toISOString(),
    network: network.name,
    execute,
    existingAddresses: addresses,
    steps: [
      "Deploy TavernServiceRegistry(guild, escrow, registry, usdc)",
      "Deploy TavernMatchmaker(serviceRegistry, rpg)",
      "Grant TavernGuild.SERVICE_REGISTRY_ROLE to TavernServiceRegistry",
      "Grant TavernEscrow.SERVICE_REGISTRY_ROLE to TavernServiceRegistry",
      "Grant TavernServiceRegistry.ESCROW_ROLE to TavernEscrow",
      "Set TavernEscrow.serviceRegistry"
    ]
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

  const TavernServiceRegistry = await getWorkspaceContractFactory("TavernServiceRegistry", signer);
  const TavernMatchmaker = await getWorkspaceContractFactory("TavernMatchmaker", signer);

  const serviceRegistry: any = await TavernServiceRegistry.deploy(
    addresses.tavernGuild,
    addresses.tavernEscrow,
    addresses.tavernRegistry,
    addresses.usdc
  );
  await serviceRegistry.waitForDeployment();

  const matchmaker: any = await TavernMatchmaker.deploy(
    await serviceRegistry.getAddress(),
    addresses.tavernClientRPG
  );
  await matchmaker.waitForDeployment();

  const guild = await getWorkspaceContractAt("TavernGuild", addresses.tavernGuild, signer);
  const escrow = await getWorkspaceContractAt("TavernEscrow", addresses.tavernEscrow, signer);

  const txHashes = {
    guildServiceRegistry: await ensureRole(
      guild,
      await guild.SERVICE_REGISTRY_ROLE(),
      await serviceRegistry.getAddress()
    ),
    escrowServiceRegistry: await ensureRole(
      escrow,
      await escrow.SERVICE_REGISTRY_ROLE(),
      await serviceRegistry.getAddress()
    ),
    serviceRegistryEscrow: await ensureRole(
      serviceRegistry,
      await serviceRegistry.ESCROW_ROLE(),
      addresses.tavernEscrow
    )
  };

  const setServiceRegistryTx = await escrow.setServiceRegistry(await serviceRegistry.getAddress());
  await setServiceRegistryTx.wait();

  const output = {
    ...plan,
    executedBy: deployer.address,
    deployedAddresses: {
      tavernServiceRegistry: await serviceRegistry.getAddress(),
      tavernMatchmaker: await matchmaker.getAddress()
    },
    txHashes: {
      tavernServiceRegistryDeploy: serviceRegistry.deploymentTransaction()?.hash ?? null,
      tavernMatchmakerDeploy: matchmaker.deploymentTransaction()?.hash ?? null,
      setEscrowServiceRegistry: setServiceRegistryTx.hash,
      ...txHashes
    },
    verification: {
      tavernServiceRegistry: await verifyContract(await serviceRegistry.getAddress(), [
        addresses.tavernGuild,
        addresses.tavernEscrow,
        addresses.tavernRegistry,
        addresses.usdc
      ]),
      tavernMatchmaker: await verifyContract(await matchmaker.getAddress(), [
        await serviceRegistry.getAddress(),
        addresses.tavernClientRPG
      ])
    }
  };

  await mkdir(path.dirname(config.outputPath), { recursive: true });
  await writeFile(config.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  const updatedManifest: DeploymentManifest = {
    ...manifest,
    addresses: {
      ...manifest.addresses,
      tavernGuild: addresses.tavernGuild,
      tavernServiceRegistry: await serviceRegistry.getAddress(),
      tavernMatchmaker: await matchmaker.getAddress()
    }
  };
  await writeFile(config.manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, "utf8");
  console.log(`Service marketplace deployment manifest written to ${config.outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
