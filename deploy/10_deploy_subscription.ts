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
    tavernEscrow?: string;
    tavernAutomationRouter?: string | null;
    tavernClientRPG?: string | null;
    tavernRegistry?: string;
    tavernSubscription?: string | null;
    tavernToken?: string;
  };
  constructorArgs: {
    tavernEscrow?: {
      usdc: string;
      tavernToken: string;
      registry: string;
      ethUsdFeed: string;
      tvrnUsdFeed: string;
    };
    tavernSubscription?: {
      usdc: string;
      operatorWallet: string;
      registry: string;
    } | null;
  } & Record<string, unknown>;
  rolesGranted?: RoleGrantRecord[];
  notes?: string[];
  task28Deploy?: {
    executedAt: string;
    transactionHashes: {
      tavernSubscriptionDeploy: string;
      subscriptionKeeperGrant: string | null;
      rpgSubscriptionRoleGrant: string | null;
      subscriptionClientRPGSet: string;
      routerSubscriptionSet: string;
    };
    verification: {
      tavernSubscription: boolean;
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
      subscriptionKeeperGrant?: string | null;
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
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
    operatorWallet:
      process.env.BASE_SEPOLIA_SUBSCRIPTION_OPERATOR_WALLET
      ?? process.env.SUBSCRIPTION_OPERATOR_WALLET
  },
  base: {
    chainId: 8453n,
    manifestPath: path.join(process.cwd(), "deployments", "base.json"),
    rpcUrl: process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org",
    operatorWallet:
      process.env.MAINNET_SUBSCRIPTION_OPERATOR_WALLET
      ?? process.env.SUBSCRIPTION_OPERATOR_WALLET
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

async function assertIncrementalHooks(router: any): Promise<void> {
  try {
    await router.setSubscriptionContract.staticCall(ethers.ZeroAddress);
  } catch {
    throw new Error("Live TavernAutomationRouter does not support setSubscriptionContract(address). Task 29 incremental wiring cannot proceed against the current deployed router.");
  }
}

async function main(): Promise<void> {
  await run("compile", { quiet: true, force: true });

  if (!(network.name in NETWORKS)) {
    throw new Error(`deploy/10_deploy_subscription.ts only supports baseSepolia or base. Current network: ${network.name}`);
  }

  const config = NETWORKS[network.name as keyof typeof NETWORKS];
  const currentNetwork = await ethers.provider.getNetwork();
  if (currentNetwork.chainId !== config.chainId) {
    throw new Error(`Expected chainId ${config.chainId.toString()}, received ${currentNetwork.chainId.toString()}`);
  }

  if (network.name === "base" && !isMainnetConfirmed()) {
    throw new Error("Set MAINNET_CONFIRM=true before running deploy/10_deploy_subscription.ts on Base mainnet.");
  }

  const manifest = await readManifest(config.manifestPath);
  const [deployer] = await ethers.getSigners();
  const signer = new ethers.NonceManager(deployer);

  const usdcAddress = requireAddress("constructorArgs.tavernEscrow.usdc", manifest.constructorArgs.tavernEscrow?.usdc);
  const registryAddress = requireAddress("addresses.tavernRegistry", manifest.addresses.tavernRegistry);
  const routerAddress = requireAddress("addresses.tavernAutomationRouter", manifest.addresses.tavernAutomationRouter);
  const clientRPGAddress = requireAddress("addresses.tavernClientRPG", manifest.addresses.tavernClientRPG);
  const operatorWallet = requireAddress(
    `${network.name}.subscriptionOperatorWallet`,
    config.operatorWallet ?? deployer.address
  );

  const TavernSubscription = await getWorkspaceContractFactory("TavernSubscription", signer);
  const subscription: any = await TavernSubscription.deploy(usdcAddress, operatorWallet, registryAddress);
  await subscription.waitForDeployment();
  const subscriptionAddress = await subscription.getAddress();

  const clientRPG = await getWorkspaceContractAt("TavernClientRPG", clientRPGAddress, signer);
  const router = await ethers.getContractAt("TavernAutomationRouter", routerAddress, signer);

  await assertIncrementalHooks(router);

  const subscriptionKeeperGrant =
    await ensureRole(subscription, "TavernSubscription", await subscription.KEEPER_ROLE(), routerAddress);
  const rpgSubscriptionRoleGrant = await ensureRole(
    clientRPG,
    "TavernClientRPG",
    await clientRPG.SUBSCRIPTION_ROLE(),
    subscriptionAddress
  );

  const subscriptionClientRPGSetTx = await subscription.setClientRPG(clientRPGAddress);
  await subscriptionClientRPGSetTx.wait();

  const routerSubscriptionSetTx = await router.setSubscriptionContract(subscriptionAddress);
  await routerSubscriptionSetTx.wait();

  const verified = await verifyContract(subscriptionAddress, [usdcAddress, operatorWallet, registryAddress]);

  const notes = new Set(manifest.notes ?? []);
  notes.add("Task 28 adds TavernSubscription for per-agent monthly subscriptions and RPG-linked subscription EXP.");
  notes.add("Task 28 routes subscription fees to a configurable operator wallet because the in-Escrow fee receiver path exceeded the mainnet bytecode limit.");

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
      tavernSubscription: subscriptionAddress
    },
    constructorArgs: {
      ...manifest.constructorArgs,
      tavernSubscription: {
        usdc: usdcAddress,
        operatorWallet,
        registry: registryAddress
      }
    },
    rolesGranted: [
      ...(manifest.rolesGranted ?? []),
      subscriptionKeeperGrant,
      rpgSubscriptionRoleGrant
    ],
    notes: [...notes],
    task28Deploy: {
      executedAt: new Date().toISOString(),
      transactionHashes: {
        tavernSubscriptionDeploy: subscription.deploymentTransaction()?.hash ?? "",
        subscriptionKeeperGrant: subscriptionKeeperGrant.txHash,
        rpgSubscriptionRoleGrant: rpgSubscriptionRoleGrant.txHash,
        subscriptionClientRPGSet: subscriptionClientRPGSetTx.hash,
        routerSubscriptionSet: routerSubscriptionSetTx.hash
      },
      verification: {
        tavernSubscription: verified
      }
    },
    phase2Deploy: {
      executedAt: new Date().toISOString(),
      transactionHashes: {
        ...existingPhase2Deploy?.transactionHashes,
        subscriptionDeploy: subscription.deploymentTransaction()?.hash ?? "",
        routerSetSubscription: routerSubscriptionSetTx.hash,
        rpgSubscriptionRoleGrant: rpgSubscriptionRoleGrant.txHash,
        subscriptionKeeperGrant: subscriptionKeeperGrant.txHash
      },
      verification: {
        ...existingPhase2Deploy?.verification,
        tavernSubscription: verified
      }
    }
  };

  await mkdir(path.dirname(config.manifestPath), { recursive: true });
  await writeFile(config.manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

  console.log(`TavernSubscription deployed on ${network.name}: ${subscriptionAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
