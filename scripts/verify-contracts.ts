import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { ethers } from "ethers";

type DeploymentManifest = {
  addresses: {
    adminPriceFeed?: string | null;
    mockUsdc?: string | null;
    tavernEscrow: string;
    tavernAutomationRouter?: string | null;
    tavernClientRPG?: string | null;
    tavernGovernance?: string | null;
    tavernRegistry: string;
    tavernSubscription?: string | null;
    tavernToken: string;
    tavernStaking?: string;
  };
  constructorArgs: {
    adminPriceFeed?: {
      initialPrice: number;
    } | null;
    tavernEscrow: {
      usdc: string;
      tavernToken: string;
      registry: string;
      ethUsdFeed: string;
      tvrnUsdFeed: string;
    };
    tavernRegistry: {
      guildToken: string;
    };
    tavernGovernance?: {
      tavernToken: string;
      registry: string;
    } | null;
    tavernAutomationRouter?: {
      escrow: string;
      registry: string;
      priceFeed: string;
    } | null;
    tavernClientRPG?: {
      tavernToken: string;
      escrow: string;
    } | null;
    tavernSubscription?: {
      usdc: string;
      operatorWallet: string;
      registry: string;
    } | null;
    tavernStaking?: {
      tavernToken: string;
      registry: string;
    };
    tavernToken: null;
  };
};

type VerificationJob = {
  address: string;
  args: string[];
  name: string;
};

const BASE_SEPOLIA = "baseSepolia";
const MANIFEST_PATH = path.join(process.cwd(), "deployments", "baseSepolia.json");

function validateAddress(name: string, value: string): string {
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }

  return ethers.getAddress(value);
}

async function readDeploymentManifest(): Promise<DeploymentManifest> {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  return JSON.parse(raw) as DeploymentManifest;
}

async function runVerify(job: VerificationJob): Promise<void> {
  const args = [
    "hardhat",
    "verify",
    "--network",
    BASE_SEPOLIA,
    job.address,
    ...job.args
  ];

  console.log(`\nVerifying ${job.name} at ${job.address}`);

  const result = await new Promise<{ exitCode: number | null; output: string }>((resolve, reject) => {
    const chunks: string[] = [];
    const child = spawn("npx", args, {
      cwd: process.cwd(),
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      chunks.push(text);
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      chunks.push(text);
      process.stderr.write(text);
    });

    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, output: chunks.join("") }));
  });

  const normalizedOutput = result.output.toLowerCase();

  if (
    normalizedOutput.includes("already verified") ||
    normalizedOutput.includes("source code already verified") ||
    normalizedOutput.includes("contract source code already verified")
  ) {
    console.log(`Skipped ${job.name}: already verified on Basescan.`);
    return;
  }

  if (
    normalizedOutput.includes("successfully submitted") ||
    normalizedOutput.includes("successfully verified")
  ) {
    console.log(`Verified ${job.name}.`);
    return;
  }

  if (result.exitCode === 0 && normalizedOutput.includes("nothing to compile")) {
    console.log(`Verification command completed for ${job.name}. Check Basescan if needed.`);
    return;
  }

  if (result.exitCode !== 0) {
    throw new Error(`hardhat verify exited with code ${result.exitCode ?? -1}`);
  }

  console.error(`Verification for ${job.name} finished without a clear success marker. Review the log above.`);
}

async function main(): Promise<void> {
  const manifest = await readDeploymentManifest();

  const jobs: VerificationJob[] = [
    ...(manifest.addresses.adminPriceFeed && manifest.constructorArgs.adminPriceFeed
      ? [
          {
            name: "AdminPriceFeed",
            address: validateAddress("addresses.adminPriceFeed", manifest.addresses.adminPriceFeed),
            args: [String(manifest.constructorArgs.adminPriceFeed.initialPrice)]
          }
        ]
      : []),
    {
      name: "TavernToken",
      address: validateAddress("addresses.tavernToken", manifest.addresses.tavernToken),
      args: []
    },
    {
      name: "TavernRegistry",
      address: validateAddress("addresses.tavernRegistry", manifest.addresses.tavernRegistry),
      args: [
        validateAddress(
          "constructorArgs.tavernRegistry.guildToken",
          manifest.constructorArgs.tavernRegistry.guildToken
        )
      ]
    },
    {
      name: "TavernEscrow",
      address: validateAddress("addresses.tavernEscrow", manifest.addresses.tavernEscrow),
      args: [
        validateAddress("constructorArgs.tavernEscrow.usdc", manifest.constructorArgs.tavernEscrow.usdc),
        validateAddress(
          "constructorArgs.tavernEscrow.tavernToken",
          manifest.constructorArgs.tavernEscrow.tavernToken
        ),
        validateAddress(
          "constructorArgs.tavernEscrow.registry",
          manifest.constructorArgs.tavernEscrow.registry
        ),
        validateAddress(
          "constructorArgs.tavernEscrow.ethUsdFeed",
          manifest.constructorArgs.tavernEscrow.ethUsdFeed
        ),
        validateAddress(
          "constructorArgs.tavernEscrow.tvrnUsdFeed",
          manifest.constructorArgs.tavernEscrow.tvrnUsdFeed
        )
      ]
    }
  ];

  if (manifest.addresses.tavernStaking && manifest.constructorArgs.tavernStaking) {
    jobs.push({
      name: "TavernStaking",
      address: validateAddress("addresses.tavernStaking", manifest.addresses.tavernStaking),
      args: [
        validateAddress(
          "constructorArgs.tavernStaking.tavernToken",
          manifest.constructorArgs.tavernStaking.tavernToken
        ),
        validateAddress(
          "constructorArgs.tavernStaking.registry",
          manifest.constructorArgs.tavernStaking.registry
        )
      ]
    });
  }

  if (manifest.addresses.tavernGovernance && manifest.constructorArgs.tavernGovernance) {
    jobs.push({
      name: "TavernGovernance",
      address: validateAddress("addresses.tavernGovernance", manifest.addresses.tavernGovernance),
      args: [
        validateAddress(
          "constructorArgs.tavernGovernance.tavernToken",
          manifest.constructorArgs.tavernGovernance.tavernToken
        ),
        validateAddress(
          "constructorArgs.tavernGovernance.registry",
          manifest.constructorArgs.tavernGovernance.registry
        )
      ]
    });
  }

  if (manifest.addresses.tavernAutomationRouter && manifest.constructorArgs.tavernAutomationRouter) {
    jobs.push({
      name: "TavernAutomationRouter",
      address: validateAddress(
        "addresses.tavernAutomationRouter",
        manifest.addresses.tavernAutomationRouter
      ),
      args: [
        validateAddress(
          "constructorArgs.tavernAutomationRouter.escrow",
          manifest.constructorArgs.tavernAutomationRouter.escrow
        ),
        validateAddress(
          "constructorArgs.tavernAutomationRouter.registry",
          manifest.constructorArgs.tavernAutomationRouter.registry
        ),
        validateAddress(
          "constructorArgs.tavernAutomationRouter.priceFeed",
          manifest.constructorArgs.tavernAutomationRouter.priceFeed
        )
      ]
    });
  }

  if (manifest.addresses.tavernClientRPG && manifest.constructorArgs.tavernClientRPG) {
    jobs.push({
      name: "TavernClientRPG",
      address: validateAddress("addresses.tavernClientRPG", manifest.addresses.tavernClientRPG),
      args: [
        validateAddress(
          "constructorArgs.tavernClientRPG.tavernToken",
          manifest.constructorArgs.tavernClientRPG.tavernToken
        ),
        validateAddress(
          "constructorArgs.tavernClientRPG.escrow",
          manifest.constructorArgs.tavernClientRPG.escrow
        )
      ]
    });
  }

  if (manifest.addresses.tavernSubscription && manifest.constructorArgs.tavernSubscription) {
    jobs.push({
      name: "TavernSubscription",
      address: validateAddress("addresses.tavernSubscription", manifest.addresses.tavernSubscription),
      args: [
        validateAddress(
          "constructorArgs.tavernSubscription.usdc",
          manifest.constructorArgs.tavernSubscription.usdc
        ),
        validateAddress(
          "constructorArgs.tavernSubscription.operatorWallet",
          manifest.constructorArgs.tavernSubscription.operatorWallet
        ),
        validateAddress(
          "constructorArgs.tavernSubscription.registry",
          manifest.constructorArgs.tavernSubscription.registry
        )
      ]
    });
  }

  for (const job of jobs) {
    try {
      await runVerify(job);
    } catch (error) {
      console.error(`Verification failed for ${job.name}, continuing to the next contract.`);
      console.error(error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
