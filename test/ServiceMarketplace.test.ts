import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployServiceMarketplaceFixture } from "./helpers/deployServiceMarketplaceFixture";

describe("Service marketplace integration", function () {
  async function deployFixture() {
    const fixture = await deployServiceMarketplaceFixture();
    const { equipment, clientRPG } = fixture;

    await equipment.grantRole(await equipment.MINTER_ROLE(), await clientRPG.getAddress());
    await equipment.registerItem(3, 0, 1, 1, 5000, false, "Scout's Bandana");
    await equipment.setLevelRewards(2, [3]);
    const thresholds = [0, 0, 20, ...Array.from({ length: 98 }, (_, index) => 100 + index)];
    await clientRPG.setThresholds(thresholds as any);
    await clientRPG.setEquipmentContract(await equipment.getAddress());

    return fixture;
  }

  async function completeServiceQuest(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    tier = 0,
    scores: [number, number, number, number, number] = [5, 5, 5, 5, 5]
  ) {
    const { client, agent, usdc, escrow, serviceRegistry, registerService } = fixture;
    const serviceId = await registerService(agent, 0);
    const priceOptions = [100_000_000n, 150_000_000n, 250_000_000n];
    const price = priceOptions[tier];

    await usdc.connect(client).approve(await serviceRegistry.getAddress(), price);
    await serviceRegistry.connect(client).hireFromService(serviceId, tier);
    const questId = await escrow.nextQuestId();

    await escrow.connect(agent).submitResult(
      questId,
      ethers.keccak256(ethers.toUtf8Bytes(`service-result-${questId.toString()}`)),
      "ipfs://service-result"
    );
    await escrow.connect(client).submitEvaluation(questId, scores, "Delivered as agreed.", ["service"]);

    return { serviceId, questId, price };
  }

  it("runs the full hire -> escrow -> settlement -> rating flow", async function () {
    const fixture = await loadFixture(deployFixture);
    const { serviceRegistry, guild, escrow } = fixture;

    const { serviceId, questId, price } = await completeServiceQuest(fixture);

    const service = await serviceRegistry.services(serviceId);
    const quest = await escrow.quests(questId);
    const guildInfo = await guild.guilds(0);

    expect(quest.state).to.equal(5n);
    expect(service.completedCount).to.equal(1n);
    expect(await serviceRegistry.getAverageRating(serviceId)).to.equal(50n);
    expect(guildInfo.totalCompletions).to.equal(1n);
    expect(guildInfo.totalVolume).to.equal(price);
  });

  it("stores service metadata directly on the escrow quest", async function () {
    const fixture = await loadFixture(deployFixture);
    const { client, agent, usdc, escrow, serviceRegistry, registerService } = fixture;

    const serviceId = await registerService(agent, 4);
    await usdc.connect(client).approve(await serviceRegistry.getAddress(), 250_000_000n);
    await serviceRegistry.connect(client).hireFromService(serviceId, 2);

    const quest = await escrow.quests(await escrow.nextQuestId());
    expect(quest.agent).to.equal(agent.address);
    expect(quest.state).to.equal(2n);
    expect(quest.serviceId).to.equal(serviceId);
    expect(quest.serviceTier).to.equal(2n);
  });

  it("records a default 4.0 rating on auto-approved service quests", async function () {
    const fixture = await loadFixture(deployFixture);
    const { client, agent, usdc, escrow, serviceRegistry, keeper, registerService } = fixture;

    const serviceId = await registerService(agent, 1);
    await usdc.connect(client).approve(await serviceRegistry.getAddress(), 100_000_000n);
    await serviceRegistry.connect(client).hireFromService(serviceId, 0);
    const questId = await escrow.nextQuestId();

    await escrow.connect(agent).submitResult(
      questId,
      ethers.keccak256(ethers.toUtf8Bytes("auto-approve-result")),
      "ipfs://auto-approve"
    );
    await time.increase(72 * 60 * 60 + 1);
    await fixture.tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());
    await escrow.connect(keeper).executeAutoApprove(questId);

    expect(await serviceRegistry.getAverageRating(serviceId)).to.equal(40n);
  });

  it("tracks multiple services independently for the same agent", async function () {
    const fixture = await loadFixture(deployFixture);
    const { client, agent, usdc, escrow, serviceRegistry, registerService } = fixture;

    const first = await registerService(agent, 0, "Build One");
    const second = await registerService(agent, 0, "Build Two");

    for (const serviceId of [first, second]) {
      await usdc.connect(client).approve(await serviceRegistry.getAddress(), 100_000_000n);
      await serviceRegistry.connect(client).hireFromService(serviceId, 0);
      const questId = await escrow.nextQuestId();
      await escrow.connect(agent).submitResult(
        questId,
        ethers.keccak256(ethers.toUtf8Bytes(`result-${serviceId.toString()}`)),
        "ipfs://result"
      );
      await escrow.connect(client).submitEvaluation(questId, [4, 4, 4, 4, 4], "Solid work.", ["repeat"]);
    }

    expect((await serviceRegistry.services(first)).completedCount).to.equal(1n);
    expect((await serviceRegistry.services(second)).completedCount).to.equal(1n);
  });

  it("propagates settlement into RPG and equipment rewards", async function () {
    const fixture = await loadFixture(deployFixture);
    const { clientRPG, equipment, client } = fixture;

    await completeServiceQuest(fixture);

    const profile = await clientRPG.clientProfiles(client.address);
    expect(profile.level).to.equal(2n);
    expect(profile.totalJobsCompleted).to.equal(1n);
    expect(await equipment.balanceOf(client.address, 3)).to.equal(1n);
  });
});
