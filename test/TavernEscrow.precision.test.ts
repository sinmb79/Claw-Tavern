import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const USDC = 10n ** 6n;

describe("TavernEscrow precision and boundary cases", function () {
  async function deployFixture() {
    const [deployer, client, agent, planningAgent, verificationAgent, keeper] = await ethers.getSigners();
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

    await token.grantRole(await token.MINTER_ROLE(), await escrow.getAddress());
    await token.grantRole(await token.MINTER_ROLE(), await clientRPG.getAddress());
    await token.grantRole(await token.ESCROW_ROLE(), await escrow.getAddress());
    await registry.grantRole(await registry.ARBITER_ROLE(), await escrow.getAddress());
    await escrow.grantRole(await escrow.KEEPER_ROLE(), keeper.address);
    await clientRPG.grantRole(await clientRPG.ESCROW_ROLE(), await escrow.getAddress());
    await clientRPG.grantRole(await clientRPG.KEEPER_ROLE(), keeper.address);
    await escrow.setClientRPG(await clientRPG.getAddress());

    await usdc.transfer(client.address, 2_000_000n * USDC);

    const refreshFeeds = async () => {
      const current = await time.latest();
      await ethUsdFeed.setRoundData(2_000n * 10n ** 8n, current);
      await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, current);
    };

    const createAcceptedUsdcQuest = async (depositAmount: bigint) => {
      await escrow.connect(client).createQuest(
        await usdc.getAddress(),
        depositAmount,
        ethers.keccak256(ethers.toUtf8Bytes(`usdc-brief-${depositAmount.toString()}`)),
        "ipfs://brief"
      );

      const questId = await escrow.nextQuestId();
      await usdc.connect(client).approve(await escrow.getAddress(), depositAmount);
      await escrow.connect(client).fundQuestUSDC(questId);
      await escrow.connect(agent).acceptQuest(questId);
      return questId;
    };

    const createAcceptedEthQuest = async (depositAmount: bigint) => {
      await escrow.connect(client).createQuest(
        ethers.ZeroAddress,
        depositAmount,
        ethers.keccak256(ethers.toUtf8Bytes(`eth-brief-${depositAmount.toString()}`)),
        "ipfs://brief"
      );

      const questId = await escrow.nextQuestId();
      await escrow.connect(client).fundQuestETH(questId, { value: depositAmount });
      await escrow.connect(agent).acceptQuest(questId);
      return questId;
    };

    const submitResult = async (questId: bigint) => {
      await escrow
        .connect(agent)
        .submitResult(questId, ethers.keccak256(ethers.toUtf8Bytes(`result-${questId.toString()}`)), "ipfs://result");
    };

    const autoApproveUsdcQuest = async (
      depositAmount: bigint,
      assignAgents = true
    ) => {
      const questId = await createAcceptedUsdcQuest(depositAmount);
      if (assignAgents) {
        await escrow.connect(keeper).assignPlanningAgent(questId, planningAgent.address);
      }
      await submitResult(questId);
      if (assignAgents) {
        await escrow.connect(keeper).assignVerificationAgent(questId, verificationAgent.address);
      }
      await time.increase(72 * 60 * 60 + 1);
      await refreshFeeds();
      return questId;
    };

    const autoApproveEthQuest = async (
      depositAmount: bigint,
      assignAgents = true
    ) => {
      const questId = await createAcceptedEthQuest(depositAmount);
      if (assignAgents) {
        await escrow.connect(keeper).assignPlanningAgent(questId, planningAgent.address);
      }
      await submitResult(questId);
      if (assignAgents) {
        await escrow.connect(keeper).assignVerificationAgent(questId, verificationAgent.address);
      }
      await time.increase(72 * 60 * 60 + 1);
      await refreshFeeds();
      return questId;
    };

    return {
      client,
      agent,
      planningAgent,
      verificationAgent,
      keeper,
      usdc,
      ethUsdFeed,
      token,
      escrow,
      clientRPG,
      createAcceptedUsdcQuest,
      createAcceptedEthQuest,
      autoApproveUsdcQuest,
      autoApproveEthQuest,
      refreshFeeds,
      submitResult
    };
  }

  it("conserves a 1 USDC settlement across agent, support, and retained pools", async function () {
    const { agent, planningAgent, verificationAgent, keeper, usdc, escrow, autoApproveUsdcQuest } =
      await loadFixture(deployFixture);

    const depositAmount = 1n * USDC;
    const questId = await autoApproveUsdcQuest(depositAmount);

    const agentBefore = await usdc.balanceOf(agent.address);
    const planningBefore = await usdc.balanceOf(planningAgent.address);
    const verificationBefore = await usdc.balanceOf(verificationAgent.address);
    const serviceBefore = await escrow.servicePoolBalance(await usdc.getAddress());

    await escrow.connect(keeper).executeAutoApprove(questId);

    const agentDelta = (await usdc.balanceOf(agent.address)) - agentBefore;
    const planningDelta = (await usdc.balanceOf(planningAgent.address)) - planningBefore;
    const verificationDelta = (await usdc.balanceOf(verificationAgent.address)) - verificationBefore;
    const serviceDelta = (await escrow.servicePoolBalance(await usdc.getAddress())) - serviceBefore;

    expect(agentDelta + planningDelta + verificationDelta + serviceDelta).to.equal(depositAmount);
  });

  it("conserves a large USDC settlement across all outputs", async function () {
    const { agent, planningAgent, verificationAgent, keeper, usdc, escrow, autoApproveUsdcQuest } =
      await loadFixture(deployFixture);

    const depositAmount = 1_000_000n * USDC;
    await escrow.setMaxQuestDepositUsdc(depositAmount);
    const questId = await autoApproveUsdcQuest(depositAmount);

    const agentBefore = await usdc.balanceOf(agent.address);
    const planningBefore = await usdc.balanceOf(planningAgent.address);
    const verificationBefore = await usdc.balanceOf(verificationAgent.address);
    const serviceBefore = await escrow.servicePoolBalance(await usdc.getAddress());

    await escrow.connect(keeper).executeAutoApprove(questId);

    const agentDelta = (await usdc.balanceOf(agent.address)) - agentBefore;
    const planningDelta = (await usdc.balanceOf(planningAgent.address)) - planningBefore;
    const verificationDelta = (await usdc.balanceOf(verificationAgent.address)) - verificationBefore;
    const serviceDelta = (await escrow.servicePoolBalance(await usdc.getAddress())) - serviceBefore;

    expect(agentDelta + planningDelta + verificationDelta + serviceDelta).to.equal(depositAmount);
  });

  it("conserves a small ETH settlement across all outputs", async function () {
    const { agent, planningAgent, verificationAgent, keeper, escrow, autoApproveEthQuest } =
      await loadFixture(deployFixture);

    const depositAmount = 1n * 10n ** 15n;
    const questId = await autoApproveEthQuest(depositAmount);

    const agentBefore = await ethers.provider.getBalance(agent.address);
    const planningBefore = await ethers.provider.getBalance(planningAgent.address);
    const verificationBefore = await ethers.provider.getBalance(verificationAgent.address);
    const serviceBefore = BigInt(await escrow.servicePoolBalance(ethers.ZeroAddress));

    await escrow.connect(keeper).executeAutoApprove(questId);

    const agentDelta = (await ethers.provider.getBalance(agent.address)) - agentBefore;
    const planningDelta = (await ethers.provider.getBalance(planningAgent.address)) - planningBefore;
    const verificationDelta = (await ethers.provider.getBalance(verificationAgent.address)) - verificationBefore;
    const serviceDelta = BigInt(await escrow.servicePoolBalance(ethers.ZeroAddress)) - serviceBefore;

    expect(agentDelta + planningDelta + verificationDelta + serviceDelta).to.equal(depositAmount);
  });

  it("conserves a large ETH settlement across all outputs", async function () {
    const { agent, planningAgent, verificationAgent, keeper, escrow, autoApproveEthQuest } =
      await loadFixture(deployFixture);

    const depositAmount = 100n * 10n ** 18n;
    const questId = await autoApproveEthQuest(depositAmount);

    const agentBefore = await ethers.provider.getBalance(agent.address);
    const planningBefore = await ethers.provider.getBalance(planningAgent.address);
    const verificationBefore = await ethers.provider.getBalance(verificationAgent.address);
    const serviceBefore = BigInt(await escrow.servicePoolBalance(ethers.ZeroAddress));

    await escrow.connect(keeper).executeAutoApprove(questId);

    const agentDelta = (await ethers.provider.getBalance(agent.address)) - agentBefore;
    const planningDelta = (await ethers.provider.getBalance(planningAgent.address)) - planningBefore;
    const verificationDelta = (await ethers.provider.getBalance(verificationAgent.address)) - verificationBefore;
    const serviceDelta = BigInt(await escrow.servicePoolBalance(ethers.ZeroAddress)) - serviceBefore;

    expect(agentDelta + planningDelta + verificationDelta + serviceDelta).to.equal(depositAmount);
  });

  it("keeps the three compensation paths bounded and tagged correctly", async function () {
    const {
      client,
      keeper,
      usdc,
      escrow,
      createAcceptedUsdcQuest,
      refreshFeeds,
      submitResult
    } = await loadFixture(deployFixture);

    const timeoutQuestId = await createAcceptedUsdcQuest(100n * USDC);
    await time.increase(48 * 60 * 60 + 1);
    await refreshFeeds();
    await escrow.connect(keeper).executeTimeout(timeoutQuestId);

    const unviewedQuestId = await createAcceptedUsdcQuest(100n * USDC);
    await submitResult(unviewedQuestId);
    await refreshFeeds();
    await escrow.connect(client).submitEvaluation(
      unviewedQuestId,
      [1, 1, 1, 1, 1],
      "thin",
      []
    );

    const lowScoreQuestId = await createAcceptedUsdcQuest(100n * USDC);
    await submitResult(lowScoreQuestId);
    await escrow.connect(client).recordResultViewed(lowScoreQuestId);
    await refreshFeeds();
    await escrow.connect(client).submitEvaluation(
      lowScoreQuestId,
      [1, 1, 1, 1, 1],
      "thin",
      []
    );

    const timeoutQuote = await escrow.previewCompensation(timeoutQuestId);
    const unviewedQuote = await escrow.previewCompensation(unviewedQuestId);
    const lowScoreQuote = await escrow.previewCompensation(lowScoreQuestId);

    expect(await escrow.compensationKinds(timeoutQuestId)).to.equal(0n);
    expect(await escrow.compensationKinds(unviewedQuestId)).to.equal(1n);
    expect(await escrow.compensationKinds(lowScoreQuestId)).to.equal(2n);

    for (const quote of [timeoutQuote, unviewedQuote, lowScoreQuote]) {
      expect(quote.operatorAmount).to.be.lte(100n * USDC);
      expect(quote.tvrnAmount).to.be.gt(0n);
      expect(quote.creditAmountUsd18).to.be.gt(0n);
    }

    expect(timeoutQuote.operatorAmount).to.equal(10n * USDC);
    expect(unviewedQuote.operatorAmount).to.equal(24n * USDC);
    expect(lowScoreQuote.operatorAmount).to.equal(64n * USDC);
  });

  it("handles the depositAmount = 1 boundary without reverting", async function () {
    const { keeper, usdc, escrow, autoApproveUsdcQuest } = await loadFixture(deployFixture);

    const questId = await autoApproveUsdcQuest(1n, false);
    const serviceBefore = await escrow.servicePoolBalance(await usdc.getAddress());

    await expect(escrow.connect(keeper).executeAutoApprove(questId)).to.not.be.reverted;

    const serviceAfter = await escrow.servicePoolBalance(await usdc.getAddress());
    expect(serviceAfter - serviceBefore).to.equal(1n);
  });

  it("keeps type(uint128).max compensation math within range", async function () {
    const { usdc, escrow, refreshFeeds } = await loadFixture(deployFixture);

    await refreshFeeds();

    const max128 = (1n << 128n) - 1n;
    await expect(
      escrow.getCompensationAmountTVRN(max128, await usdc.getAddress(), 45, 11_000)
    ).to.not.be.reverted;
    await expect(
      escrow.getCompensationAmountTVRN(max128, ethers.ZeroAddress, 45, 11_000)
    ).to.not.be.reverted;
  });

  it("routes unassigned planning and verification shares into the service pool", async function () {
    const { keeper, usdc, escrow, autoApproveUsdcQuest } = await loadFixture(deployFixture);

    const questId = await autoApproveUsdcQuest(100n * USDC, false);
    const serviceBefore = await escrow.servicePoolBalance(await usdc.getAddress());

    await escrow.connect(keeper).executeAutoApprove(questId);

    const serviceDelta = (await escrow.servicePoolBalance(await usdc.getAddress())) - serviceBefore;
    expect(serviceDelta).to.equal(39_100_000n);
  });
});
