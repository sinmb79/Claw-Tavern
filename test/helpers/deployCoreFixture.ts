import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import { getWorkspaceContractFactory } from "../../scripts/utils/hardhatContracts";

export async function deployCoreFixture() {
  const [deployer, client, agent, keeper, recipient, referrer, masterFounder, masterSuccessor, arbiter, other] =
    await ethers.getSigners();
  const now = await time.latest();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc: any = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const ethUsdFeed: any = await MockV3Aggregator.deploy(8, 2_000n * 10n ** 8n, now);
  await ethUsdFeed.waitForDeployment();
  const tvrnUsdFeed: any = await MockV3Aggregator.deploy(8, 1n * 10n ** 8n, now);
  await tvrnUsdFeed.waitForDeployment();

  const TavernToken = await getWorkspaceContractFactory("TavernToken");
  const token: any = await TavernToken.deploy();
  await token.waitForDeployment();

  const TavernRegistry = await getWorkspaceContractFactory("TavernRegistry");
  const registry: any = await TavernRegistry.deploy(await token.getAddress());
  await registry.waitForDeployment();

  const TavernEscrow = await getWorkspaceContractFactory("TavernEscrow");
  const escrow: any = await TavernEscrow.deploy(
    await usdc.getAddress(),
    await token.getAddress(),
    await registry.getAddress(),
    await ethUsdFeed.getAddress(),
    await tvrnUsdFeed.getAddress()
  );
  await escrow.waitForDeployment();

  const TavernClientRPG = await getWorkspaceContractFactory("TavernClientRPG");
  const clientRPG: any = await TavernClientRPG.deploy(await token.getAddress(), await escrow.getAddress());
  await clientRPG.waitForDeployment();

  const TavernStaking = await getWorkspaceContractFactory("TavernStaking");
  const staking: any = await TavernStaking.deploy(await token.getAddress(), await registry.getAddress());
  await staking.waitForDeployment();

  await token.grantRole(await token.MINTER_ROLE(), deployer.address);
  await token.grantRole(await token.MINTER_ROLE(), await registry.getAddress());
  await token.grantRole(await token.MINTER_ROLE(), await escrow.getAddress());
  await token.grantRole(await token.MINTER_ROLE(), await clientRPG.getAddress());
  await token.grantRole(await token.ESCROW_ROLE(), await escrow.getAddress());
  await token.grantRole(await token.BURNER_ROLE(), await staking.getAddress());

  await registry.grantRole(await registry.ARBITER_ROLE(), await escrow.getAddress());
  await registry.grantRole(await registry.ARBITER_ROLE(), arbiter.address);
  await registry.grantRole(await registry.KEEPER_ROLE(), keeper.address);
  await escrow.grantRole(await escrow.KEEPER_ROLE(), keeper.address);
  await clientRPG.grantRole(await clientRPG.ESCROW_ROLE(), await escrow.getAddress());
  await clientRPG.grantRole(await clientRPG.KEEPER_ROLE(), keeper.address);
  await registry.setStakingContract(await staking.getAddress());
  await escrow.setClientRPG(await clientRPG.getAddress());

  for (const signer of [client, agent, referrer, masterFounder, masterSuccessor, arbiter, other]) {
    await usdc.transfer(signer.address, 100_000n * 10n ** 6n);
    await token.operationMint(signer.address, ethers.parseEther("1000"), "seed");
  }

  async function stakeAndJoinGuild(
    signer: any,
    guildId = 1,
    modelType = "gpt-worker"
  ): Promise<void> {
    await token.connect(signer).approve(await staking.getAddress(), await staking.STAKE_AMOUNT());
    await staking.connect(signer).stake();
    await registry.connect(signer).joinGuild(guildId, modelType);
  }

  async function createUsdcQuest(
    questClient: any = client,
    depositAmount: bigint = 100n * 10n ** 6n,
    brief = "ipfs://brief"
  ): Promise<bigint> {
    await escrow.connect(questClient).createQuest(
      await usdc.getAddress(),
      depositAmount,
      ethers.keccak256(ethers.toUtf8Bytes(`brief-${questClient.address}-${brief}`)),
      brief
    );
    const questId = await escrow.nextQuestId();
    await usdc.connect(questClient).approve(await escrow.getAddress(), depositAmount);
    await escrow.connect(questClient).fundQuestUSDC(questId);
    return questId;
  }

  async function createAcceptedUsdcQuest(
    questClient: any = client,
    questAgent: any = agent,
    depositAmount: bigint = 100n * 10n ** 6n
  ): Promise<bigint> {
    const questId = await createUsdcQuest(questClient, depositAmount);
    await escrow.connect(questAgent).acceptQuest(questId);
    return questId;
  }

  async function submitQuestResult(
    questId: bigint,
    questAgent: any = agent,
    resultUri = "ipfs://result"
  ): Promise<void> {
    await escrow.connect(questAgent).submitResult(
      questId,
      ethers.keccak256(ethers.toUtf8Bytes(`result-${questId.toString()}-${resultUri}`)),
      resultUri
    );
  }

  return {
    deployer,
    client,
    agent,
    keeper,
    recipient,
    referrer,
    masterFounder,
    masterSuccessor,
    arbiter,
    other,
    usdc,
    ethUsdFeed,
    tvrnUsdFeed,
    token,
    registry,
    escrow,
    clientRPG,
    staking,
    stakeAndJoinGuild,
    createUsdcQuest,
    createAcceptedUsdcQuest,
    submitQuestResult
  };
}
