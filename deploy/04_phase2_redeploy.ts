import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt, getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const { ethers, network, run } = hre;

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const LOCAL_HARDHAT_CHAIN_ID = 31337n;
const DEFAULT_BASE_SEPOLIA_RPC_URL = "https://base-sepolia-rpc.example";
const DEPLOYMENT_PATH = path.join(process.cwd(), "deployments", "baseSepolia.json");
const FRONTEND_PATH = path.join(process.cwd(), "claw-tavern-app.html");

const AUTOMATION_FORWARDERS = [
  "0xf69EDb49324CdE4E70B67EE8D12aBC3c9EED0Fa7",
  "0x9022b9B7E858246B7f9B18244012bF38C1880ca9",
  "0x70BC0311990098e0E4f5FfFAe7b6654DBC00cc70"
].map((address) => ethers.getAddress(address));

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
    tavernToken: string;
    tavernRegistry: string;
    tavernEscrow: string;
    tavernStaking?: string;
    tavernGovernance?: string | null;
    tavernAutomationRouter?: string | null;
  };
  constructorArgs: {
    tavernToken: null;
    tavernRegistry: {
      guildToken: string;
    };
    tavernEscrow: {
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
  optionalRoleTargets?: {
    arbiterAddress?: string | null;
    keeperAddress?: string | null;
  };
  rolesGranted?: RoleGrantRecord[];
  notes?: string[];
  legacyAddresses?: Array<{
    label: string;
    tavernRegistry: string;
    tavernEscrow: string;
    tavernStaking?: string | null;
    supersededAt: string;
    note: string;
  }>;
  phase2Redeploy?: {
    executedAt: string;
    transactionHashes: {
      tavernRegistryDeploy: string;
      tavernEscrowDeploy: string;
      tavernStakingDeploy: string;
      stakingContractSet: string;
    };
    verification: {
      tavernRegistry: boolean;
      tavernEscrow: boolean;
      tavernStaking: boolean;
    };
    automationForwarders: string[];
    nextStep: string;
  };
};

function validateAddress(name: string, value: string | undefined): string {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value ?? "undefined"}`);
  }

  return ethers.getAddress(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readDeploymentManifest(): Promise<DeploymentManifest> {
  const raw = await readFile(DEPLOYMENT_PATH, "utf8");
  return JSON.parse(raw) as DeploymentManifest;
}

async function ensureRole(
  contract: any,
  contractName: string,
  role: string,
  grantee: string,
  records: RoleGrantRecord[]
): Promise<void> {
  const hasRole = await contract.hasRole(role, grantee);

  if (hasRole) {
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
      await sleep(15000);
    }
  }

  return false;
}

async function assertPhase2RegistrySelectors(registry: any, registryAddress: string): Promise<void> {
  const probe = new ethers.Contract(
    registryAddress,
    ["function stakingContract() view returns (address)"],
    ethers.provider
  );

  try {
    await probe.stakingContract();
  } catch (error: any) {
    throw new Error(
      `Freshly deployed TavernRegistry at ${registryAddress} does not expose Phase 2 staking hooks. Aborting before downstream wiring. Root cause: ${error?.shortMessage ?? error?.message ?? error}`
    );
  }
}

async function updateFrontendAddresses(
  oldRegistry: string,
  newRegistry: string,
  oldEscrow: string,
  newEscrow: string
): Promise<void> {
  let html = await readFile(FRONTEND_PATH, "utf8");

  const replacements: Array<[string, string]> = [
    [oldRegistry, newRegistry],
    [oldEscrow, newEscrow],
    [shortAddress(oldRegistry), shortAddress(newRegistry)],
    [shortAddress(oldEscrow), shortAddress(newEscrow)]
  ];

  for (const [from, to] of replacements) {
    html = html.replace(new RegExp(escapeRegExp(from), "g"), to);
  }

  await writeFile(FRONTEND_PATH, html, "utf8");
}

async function main(): Promise<void> {
  await run("compile", { quiet: true, force: true });

  const [deployer] = await ethers.getSigners();
  const managedDeployer = new ethers.NonceManager(deployer);
  const currentNetwork = await ethers.provider.getNetwork();

  if (
    currentNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID &&
    currentNetwork.chainId !== LOCAL_HARDHAT_CHAIN_ID
  ) {
    throw new Error(
      `This redeploy script is configured for Base Sepolia (84532). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  if (currentNetwork.chainId === LOCAL_HARDHAT_CHAIN_ID) {
    throw new Error("deploy/04_phase2_redeploy.ts is intended for Base Sepolia only.");
  }

  const manifest = await readDeploymentManifest();
  const tokenAddress = validateAddress("addresses.tavernToken", manifest.addresses.tavernToken);
  const oldRegistryAddress = validateAddress("addresses.tavernRegistry", manifest.addresses.tavernRegistry);
  const oldEscrowAddress = validateAddress("addresses.tavernEscrow", manifest.addresses.tavernEscrow);
  const oldStakingAddress = manifest.addresses.tavernStaking
    ? validateAddress("addresses.tavernStaking", manifest.addresses.tavernStaking)
    : null;
  const reusedRegistryAddress = process.env.PHASE2_REUSE_REGISTRY_ADDRESS
    ? validateAddress("PHASE2_REUSE_REGISTRY_ADDRESS", process.env.PHASE2_REUSE_REGISTRY_ADDRESS)
    : null;
  const reusedRegistryTxHash = process.env.PHASE2_REUSE_REGISTRY_TX_HASH ?? "";
  const reusedEscrowAddress = process.env.PHASE2_REUSE_ESCROW_ADDRESS
    ? validateAddress("PHASE2_REUSE_ESCROW_ADDRESS", process.env.PHASE2_REUSE_ESCROW_ADDRESS)
    : null;
  const reusedEscrowTxHash = process.env.PHASE2_REUSE_ESCROW_TX_HASH ?? "";
  const reusedStakingAddress = process.env.PHASE2_REUSE_STAKING_ADDRESS
    ? validateAddress("PHASE2_REUSE_STAKING_ADDRESS", process.env.PHASE2_REUSE_STAKING_ADDRESS)
    : null;
  const reusedStakingTxHash = process.env.PHASE2_REUSE_STAKING_TX_HASH ?? "";

  const usdc = validateAddress("constructorArgs.tavernEscrow.usdc", manifest.constructorArgs.tavernEscrow.usdc);
  const ethUsdFeed = validateAddress(
    "constructorArgs.tavernEscrow.ethUsdFeed",
    manifest.constructorArgs.tavernEscrow.ethUsdFeed
  );
  const tvrnUsdFeed = validateAddress(
    "constructorArgs.tavernEscrow.tvrnUsdFeed",
    manifest.constructorArgs.tavernEscrow.tvrnUsdFeed
  );

  const token = await getWorkspaceContractAt("TavernToken", tokenAddress, managedDeployer);

  const TavernRegistry = await getWorkspaceContractFactory("TavernRegistry", managedDeployer);
  const newRegistry = reusedRegistryAddress
    ? await getWorkspaceContractAt("TavernRegistry", reusedRegistryAddress, managedDeployer)
    : await TavernRegistry.deploy(tokenAddress);

  if (!reusedRegistryAddress) {
    await newRegistry.waitForDeployment();
  }

  const newRegistryAddress = await newRegistry.getAddress();
  await assertPhase2RegistrySelectors(newRegistry, newRegistryAddress);

  const TavernEscrow = await ethers.getContractFactory("TavernEscrow", managedDeployer);
  const newEscrow = reusedEscrowAddress
    ? await ethers.getContractAt("TavernEscrow", reusedEscrowAddress, managedDeployer)
    : await TavernEscrow.deploy(usdc, tokenAddress, newRegistryAddress, ethUsdFeed, tvrnUsdFeed);

  if (!reusedEscrowAddress) {
    await newEscrow.waitForDeployment();
  }

  const newEscrowAddress = await newEscrow.getAddress();

  const TavernStaking = await getWorkspaceContractFactory("TavernStaking", managedDeployer);
  const newStaking = reusedStakingAddress
    ? await getWorkspaceContractAt("TavernStaking", reusedStakingAddress, managedDeployer)
    : await TavernStaking.deploy(tokenAddress, newRegistryAddress);

  if (!reusedStakingAddress) {
    await newStaking.waitForDeployment();
  }

  const newStakingAddress = await newStaking.getAddress();

  const rolesGranted: RoleGrantRecord[] = [];

  await ensureRole(token, "TavernToken", await token.MINTER_ROLE(), newRegistryAddress, rolesGranted);
  await ensureRole(token, "TavernToken", await token.MINTER_ROLE(), newEscrowAddress, rolesGranted);
  await ensureRole(token, "TavernToken", await token.ESCROW_ROLE(), newEscrowAddress, rolesGranted);
  await ensureRole(token, "TavernToken", await token.BURNER_ROLE(), newStakingAddress, rolesGranted);

  await ensureRole(
    newRegistry,
    "TavernRegistry",
    await newRegistry.ARBITER_ROLE(),
    deployer.address,
    rolesGranted
  );
  await ensureRole(
    newRegistry,
    "TavernRegistry",
    await newRegistry.ARBITER_ROLE(),
    newEscrowAddress,
    rolesGranted
  );

  for (const forwarder of AUTOMATION_FORWARDERS) {
    await ensureRole(
      newRegistry,
      "TavernRegistry",
      await newRegistry.KEEPER_ROLE(),
      forwarder,
      rolesGranted
    );
    await ensureRole(
      newEscrow,
      "TavernEscrow",
      await newEscrow.KEEPER_ROLE(),
      forwarder,
      rolesGranted
    );
  }

  const setStakingTx = await newRegistry.setStakingContract(newStakingAddress);
  await setStakingTx.wait();

  const nextManifest: DeploymentManifest = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId),
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? DEFAULT_BASE_SEPOLIA_RPC_URL
    },
    deployer: deployer.address,
    addresses: {
      ...manifest.addresses,
      tavernToken: tokenAddress,
      tavernRegistry: newRegistryAddress,
      tavernEscrow: newEscrowAddress,
      tavernStaking: newStakingAddress,
      tavernGovernance: manifest.addresses.tavernGovernance ?? null,
      tavernAutomationRouter: manifest.addresses.tavernAutomationRouter ?? null
    },
    constructorArgs: {
      ...manifest.constructorArgs,
      tavernRegistry: {
        guildToken: tokenAddress
      },
      tavernEscrow: {
        usdc,
        tavernToken: tokenAddress,
        registry: newRegistryAddress,
        ethUsdFeed,
        tvrnUsdFeed
      },
      tavernStaking: {
        tavernToken: tokenAddress,
        registry: newRegistryAddress
      },
      tavernGovernance: manifest.constructorArgs.tavernGovernance ?? null,
      tavernAutomationRouter: manifest.constructorArgs.tavernAutomationRouter ?? null
    },
    rolesGranted: [...(manifest.rolesGranted ?? []), ...rolesGranted],
    legacyAddresses: [
      ...(manifest.legacyAddresses ?? []),
      {
        label: "Phase 1 / pre-Phase 2 redeploy",
        tavernRegistry: oldRegistryAddress,
        tavernEscrow: oldEscrowAddress,
        tavernStaking: oldStakingAddress,
        supersededAt: new Date().toISOString(),
        note: "Superseded by deploy/04_phase2_redeploy.ts on Base Sepolia."
      }
    ],
    phase2Redeploy: {
      executedAt: new Date().toISOString(),
      transactionHashes: {
        tavernRegistryDeploy: newRegistry.deploymentTransaction()?.hash ?? "",
        tavernEscrowDeploy: newEscrow.deploymentTransaction()?.hash ?? "",
        tavernStakingDeploy: newStaking.deploymentTransaction()?.hash ?? "",
        stakingContractSet: setStakingTx.hash
      },
      verification: {
        tavernRegistry: false,
        tavernEscrow: false,
        tavernStaking: false
      },
      automationForwarders: AUTOMATION_FORWARDERS,
      nextStep:
        "Run `npx hardhat run scripts/register-automation.ts --network baseSepolia` to re-register upkeeps for new contract addresses."
    },
    notes: [
      ...(manifest.notes ?? []),
      `Phase 2 redeploy superseded TavernRegistry ${oldRegistryAddress}, TavernEscrow ${oldEscrowAddress}, and TavernStaking ${oldStakingAddress ?? "n/a"}.`,
      "TavernToken was intentionally reused so balances and token state remain intact.",
      "Forwarders were granted KEEPER_ROLE on the new TavernRegistry and TavernEscrow.",
      "Re-register Chainlink Automation upkeeps against the new contract addresses.",
      ...(reusedRegistryAddress
        ? [
            `Phase 2 redeploy reused a previously deployed TavernRegistry at ${reusedRegistryAddress} after an earlier run stopped before downstream wiring.`
          ]
        : []),
      ...(reusedEscrowAddress
        ? [
            `Phase 2 redeploy reused a previously deployed TavernEscrow at ${reusedEscrowAddress} after an earlier run stopped before role wiring.`
          ]
        : []),
      ...(reusedStakingAddress
        ? [
            `Phase 2 redeploy reused a previously deployed TavernStaking at ${reusedStakingAddress} after an earlier run stopped before role wiring.`
          ]
        : [])
    ]
  };

  nextManifest.phase2Redeploy!.transactionHashes.tavernRegistryDeploy =
    newRegistry.deploymentTransaction()?.hash ?? reusedRegistryTxHash;
  nextManifest.phase2Redeploy!.transactionHashes.tavernEscrowDeploy =
    newEscrow.deploymentTransaction()?.hash ?? reusedEscrowTxHash;
  nextManifest.phase2Redeploy!.transactionHashes.tavernStakingDeploy =
    newStaking.deploymentTransaction()?.hash ?? reusedStakingTxHash;

  await mkdir(path.dirname(DEPLOYMENT_PATH), { recursive: true });
  await writeFile(DEPLOYMENT_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
  await updateFrontendAddresses(oldRegistryAddress, newRegistryAddress, oldEscrowAddress, newEscrowAddress);

  const registryVerified = await verifyContract("TavernRegistry", newRegistryAddress, [tokenAddress]);
  const escrowVerified = await verifyContract("TavernEscrow", newEscrowAddress, [
    usdc,
    tokenAddress,
    newRegistryAddress,
    ethUsdFeed,
    tvrnUsdFeed
  ]);
  const stakingVerified = await verifyContract("TavernStaking", newStakingAddress, [
    tokenAddress,
    newRegistryAddress
  ]);

  nextManifest.phase2Redeploy = {
    ...nextManifest.phase2Redeploy!,
    verification: {
      tavernRegistry: registryVerified,
      tavernEscrow: escrowVerified,
      tavernStaking: stakingVerified
    }
  };

  await writeFile(DEPLOYMENT_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

  console.log(`Phase 2 redeploy complete on ${network.name}`);
  console.log(`TavernToken reused:   ${tokenAddress}`);
  console.log(`TavernRegistry new:   ${newRegistryAddress}`);
  console.log(`TavernEscrow new:     ${newEscrowAddress}`);
  console.log(`TavernStaking new:    ${newStakingAddress}`);
  console.log(
    "Run `npx hardhat run scripts/register-automation.ts --network baseSepolia` to re-register upkeeps for new contract addresses."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
