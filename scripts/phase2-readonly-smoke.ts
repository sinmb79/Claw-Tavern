import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt } from "./utils/hardhatContracts";

const { ethers, network } = hre;

type DeploymentManifest = {
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
};

const NETWORK_CONFIG = {
  baseSepolia: {
    chainId: 84532n,
    manifestPath: path.join(process.cwd(), "deployments", "baseSepolia.json"),
    outputPath: path.join(process.cwd(), "test", "phase2-smoke-baseSepolia.json")
  },
  base: {
    chainId: 8453n,
    manifestPath: path.join(process.cwd(), "deployments", "base.json"),
    outputPath: path.join(process.cwd(), "test", "phase2-smoke-base.json")
  }
} as const;

function requireAddress(name: string, value: string | undefined | null): string {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value ?? "undefined"}`);
  }

  return ethers.getAddress(value);
}

async function readManifest(manifestPath: string): Promise<DeploymentManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as DeploymentManifest;
}

async function main(): Promise<void> {
  if (!(network.name in NETWORK_CONFIG)) {
    throw new Error(`phase2-readonly-smoke only supports baseSepolia or base. Current network: ${network.name}`);
  }

  const config = NETWORK_CONFIG[network.name as keyof typeof NETWORK_CONFIG];
  const chain = await ethers.provider.getNetwork();
  if (chain.chainId !== config.chainId) {
    throw new Error(`Expected chainId ${config.chainId.toString()}, received ${chain.chainId.toString()}`);
  }

  const manifest = await readManifest(config.manifestPath);
  const adminPriceFeedAddress = requireAddress("addresses.adminPriceFeed", manifest.addresses.adminPriceFeed);
  const tokenAddress = requireAddress("addresses.tavernToken", manifest.addresses.tavernToken);
  const registryAddress = requireAddress("addresses.tavernRegistry", manifest.addresses.tavernRegistry);
  const escrowAddress = requireAddress("addresses.tavernEscrow", manifest.addresses.tavernEscrow);
  const stakingAddress = requireAddress("addresses.tavernStaking", manifest.addresses.tavernStaking);
  const governanceAddress = requireAddress("addresses.tavernGovernance", manifest.addresses.tavernGovernance);
  const routerAddress = requireAddress("addresses.tavernAutomationRouter", manifest.addresses.tavernAutomationRouter);
  const rpgAddress = requireAddress("addresses.tavernClientRPG", manifest.addresses.tavernClientRPG);
  const subscriptionAddress = requireAddress("addresses.tavernSubscription", manifest.addresses.tavernSubscription);

  const adminPriceFeed: any = await getWorkspaceContractAt("AdminPriceFeed", adminPriceFeedAddress);
  const token: any = await getWorkspaceContractAt("TavernToken", tokenAddress);
  const registry: any = await getWorkspaceContractAt("TavernRegistry", registryAddress);
  const escrow: any = await getWorkspaceContractAt("TavernEscrow", escrowAddress);
  const staking: any = await getWorkspaceContractAt("TavernStaking", stakingAddress);
  const governance: any = await getWorkspaceContractAt("TavernGovernance", governanceAddress);
  const router: any = await getWorkspaceContractAt("TavernAutomationRouter", routerAddress);
  const rpg: any = await getWorkspaceContractAt("TavernClientRPG", rpgAddress);
  const subscription: any = await getWorkspaceContractAt("TavernSubscription", subscriptionAddress);

  const usdcAddress = await subscription.usdc();
  const usdc = await ethers.getContractAt(["function balanceOf(address account) view returns (uint256)"], usdcAddress);
  const latestRoundData = await adminPriceFeed.latestRoundData();
  const latestPrice = (latestRoundData.answer ?? latestRoundData[1]) as bigint;
  const latestUpdatedAt = (latestRoundData.updatedAt ?? latestRoundData[3]) as bigint;
  const [upkeepNeeded] = await router.checkUpkeep.staticCall("0x");
  const rpgEscrowRole = await rpg.ESCROW_ROLE();
  const rpgKeeperRole = await rpg.KEEPER_ROLE();
  const rpgSubscriptionRole = await rpg.SUBSCRIPTION_ROLE();
  const subscriptionKeeperRole = await subscription.KEEPER_ROLE();

  const result = {
    executedAt: new Date().toISOString(),
    network: network.name,
    chainId: Number(chain.chainId),
    addresses: {
      adminPriceFeed: adminPriceFeedAddress,
      tavernToken: tokenAddress,
      tavernRegistry: registryAddress,
      tavernEscrow: escrowAddress,
      tavernStaking: stakingAddress,
      tavernGovernance: governanceAddress,
      tavernAutomationRouter: routerAddress,
      tavernClientRPG: rpgAddress,
      tavernSubscription: subscriptionAddress
    },
    token: {
      maxSupply: (await token.MAX_SUPPLY()).toString(),
      totalSupply: (await token.totalSupply()).toString()
    },
    registry: {
      stakingContract: await registry.stakingContract(),
      guildCount: (await registry.guildCount()).toString(),
      erc8004Required: await registry.erc8004Required()
    },
    escrow: {
      maxQuestDeposit: (await escrow.maxQuestDeposit()).toString(),
      maxQuestDepositUsdc: (await escrow.maxQuestDepositUsdc()).toString(),
      settlementPaused: await escrow.settlementPaused(),
      currentFeeStage: (await escrow.currentFeeStage()).toString()
    },
    staking: {
      stakeAmount: (await staking.STAKE_AMOUNT()).toString(),
      slashEjectionBps: (await staking.SLASH_EJECTION_BPS()).toString(),
      slashChallengeBps: (await staking.SLASH_CHALLENGE_BPS()).toString()
    },
    governance: {
      votingPeriod: (await governance.VOTING_PERIOD()).toString(),
      timelockDelay: (await governance.TIMELOCK_DELAY()).toString(),
      quorumBps: (await governance.QUORUM_BPS()).toString()
    },
    adminPriceFeed: {
      decimals: (await adminPriceFeed.decimals()).toString(),
      latestPrice: latestPrice.toString(),
      updatedAt: latestUpdatedAt.toString(),
      routerIsRefresher: await adminPriceFeed.isRefresher(routerAddress)
    },
    rpg: {
      seasonDuration: (await rpg.SEASON_DURATION()).toString(),
      currentSeasonNumber: (await rpg.currentSeasonNumber()).toString(),
      minWithdrawalLevel: (await rpg.MIN_WITHDRAWAL_LEVEL()).toString(),
      minJobsForWithdrawal: (await rpg.MIN_JOBS_FOR_WITHDRAWAL()).toString(),
      maxWithdrawalPerMonth: (await rpg.MAX_WITHDRAWAL_PER_MONTH()).toString(),
      escrow: await rpg.escrow(),
      hasEscrowRole: await rpg.hasRole(rpgEscrowRole, escrowAddress),
      hasKeeperRoleForRouter: await rpg.hasRole(rpgKeeperRole, routerAddress),
      hasSubscriptionRoleForSubscription: await rpg.hasRole(rpgSubscriptionRole, subscriptionAddress)
    },
    subscription: {
      feeBps: (await subscription.SUBSCRIPTION_FEE_BPS()).toString(),
      period: (await subscription.SUBSCRIPTION_PERIOD()).toString(),
      contractUsdcBalance: (await usdc.balanceOf(subscriptionAddress)).toString(),
      operatorWallet: await subscription.operatorWallet(),
      clientRPG: await subscription.clientRPG(),
      registry: await subscription.registry(),
      usdc: usdcAddress,
      hasKeeperRoleForRouter: await subscription.hasRole(subscriptionKeeperRole, routerAddress)
    },
    router: {
      clientRPG: await router.clientRPG(),
      subscriptionContract: await router.subscriptionContract(),
      upkeepNeeded
    }
  };

  await mkdir(path.dirname(config.outputPath), { recursive: true });
  await writeFile(config.outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
