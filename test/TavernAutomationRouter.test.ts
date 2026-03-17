import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";
import { deployCoreFixture } from "./helpers/deployCoreFixture";

describe("TavernAutomationRouter", function () {
  async function deployFixture() {
    const [deployer, client, agent, keeper, recipient] = await ethers.getSigners();
    const signers = await ethers.getSigners();
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

    const AdminPriceFeed = await ethers.getContractFactory("AdminPriceFeed");
    const adminPriceFeed: any = await AdminPriceFeed.deploy(1_000_000);
    await adminPriceFeed.waitForDeployment();

    await token.grantRole(await token.MINTER_ROLE(), await escrow.getAddress());
    await token.grantRole(await token.MINTER_ROLE(), await clientRPG.getAddress());
    await token.grantRole(await token.ESCROW_ROLE(), await escrow.getAddress());
    await token.grantRole(await token.BURNER_ROLE(), await staking.getAddress());
    await registry.grantRole(await registry.ARBITER_ROLE(), await escrow.getAddress());
    await registry.setStakingContract(await staking.getAddress());

    const TavernAutomationRouter = await ethers.getContractFactory("TavernAutomationRouter");
    const router: any = await TavernAutomationRouter.deploy(
      await escrow.getAddress(),
      await registry.getAddress(),
      await adminPriceFeed.getAddress()
    );
    await router.waitForDeployment();

    await registry.grantRole(await registry.KEEPER_ROLE(), await router.getAddress());
    await escrow.grantRole(await escrow.KEEPER_ROLE(), await router.getAddress());
    await router.grantRole(await router.KEEPER_ROLE(), keeper.address);
    await adminPriceFeed.setRefresher(await router.getAddress(), true);
    await clientRPG.grantRole(await clientRPG.ESCROW_ROLE(), await escrow.getAddress());
    await clientRPG.grantRole(await clientRPG.KEEPER_ROLE(), await router.getAddress());
    await escrow.setClientRPG(await clientRPG.getAddress());
    await router.setClientRPG(await clientRPG.getAddress());

    for (const signer of signers.slice(0, 12)) {
      await usdc.transfer(signer.address, 50_000n * 10n ** 6n);
    }

    const fundQuest = async (questClient: any, depositAmount: bigint = 100n * 10n ** 6n) => {
      await escrow.connect(questClient).createQuest(
        await usdc.getAddress(),
        depositAmount,
        ethers.keccak256(ethers.toUtf8Bytes(`brief-${questClient.address}-${Date.now()}`)),
        "ipfs://brief"
      );
      const questId = await escrow.nextQuestId();
      await usdc.connect(questClient).approve(await escrow.getAddress(), depositAmount);
      await escrow.connect(questClient).fundQuestUSDC(questId);
      return questId;
    };

    const createAcceptedQuest = async (
      questClient: any = client,
      questAgent: any = agent,
      depositAmount: bigint = 100n * 10n ** 6n
    ) => {
      const questId = await fundQuest(questClient, depositAmount);
      await escrow.connect(questAgent).acceptQuest(questId);
      return questId;
    };

    const submitQuestResult = async (questId: bigint, questAgent: any = agent) => {
      await escrow.connect(questAgent).submitResult(
        questId,
        ethers.keccak256(ethers.toUtf8Bytes(`result-${questId.toString()}`)),
        "ipfs://result"
      );
    };

    return {
      deployer,
      client,
      agent,
      keeper,
      recipient,
      signers,
      usdc,
      token,
      registry,
      escrow,
      clientRPG,
      staking,
      tvrnUsdFeed,
      adminPriceFeed,
      router,
      createAcceptedQuest,
      fundQuest,
      submitQuestResult
    };
  }

  async function decodePerformData(performData: string) {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const [taskType, param] = coder.decode(["uint8", "uint256"], performData);
    return {
      taskType: Number(taskType),
      param: BigInt(param)
    };
  }

  async function setUintStorage(contractAddress: string, slot: bigint, value: bigint) {
    await ethers.provider.send("hardhat_setStorageAt", [
      contractAddress,
      ethers.toBeHex(slot, 32),
      ethers.zeroPadValue(ethers.toBeHex(value), 32)
    ]);
    await ethers.provider.send("evm_mine", []);
  }

  async function findUintSlot(
    contractAddress: string,
    reader: () => Promise<bigint>,
    target: bigint,
    maxSlot = 64
  ): Promise<bigint> {
    for (let slot = 0; slot <= maxSlot; slot += 1) {
      const snapshot = await ethers.provider.send("evm_snapshot", []);
      await setUintStorage(contractAddress, BigInt(slot), target);
      const value = await reader();
      await ethers.provider.send("evm_revert", [snapshot]);

      if (value === target) {
        return BigInt(slot);
      }
    }

    throw new Error(`Unable to find storage slot for target value ${target.toString()}`);
  }

  async function deploySubscriptionFixture() {
    const core = await deployCoreFixture();
    const { keeper, recipient, usdc, registry, escrow, clientRPG, agent, other, stakeAndJoinGuild } = core;

    const AdminPriceFeed = await ethers.getContractFactory("AdminPriceFeed");
    const adminPriceFeed: any = await AdminPriceFeed.deploy(1_000_000);
    await adminPriceFeed.waitForDeployment();

    const TavernAutomationRouter = await ethers.getContractFactory("TavernAutomationRouter");
    const router: any = await TavernAutomationRouter.deploy(
      await escrow.getAddress(),
      await registry.getAddress(),
      await adminPriceFeed.getAddress()
    );
    await router.waitForDeployment();

    await registry.grantRole(await registry.KEEPER_ROLE(), await router.getAddress());
    await escrow.grantRole(await escrow.KEEPER_ROLE(), await router.getAddress());
    await router.grantRole(await router.KEEPER_ROLE(), keeper.address);
    await adminPriceFeed.setRefresher(await router.getAddress(), true);
    await clientRPG.grantRole(await clientRPG.KEEPER_ROLE(), await router.getAddress());
    await router.setClientRPG(await clientRPG.getAddress());

    await stakeAndJoinGuild(agent, 1, "gpt-agent");
    await stakeAndJoinGuild(other, 1, "claude-agent");

    const TavernSubscription = await getWorkspaceContractFactory("TavernSubscription");
    const subscription: any = await TavernSubscription.deploy(
      await usdc.getAddress(),
      recipient.address,
      await registry.getAddress()
    );
    await subscription.waitForDeployment();

    await subscription.setClientRPG(await clientRPG.getAddress());
    await subscription.grantRole(await subscription.KEEPER_ROLE(), await router.getAddress());
    await clientRPG.grantRole(await clientRPG.SUBSCRIPTION_ROLE(), await subscription.getAddress());
    await router.setSubscriptionContract(await subscription.getAddress());

    const prepareSubscription = async (rate: bigint = 100n * 10n ** 6n) => {
      await subscription.connect(agent).setAgentMonthlyRate(rate);
      await usdc.connect(core.client).approve(await subscription.getAddress(), rate);
      await subscription.connect(core.client).subscribe(agent.address);
      return await subscription.clientAgentSub(core.client.address, agent.address);
    };

    const disableNonSubscriptionTasks = async () => {
      await router.setQuotaRebalanceInterval(365 * 24 * 60 * 60);
      await router.setFeeStageCheckInterval(365 * 24 * 60 * 60);
      await router.setPriceRefreshThreshold(365 * 24 * 60 * 60);
      await router.setMasterSettleInterval(365 * 24 * 60 * 60);
      await router.setEjectionReviewInterval(365 * 24 * 60 * 60);
    };

    return {
      ...core,
      recipient,
      adminPriceFeed,
      router,
      subscription,
      prepareSubscription,
      disableNonSubscriptionTasks
    };
  }

  async function deployGuildMaintenanceFixture() {
    const core = await deployCoreFixture();
    const { keeper, client, agent, other } = core;

    const AdminPriceFeed = await ethers.getContractFactory("AdminPriceFeed");
    const adminPriceFeed: any = await AdminPriceFeed.deploy(1_000_000);
    await adminPriceFeed.waitForDeployment();

    const TavernAutomationRouter = await ethers.getContractFactory("TavernAutomationRouter");
    const router: any = await TavernAutomationRouter.deploy(
      await core.escrow.getAddress(),
      await core.registry.getAddress(),
      await adminPriceFeed.getAddress()
    );
    await router.waitForDeployment();

    const TavernEquipment = await ethers.getContractFactory("TavernEquipment");
    const equipment: any = await TavernEquipment.deploy("ipfs://metadata/");
    await equipment.waitForDeployment();

    const TavernGuild = await ethers.getContractFactory("TavernGuild");
    const guild: any = await TavernGuild.deploy(await equipment.getAddress());
    await guild.waitForDeployment();

    await guild.grantRole(await guild.KEEPER_ROLE(), await router.getAddress());
    await guild.grantRole(await guild.SERVICE_REGISTRY_ROLE(), core.deployer.address);
    await guild.grantRole(await guild.ESCROW_ROLE(), core.deployer.address);
    await router.grantRole(await router.KEEPER_ROLE(), keeper.address);
    await router.setGuildContract(await guild.getAddress());

    return {
      ...core,
      keeper,
      router,
      equipment,
      guild,
      founder: client,
      secondMember: agent,
      thirdMember: other
    };
  }

  it("checkUpkeep returns false when no quests exist", async function () {
    const { router } = await loadFixture(deployFixture);

    const [needed, data] = await router.checkUpkeep.staticCall("0x");
    expect(needed).to.equal(false);
    expect(data).to.equal("0x");
  });

  it("checkUpkeep finds timeout candidate", async function () {
    const { router, createAcceptedQuest } = await loadFixture(deployFixture);

    const questId = await createAcceptedQuest();
    await time.increase(48 * 60 * 60 + 1);

    const [needed, data] = await router.checkUpkeep.staticCall("0x");
    const decoded = await decodePerformData(data);

    expect(needed).to.equal(true);
    expect(decoded.taskType).to.equal(1);
    expect(decoded.param).to.equal(questId);
  });

  it("performUpkeep executes timeout", async function () {
    const { router, keeper, escrow, createAcceptedQuest, tvrnUsdFeed } = await loadFixture(deployFixture);

    const questId = await createAcceptedQuest();
    await time.increase(48 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());

    const [, data] = await router.checkUpkeep.staticCall("0x");
    await expect(router.connect(keeper).performUpkeep(data)).to.emit(router, "TaskExecuted");

    const quest = await escrow.quests(questId);
    expect(quest.state).to.equal(7n);
  });

  it("checkUpkeep finds auto-approve candidate", async function () {
    const { router, createAcceptedQuest, submitQuestResult } = await loadFixture(deployFixture);

    const questId = await createAcceptedQuest();
    await submitQuestResult(questId);
    await time.increase(72 * 60 * 60 + 1);

    const [needed, data] = await router.checkUpkeep.staticCall("0x");
    const decoded = await decodePerformData(data);

    expect(needed).to.equal(true);
    expect(decoded.taskType).to.equal(2);
    expect(decoded.param).to.equal(questId);
  });

  it("performUpkeep executes auto-approve", async function () {
    const { router, keeper, escrow, createAcceptedQuest, submitQuestResult, tvrnUsdFeed } = await loadFixture(
      deployFixture
    );

    const questId = await createAcceptedQuest();
    await submitQuestResult(questId);
    await time.increase(72 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());

    const [, data] = await router.checkUpkeep.staticCall("0x");
    await router.connect(keeper).performUpkeep(data);

    const quest = await escrow.quests(questId);
    expect(quest.state).to.equal(6n);
  });

  it("returns FeeStageCheck when a stage upgrade is available", async function () {
    const { router, escrow, keeper } = await loadFixture(deployFixture);

    const clientCountSlot = await findUintSlot(
      await escrow.getAddress(),
      async () => BigInt(await escrow.activeClientCount()),
      1_000n
    );
    const agentCountSlot = await findUintSlot(
      await escrow.getAddress(),
      async () => BigInt(await escrow.activeAgentCount()),
      200n
    );

    await setUintStorage(await escrow.getAddress(), clientCountSlot, 1_000n);
    await setUintStorage(await escrow.getAddress(), agentCountSlot, 200n);
    expect(await escrow.activeClientCount()).to.equal(1_000n);
    expect(await escrow.activeAgentCount()).to.equal(200n);
    await time.increase(60 * 60 + 1);

    const [needed, data] = await router.checkUpkeep.staticCall("0x");
    const decoded = await decodePerformData(data);

    expect(needed).to.equal(true);
    expect(decoded.taskType).to.equal(3);

    await router.connect(keeper).performUpkeep(data);
    expect(await escrow.currentFeeStage()).to.equal(1n);
  });

  it("executes quota rebalance from pending scores", async function () {
    const { router, registry, keeper } = await loadFixture(deployFixture);

    await router.setPendingQuotaScores([10000, 0, 0, 0, 0, 0]);
    await time.increase(24 * 60 * 60 + 1);

    const [needed, data] = await router.checkUpkeep.staticCall("0x");
    const decoded = await decodePerformData(data);

    expect(needed).to.equal(true);
    expect(decoded.taskType).to.equal(4);

    const before = await registry.jobQuota(0);
    await router.connect(keeper).performUpkeep(data);
    const after = await registry.jobQuota(0);

    expect(after).to.be.gt(before);
  });

  it("refreshes the admin price feed before the escrow stale window", async function () {
    const { router, keeper, adminPriceFeed } = await loadFixture(deployFixture);

    const [, initialAnswer, , initialUpdatedAt] = await adminPriceFeed.latestRoundData();
    await time.increase(50 * 60 + 1);

    const [needed, data] = await router.checkUpkeep.staticCall("0x");
    const decoded = await decodePerformData(data);

    expect(needed).to.equal(true);
    expect(decoded.taskType).to.equal(5);

    await expect(router.connect(keeper).performUpkeep(data)).to.emit(router, "TaskExecuted");

    const [roundId, refreshedAnswer, , refreshedUpdatedAt] = await adminPriceFeed.latestRoundData();
    expect(roundId).to.equal(2n);
    expect(refreshedAnswer).to.equal(initialAnswer);
    expect(refreshedUpdatedAt).to.be.gt(initialUpdatedAt);
  });

  it("executes guild maintenance when the guild interval elapses", async function () {
    const { router, keeper, guild, founder } = await loadFixture(
      deployGuildMaintenanceFixture
    );

    await router.setQuotaRebalanceInterval(365 * 24 * 60 * 60);
    await router.setFeeStageCheckInterval(365 * 24 * 60 * 60);
    await router.setPriceRefreshThreshold(365 * 24 * 60 * 60);
    await router.setMasterSettleInterval(365 * 24 * 60 * 60);
    await router.setEjectionReviewInterval(365 * 24 * 60 * 60);
    await guild.addMember(0, founder.address);
    await guild.recordGuildCompletion(founder.address, 0, 100_000_000n);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [needed, data] = await router.checkUpkeep.staticCall("0x");
    const decoded = await decodePerformData(data);

    expect(needed).to.equal(true);
    expect(decoded.taskType).to.equal(8);

    const before = await guild.lastMaintenanceAt();
    await router.connect(keeper).performUpkeep(data);
    expect(await guild.lastMaintenanceAt()).to.be.gt(before);
  });

  it("enforces KEEPER_ROLE on performUpkeep", async function () {
    const { router, client } = await loadFixture(deployFixture);

    const performData = ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "uint256"], [3, 0]);
    await expect(router.connect(client).performUpkeep(performData)).to.be.revertedWith("Not keeper");
  });

  it("advances the scan cursor after executing timeout", async function () {
    const { router, keeper, createAcceptedQuest, tvrnUsdFeed } = await loadFixture(deployFixture);

    const questId = await createAcceptedQuest();
    await time.increase(48 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());

    const [, data] = await router.checkUpkeep.staticCall("0x");
    await router.connect(keeper).performUpkeep(data);

    expect(await router.lastScanCursor()).to.equal(1n);
  });

  it("limits quest scanning to the configured batch size", async function () {
    const { router, escrow, agent, signers, fundQuest, adminPriceFeed } = await loadFixture(deployFixture);
    const questClients = signers.filter((signer) => signer.address !== agent.address).slice(0, 11);

    await router.setScanBatchSize(10);
    await router.setQuotaRebalanceInterval(365 * 24 * 60 * 60);
    await router.setFeeStageCheckInterval(365 * 24 * 60 * 60);
    await router.setPriceRefreshThreshold(365 * 24 * 60 * 60);

    const questIds: bigint[] = [];
    for (let index = 0; index < 11; index += 1) {
      const questId = await fundQuest(questClients[index]);
      questIds.push(questId);
    }

    await escrow.connect(agent).acceptQuest(questIds[10]);
    await time.increase(48 * 60 * 60 + 1);
    await adminPriceFeed.refreshPrice();

    for (let index = 0; index < 10; index += 1) {
      await escrow.connect(agent).acceptQuest(questIds[index]);
    }

    const [needed] = await router.checkUpkeep.staticCall("0x");
    expect(needed).to.equal(false);
  });

  it("integrates router automation with the full stack for auto-approve", async function () {
    const { router, keeper, escrow, createAcceptedQuest, submitQuestResult, tvrnUsdFeed } = await loadFixture(
      deployFixture
    );

    const questId = await createAcceptedQuest();
    await submitQuestResult(questId);
    await time.increase(72 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());

    const [needed, data] = await router.checkUpkeep.staticCall("0x");
    expect(needed).to.equal(true);

    await expect(router.connect(keeper).performUpkeep(data))
      .to.emit(escrow, "QuestAutoApproved")
      .and.to.emit(router, "TaskExecuted");

    const quest = await escrow.quests(questId);
    expect(quest.state).to.equal(6n);
  });

  it("returns SubscriptionExpiry when a subscription has expired", async function () {
    const { router, disableNonSubscriptionTasks, prepareSubscription } = await loadFixture(deploySubscriptionFixture);

    await disableNonSubscriptionTasks();
    await prepareSubscription();
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [needed, data] = await router.checkUpkeep.staticCall("0x");
    const decoded = await decodePerformData(data);

    expect(needed).to.equal(true);
    expect(decoded.taskType).to.equal(9);
  });

  it("expires subscriptions during upkeep without holding subscription fees", async function () {
    const { router, keeper, subscription, recipient, usdc, disableNonSubscriptionTasks, prepareSubscription } =
      await loadFixture(deploySubscriptionFixture);

    await disableNonSubscriptionTasks();
    const recipientBalanceBeforeSubscribe = await usdc.balanceOf(recipient.address);
    const subId = await prepareSubscription();
    const beforeBalance = await usdc.balanceOf(recipient.address);
    expect(beforeBalance - recipientBalanceBeforeSubscribe).to.equal(5n * 10n ** 6n);
    expect(await usdc.balanceOf(await subscription.getAddress())).to.equal(0n);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [needed, data] = await router.checkUpkeep.staticCall("0x");
    expect(needed).to.equal(true);

    await expect(router.connect(keeper).performUpkeep(data)).to.emit(router, "TaskExecuted");

    expect((await subscription.subscriptions(subId)).active).to.equal(false);
    expect(await usdc.balanceOf(await subscription.getAddress())).to.equal(0n);
    expect(await usdc.balanceOf(recipient.address)).to.equal(beforeBalance);
  });
});
