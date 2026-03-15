import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const USDC = 10n ** 6n;

describe("TavernEscrow settlement realignment", function () {
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

    await usdc.transfer(client.address, 10_000n * USDC);

    const createAcceptedQuest = async (depositAmount: bigint = 100n * USDC) => {
      await escrow.connect(client).createQuest(
        await usdc.getAddress(),
        depositAmount,
        ethers.keccak256(ethers.toUtf8Bytes("brief")),
        "ipfs://brief"
      );

      const questId = await escrow.nextQuestId();
      await usdc.connect(client).approve(await escrow.getAddress(), depositAmount);
      await escrow.connect(client).fundQuestUSDC(questId);
      await escrow.connect(agent).acceptQuest(questId);

      return questId;
    };

    const submitResult = async (questId: bigint) => {
      await escrow
        .connect(agent)
        .submitResult(questId, ethers.keccak256(ethers.toUtf8Bytes("result")), "ipfs://result");
    };

    return {
      client,
      agent,
      planningAgent,
      verificationAgent,
      keeper,
      usdc,
      token,
      escrow,
      clientRPG,
      tvrnUsdFeed,
      createAcceptedQuest,
      submitResult
    };
  }

  it("settles auto-approved quests as 70% cash + 30% TVRN within the 87% agent share", async function () {
    const {
      client,
      agent,
      planningAgent,
      verificationAgent,
      keeper,
      usdc,
      token,
      escrow,
      clientRPG,
      tvrnUsdFeed,
      createAcceptedQuest,
      submitResult
    } = await loadFixture(deployFixture);

    const questId = await createAcceptedQuest(100n * USDC);
    await escrow.connect(keeper).assignPlanningAgent(questId, planningAgent.address);
    await submitResult(questId);
    await escrow.connect(keeper).assignVerificationAgent(questId, verificationAgent.address);
    await time.increase(72 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());

    await escrow.connect(keeper).executeAutoApprove(questId);

    expect(await usdc.balanceOf(agent.address)).to.equal(60_900_000n);
    expect(await usdc.balanceOf(planningAgent.address)).to.equal(5_000_000n);
    expect(await usdc.balanceOf(verificationAgent.address)).to.equal(5_000_000n);
    expect(await escrow.servicePoolBalance(await usdc.getAddress())).to.equal(29_100_000n);
    expect(await token.balanceOf(agent.address)).to.equal(ethers.parseUnits("26.1", 18));
    expect(await clientRPG.clientClaimable(client.address)).to.equal(ethers.parseEther("20"));
  });

  it("routes missing planning and verification shares into the retained service balance", async function () {
    const { agent, keeper, usdc, token, escrow, tvrnUsdFeed, createAcceptedQuest, submitResult } =
      await loadFixture(deployFixture);

    const questId = await createAcceptedQuest(100n * USDC);
    await submitResult(questId);
    await time.increase(72 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());

    await escrow.connect(keeper).executeAutoApprove(questId);

    expect(await usdc.balanceOf(agent.address)).to.equal(60_900_000n);
    expect(await escrow.servicePoolBalance(await usdc.getAddress())).to.equal(39_100_000n);
    expect(await token.balanceOf(agent.address)).to.equal(ethers.parseUnits("26.1", 18));
  });

  it("no longer exposes the legacy completion bonus admin hook", async function () {
    const { escrow } = await loadFixture(deployFixture);

    expect(escrow.interface.getFunction("setCompletionBonusBps")).to.equal(null);
    expect(escrow.interface.getFunction("completionBonusBps")).to.equal(null);
  });
});
