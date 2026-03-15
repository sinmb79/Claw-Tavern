import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt, getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const { ethers, network, run } = hre;

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
    tavernAutomationRouter?: string | null;
    tavernClientRPG?: string | null;
    tavernSubscription?: string | null;
  };
  constructorArgs: {
    tavernClientRPG?: {
      tavernToken: string;
      escrow: string;
    } | null;
  } & Record<string, unknown>;
  rolesGranted?: RoleGrantRecord[];
  notes?: string[];
  task27Deploy?: {
    executedAt: string;
    transactionHashes: {
      tavernClientRPGDeploy: string;
      escrowRoleGrant: string | null;
      keeperRoleGrant: string | null;
      tokenMinterGrant: string | null;
      escrowClientRPGSet: string;
      routerClientRPGSet: string;
    };
    verification: {
      tavernClientRPG: boolean;
    };
  };
  phase2Deploy?: {
    executedAt: string;
    transactionHashes: {
      clientRPGDeploy?: string;
      subscriptionDeploy?: string | null;
      escrowSetClientRPG?: string;
      escrowSetSubscription?: string | null;
      routerSetClientRPG?: string;
      routerSetSubscription?: string | null;
      rpgEscrowRoleGrant?: string | null;
      rpgKeeperRoleGrant?: string | null;
      rpgSubscriptionRoleGrant?: string | null;
      subscriptionKeeperRoleGrant?: string | null;
      tokenMinterGrant?: string | null;
    };
    verification: {
      tavernClientRPG?: boolean;
      tavernSubscription?: boolean;
    };
  };
};

const NETWORKS = {
  baseSepolia: {
    chainId: 84532n,
    manifestPath: path.join(process.cwd(), "deployments", "baseSepolia.json"),
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"
  },
  base: {
    chainId: 8453n,
    manifestPath: path.join(process.cwd(), "deployments", "base.json"),
    rpcUrl: process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org"
  }
} as const;

function requireAddress(name: string, value: string | undefined | null): string {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value ?? "undefined"}`);
  }

  return ethers.getAddress(value);
}

function isMainnetConfirmed(): boolean {
  return (process.env.MAINNET_CONFIRM ?? "").trim().toLowerCase() === "true";
}

async function readManifest(manifestPath: string): Promise<DeploymentManifest> {
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as DeploymentManifest;
}

async function ensureRole(contract: any, contractName: string, role: string, grantee: string): Promise<RoleGrantRecord> {
  if (await contract.hasRole(role, grantee)) {
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

async function verifyContract(address: string, constructorArguments: string[]): Promise<boolean> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
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

      const retryable =
        message.includes("does not have bytecode")
        || message.includes("unable to locate contractcode")
        || message.includes("not found");
      if (!retryable || attempt === 5) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }

  return false;
}

async function assertIncrementalHooks(escrow: any, router: any): Promise<void> {
  try {
    await escrow.setClientRPG.staticCall(ethers.ZeroAddress);
  } catch {
    throw new Error("Live TavernEscrow does not support setClientRPG(address). Task 29 incremental wiring cannot proceed against the current deployed escrow.");
  }

  try {
    await router.setClientRPG.staticCall(ethers.ZeroAddress);
  } catch {
    throw new Error("Live TavernAutomationRouter does not support setClientRPG(address). Task 29 incremental wiring cannot proceed against the current deployed router.");
  }
}

async function main(): Promise<void> {
  await run("compile", { quiet: true, force: true });

  if (!(network.name in NETWORKS)) {
    throw new Error(`deploy/09_deploy_client_rpg.ts only supports baseSepolia or base. Current network: ${network.name}`);
  }

  const config = NETWORKS[network.name as keyof typeof NETWORKS];
  const currentNetwork = await ethers.provider.getNetwork();
  if (currentNetwork.chainId !== config.chainId) {
    throw new Error(`Expected chainId ${config.chainId.toString()}, received ${currentNetwork.chainId.toString()}`);
  }

  if (network.name === "base" && !isMainnetConfirmed()) {
    throw new Error("Set MAINNET_CONFIRM=true before running deploy/09_deploy_client_rpg.ts on Base mainnet.");
  }

  const manifest = await readManifest(config.manifestPath);
  const [deployer] = await ethers.getSigners();
  const signer = new ethers.NonceManager(deployer);

  const tokenAddress = requireAddress("addresses.tavernToken", manifest.addresses.tavernToken);
  const escrowAddress = requireAddress("addresses.tavernEscrow", manifest.addresses.tavernEscrow);
  const routerAddress = requireAddress("addresses.tavernAutomationRouter", manifest.addresses.tavernAutomationRouter);

  const TavernClientRPG = await getWorkspaceContractFactory("TavernClientRPG", signer);
  const clientRPG: any = await TavernClientRPG.deploy(tokenAddress, escrowAddress);
  await clientRPG.waitForDeployment();
  const clientRPGAddress = await clientRPG.getAddress();

  const token = await getWorkspaceContractAt("TavernToken", tokenAddress, signer);
  const escrow = await getWorkspaceContractAt("TavernEscrow", escrowAddress, signer);
  const router = await ethers.getContractAt("TavernAutomationRouter", routerAddress, signer);

  await assertIncrementalHooks(escrow, router);

  const tokenMinterGrant = await ensureRole(token, "TavernToken", await token.MINTER_ROLE(), clientRPGAddress);
  const escrowRoleGrant = await ensureRole(clientRPG, "TavernClientRPG", await clientRPG.ESCROW_ROLE(), escrowAddress);
  const keeperRoleGrant = await ensureRole(clientRPG, "TavernClientRPG", await clientRPG.KEEPER_ROLE(), routerAddress);

  const escrowSetTx = await escrow.setClientRPG(clientRPGAddress);
  await escrowSetTx.wait();
  const routerSetTx = await router.setClientRPG(clientRPGAddress);
  await routerSetTx.wait();

  const verified = await verifyContract(clientRPGAddress, [tokenAddress, escrowAddress]);

  const notes = new Set(manifest.notes ?? []);
  notes.add("Task 27 adds TavernClientRPG for season-aware client progression and conditional TVRN withdrawals.");
  notes.add("Task 27 requires TavernToken.MINTER_ROLE on TavernClientRPG because claimable client rewards are now minted into the RPG vault.");

  const existingPhase2Deploy = manifest.phase2Deploy;

  const nextManifest: DeploymentManifest = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId),
      rpcUrl: config.rpcUrl
    },
    deployer: deployer.address,
    addresses: {
      ...manifest.addresses,
      tavernClientRPG: clientRPGAddress
    },
    constructorArgs: {
      ...manifest.constructorArgs,
      tavernClientRPG: {
        tavernToken: tokenAddress,
        escrow: escrowAddress
      }
    },
    rolesGranted: [
      ...(manifest.rolesGranted ?? []),
      tokenMinterGrant,
      escrowRoleGrant,
      keeperRoleGrant
    ],
    notes: [...notes],
    task27Deploy: {
      executedAt: new Date().toISOString(),
      transactionHashes: {
        tavernClientRPGDeploy: clientRPG.deploymentTransaction()?.hash ?? "",
        escrowRoleGrant: escrowRoleGrant.txHash,
        keeperRoleGrant: keeperRoleGrant.txHash,
        tokenMinterGrant: tokenMinterGrant.txHash,
        escrowClientRPGSet: escrowSetTx.hash,
        routerClientRPGSet: routerSetTx.hash
      },
      verification: {
        tavernClientRPG: verified
      }
    },
    phase2Deploy: {
      executedAt: new Date().toISOString(),
      transactionHashes: {
        ...existingPhase2Deploy?.transactionHashes,
        clientRPGDeploy: clientRPG.deploymentTransaction()?.hash ?? "",
        escrowSetClientRPG: escrowSetTx.hash,
        routerSetClientRPG: routerSetTx.hash,
        rpgEscrowRoleGrant: escrowRoleGrant.txHash,
        rpgKeeperRoleGrant: keeperRoleGrant.txHash,
        tokenMinterGrant: tokenMinterGrant.txHash
      },
      verification: {
        ...existingPhase2Deploy?.verification,
        tavernClientRPG: verified
      }
    }
  };

  await mkdir(path.dirname(config.manifestPath), { recursive: true });
  await writeFile(config.manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

  console.log(`TavernClientRPG deployed on ${network.name}: ${clientRPGAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
