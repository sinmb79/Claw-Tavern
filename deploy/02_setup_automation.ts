import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ethers, network } from "hardhat";

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const LOCAL_HARDHAT_CHAIN_ID = 31337n;

const DEFAULT_AUTOMATION_REGISTRY = "0x91D4a4C3D448c7f3CB477332B1c7D420a5810aC3";
const DEFAULT_AUTOMATION_REGISTRAR = ethers.ZeroAddress;
const KEEPER_ROLE = ethers.id("KEEPER_ROLE");
const AUTOMATION_PATH = path.join(process.cwd(), "deployments", "baseSepolia.automation.json");

type RoleGrantRecord = {
  contract: string;
  role: string;
  grantee: string;
  txHash: string | null;
  status: "granted" | "already-granted";
};

type DeploymentManifest = {
  addresses: {
    tavernRegistry: string;
    tavernEscrow: string;
    tavernToken: string;
  };
};

type ExistingAutomationManifest = {
  upkeeps?: Array<{
    upkeepId?: string | null;
  }>;
};

function getRequiredAddress(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;

  if (!ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }

  return ethers.getAddress(value);
}

function getOptionalAddress(name: string): string | null {
  const value = process.env[name]?.trim();

  if (!value) {
    return null;
  }

  if (!ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }

  return ethers.getAddress(value);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function backupJsonFile(filePath: string, value: unknown): Promise<string> {
  const backupPath = filePath.endsWith(".json")
    ? filePath.replace(/\.json$/i, ".backup.json")
    : `${filePath}.backup.json`;
  await writeFile(backupPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return backupPath;
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

async function main(): Promise<void> {
  const currentNetwork = await ethers.provider.getNetwork();

  if (
    currentNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID &&
    currentNetwork.chainId !== LOCAL_HARDHAT_CHAIN_ID
  ) {
    throw new Error(
      `This automation setup is configured for Base Sepolia (84532). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const deploymentPath = path.join(process.cwd(), "deployments", "baseSepolia.json");
  const deployment = JSON.parse(
    await readFile(deploymentPath, "utf8")
  ) as DeploymentManifest;

  const existingManifest = await readJsonFile<ExistingAutomationManifest>(AUTOMATION_PATH);
  const hasRegisteredUpkeepIds =
    existingManifest?.upkeeps?.some(
      (upkeep) => typeof upkeep.upkeepId === "string" && upkeep.upkeepId.length > 0
    ) ?? false;

  if (hasRegisteredUpkeepIds && !process.argv.includes("--force")) {
    console.log("Automation manifest already contains registered upkeeps. Use --force to overwrite.");
    return;
  }

  if (existingManifest && hasRegisteredUpkeepIds) {
    const backupPath = await backupJsonFile(AUTOMATION_PATH, existingManifest);
    console.log(`Backed up existing automation manifest to ${backupPath}`);
  }

  const automationRegistryAddress = getRequiredAddress(
    "CHAINLINK_AUTOMATION_REGISTRY_ADDRESS",
    DEFAULT_AUTOMATION_REGISTRY
  );
  const automationRegistrarAddress = getRequiredAddress(
    "CHAINLINK_AUTOMATION_REGISTRAR_ADDRESS",
    DEFAULT_AUTOMATION_REGISTRAR
  );
  const automationForwarderAddress = getOptionalAddress(
    "CHAINLINK_AUTOMATION_FORWARDER_ADDRESS"
  );

  const roleGrants: RoleGrantRecord[] = [];
  const registryCode = await ethers.provider.getCode(deployment.addresses.tavernRegistry);
  const escrowCode = await ethers.provider.getCode(deployment.addresses.tavernEscrow);
  const contractsAvailable = registryCode !== "0x" && escrowCode !== "0x";

  if (contractsAvailable) {
    const tavernRegistryRoleContract = await ethers.getContractAt(
      [
        "function hasRole(bytes32 role, address account) view returns (bool)",
        "function grantRole(bytes32 role, address account)"
      ],
      deployment.addresses.tavernRegistry
    );
    const tavernEscrowRoleContract = await ethers.getContractAt(
      [
        "function hasRole(bytes32 role, address account) view returns (bool)",
        "function grantRole(bytes32 role, address account)"
      ],
      deployment.addresses.tavernEscrow
    );

    await ensureRole(
      tavernRegistryRoleContract,
      "TavernRegistry",
      KEEPER_ROLE,
      automationRegistryAddress,
      roleGrants
    );
    await ensureRole(
      tavernEscrowRoleContract,
      "TavernEscrow",
      KEEPER_ROLE,
      automationRegistryAddress,
      roleGrants
    );

    if (automationForwarderAddress) {
      await ensureRole(
        tavernRegistryRoleContract,
        "TavernRegistry",
        KEEPER_ROLE,
        automationForwarderAddress,
        roleGrants
      );
      await ensureRole(
        tavernEscrowRoleContract,
        "TavernEscrow",
        KEEPER_ROLE,
        automationForwarderAddress,
        roleGrants
      );
    }
  }

  const tavernRegistryInterface = new ethers.Interface([
    "function dailyQuotaRebalance(uint256[6])"
  ]);
  const tavernEscrowInterface = new ethers.Interface([
    "function executeTimeout(uint256)",
    "function checkAndUpgradeFeeStage()"
  ]);

  const dailyQuotaExample = tavernRegistryInterface.encodeFunctionData(
    "dailyQuotaRebalance",
    [[0n, 0n, 0n, 0n, 0n, 0n]]
  );
  const timeoutExample = tavernEscrowInterface.encodeFunctionData("executeTimeout", [0n]);
  const feeStageExample = tavernEscrowInterface.encodeFunctionData("checkAndUpgradeFeeStage");

  await mkdir(path.dirname(AUTOMATION_PATH), { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId)
    },
    chainlink: {
      automationRegistry: automationRegistryAddress,
      automationRegistrar:
        automationRegistrarAddress === ethers.ZeroAddress
          ? "TODO_BASE_SEPOLIA_AUTOMATION_REGISTRAR"
          : automationRegistrarAddress,
      automationForwarder:
        automationForwarderAddress ?? "TODO_AFTER_UPKEEP_REGISTRATION",
      notes: [
        "Base Sepolia Automation registry defaults to 0x91D4a4C3D448c7f3CB477332B1c7D420a5810aC3 from automation.chain.link.",
        "Grant the final Chainlink Forwarder address once each upkeep is registered; the forwarder is the actual caller for production upkeeps.",
        contractsAvailable
          ? "Onchain KEEPER_ROLE grants were executed against the deployed contracts."
          : "No contract bytecode was found at the manifest addresses on the current network, so this run generated the automation manifest without sending role-grant transactions."
      ]
    },
    roleGrantMode: contractsAvailable ? "executed" : "manifest-only",
    permissions: roleGrants,
    upkeeps: [
      {
        name: "dailyQuotaRebalance",
        target: deployment.addresses.tavernRegistry,
        signature: "dailyQuotaRebalance(uint256[6])",
        selector: tavernRegistryInterface.getFunction("dailyQuotaRebalance")?.selector ?? null,
        sampleCalldata: dailyQuotaExample,
        trigger: "time-based",
        schedule: {
          timezone: "Asia/Seoul",
          localTime: "07:00"
        },
        status: "wrapper-required",
        note: "The registry function needs an offchain-computed six-slot score array, so a wrapper contract or an offchain resolver/keeper bot is required before full Chainlink Automation registration."
      },
      {
        name: "executeTimeout",
        target: deployment.addresses.tavernEscrow,
        signature: "executeTimeout(uint256)",
        selector: tavernEscrowInterface.getFunction("executeTimeout")?.selector ?? null,
        sampleCalldata: timeoutExample,
        trigger: "custom-logic",
        schedule: {
          recommendedIntervalMinutes: 15
        },
        status: "resolver-required",
        note: "The escrow function needs a concrete questId. Use a wrapper or offchain keeper that scans quests and calls executeTimeout for eligible ids."
      },
      {
        name: "checkAndUpgradeFeeStage",
        target: deployment.addresses.tavernEscrow,
        signature: "checkAndUpgradeFeeStage()",
        selector: tavernEscrowInterface.getFunction("checkAndUpgradeFeeStage")?.selector ?? null,
        sampleCalldata: feeStageExample,
        trigger: "periodic-check",
        schedule: {
          recommendedIntervalMinutes: 60
        },
        status: "wrapper-recommended",
        note: "This is the simplest upkeep because it has no arguments, but the contract still lacks Chainlink Automation-compatible check/perform hooks. A thin wrapper or relayer remains the cleanest production path."
      }
    ],
    nextSteps: [
      "Register wrapper or resolver-based upkeeps for dailyQuotaRebalance and executeTimeout.",
      "After Chainlink returns a Forwarder address for each upkeep, rerun this script with CHAINLINK_AUTOMATION_FORWARDER_ADDRESS set to grant final KEEPER_ROLE access.",
      "Replace any zero-address placeholders before production compensation logic is exercised."
    ]
  };

  await writeFile(AUTOMATION_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Automation manifest saved to ${AUTOMATION_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
