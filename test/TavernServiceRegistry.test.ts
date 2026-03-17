import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

import { deployServiceMarketplaceFixture } from "./helpers/deployServiceMarketplaceFixture";

describe("TavernServiceRegistry", function () {
  it("registers a service and auto-joins the guild", async function () {
    const { serviceRegistry, guild, agent, registerService } = await loadFixture(deployServiceMarketplaceFixture);

    const serviceId = await registerService(agent, 0);
    const service = await serviceRegistry.services(serviceId);

    expect(service.agent).to.equal(agent.address);
    expect(service.guildId).to.equal(0n);
    expect(service.title).to.equal("Custom AI Chatbot");
    expect(await guild.isInGuild(agent.address, 0)).to.equal(true);
    expect(await serviceRegistry.getServicesByAgent(agent.address)).to.deep.equal([1n]);
  });

  it("supports agents listing services across multiple guilds", async function () {
    const { serviceRegistry, guild, agent, registerService } = await loadFixture(deployServiceMarketplaceFixture);

    await registerService(agent, 0, "Agentic Build");
    await registerService(agent, 7, "Security Review");

    expect(await guild.getMemberGuilds(agent.address)).to.deep.equal([0n, 7n]);
    expect(await serviceRegistry.getServicesByGuild(0)).to.deep.equal([1n]);
    expect(await serviceRegistry.getServicesByGuild(7)).to.deep.equal([2n]);
  });

  it("updates core service fields and tags", async function () {
    const { serviceRegistry, agent, registerService } = await loadFixture(deployServiceMarketplaceFixture);

    const serviceId = await registerService(agent, 2);
    await serviceRegistry
      .connect(agent)
      .updateService(
        serviceId,
        "Smart Contract Audit",
        "Full security review with exploit notes.",
        [200_000_000n, 300_000_000n, 450_000_000n]
      );
    await serviceRegistry.connect(agent).updateTags(serviceId, ["solidity", "audit", "security"]);

    const service = await serviceRegistry.services(serviceId);
    expect(service.title).to.equal("Smart Contract Audit");
    expect(service.description).to.equal("Full security review with exploit notes.");
    expect(service.tierPrices[2]).to.equal(450_000_000n);
    expect(await serviceRegistry.getServiceTags(serviceId)).to.deep.equal(["solidity", "audit", "security"]);
  });

  it("toggles service activity for owners and admins", async function () {
    const { deployer, serviceRegistry, agent, registerService } = await loadFixture(deployServiceMarketplaceFixture);

    const serviceId = await registerService(agent, 4);
    await serviceRegistry.connect(agent).deactivateService(serviceId);
    expect((await serviceRegistry.services(serviceId)).active).to.equal(false);

    await serviceRegistry.connect(agent).reactivateService(serviceId);
    expect((await serviceRegistry.services(serviceId)).active).to.equal(true);

    await serviceRegistry.connect(deployer).adminDeactivateService(serviceId);
    expect((await serviceRegistry.services(serviceId)).active).to.equal(false);
  });

  it("creates an accepted escrow quest when a client hires a service tier", async function () {
    const { client, usdc, escrow, serviceRegistry, agent, registerService } = await loadFixture(
      deployServiceMarketplaceFixture
    );

    const serviceId = await registerService(agent, 0);
    const price = 150_000_000n;
    const beforeEscrow = await usdc.balanceOf(await escrow.getAddress());

    await usdc.connect(client).approve(await serviceRegistry.getAddress(), price);
    await serviceRegistry.connect(client).hireFromService(serviceId, 1);

    const questId = await escrow.nextQuestId();
    const quest = await escrow.quests(questId);

    expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(beforeEscrow + price);
    expect(quest.client).to.equal(client.address);
    expect(quest.agent).to.equal(agent.address);
    expect(quest.depositAmount).to.equal(price);
    expect(quest.state).to.equal(2n);
    expect(quest.serviceId).to.equal(serviceId);
    expect(quest.serviceTier).to.equal(1n);
  });

  it("prevents self-hiring and invalid prices", async function () {
    const { serviceRegistry, agent, registerService, ensureAgent } = await loadFixture(deployServiceMarketplaceFixture);

    await ensureAgent(agent, 1, "pricing-agent");

    await expect(
      serviceRegistry
        .connect(agent)
        .registerService(0, "Broken Pricing", "nope", [500_000n, 0n, 0n], ["bad"])
    ).to.be.revertedWith("Invalid standard price");

    const serviceId = await registerService(agent, 0);
    await expect(serviceRegistry.connect(agent).hireFromService(serviceId, 0)).to.be.revertedWith(
      "Cannot hire yourself"
    );
  });

  it("enforces price ordering and max services per agent", async function () {
    const { serviceRegistry, agent, registerService, ensureAgent } = await loadFixture(deployServiceMarketplaceFixture);

    await ensureAgent(agent, 1, "capacity-agent");

    await expect(
      serviceRegistry
        .connect(agent)
        .registerService(0, "Invalid Deluxe", "desc", [100_000_000n, 90_000_000n, 0n], ["ai"])
    ).to.be.revertedWith("Invalid deluxe price");

    for (let i = 0; i < 10; i += 1) {
      await registerService(agent, i % 2 === 0 ? 0 : 1, `Service ${i}`);
    }

    await expect(registerService(agent, 2, "Overflow Service")).to.be.revertedWith("Max services reached");
  });

  it("records completions, ratings, and guild stats from the escrow role", async function () {
    const { deployer, serviceRegistry, guild, agent, registerService } = await loadFixture(
      deployServiceMarketplaceFixture
    );

    const serviceId = await registerService(agent, 3, "Research Sprint");
    await serviceRegistry.connect(deployer).recordServiceCompletion(serviceId, 275_000_000n, 48);

    const service = await serviceRegistry.services(serviceId);
    const guildInfo = await guild.guilds(3);
    const member = await guild.guildMemberInfo(3, agent.address);

    expect(service.completedCount).to.equal(1n);
    expect(await serviceRegistry.getAverageRating(serviceId)).to.equal(48n);
    expect(guildInfo.totalCompletions).to.equal(1n);
    expect(guildInfo.totalVolume).to.equal(275_000_000n);
    expect(member.completions).to.equal(1n);
  });

  it("returns guild and agent indexes with active filtering", async function () {
    const { serviceRegistry, agent, other, registerService, ensureAgent } = await loadFixture(
      deployServiceMarketplaceFixture
    );

    const first = await registerService(agent, 5, "Growth Plan");
    const second = await registerService(agent, 5, "Community Ops");
    await ensureAgent(other, 1, "strategy-agent");
    const thirdTx = await serviceRegistry
      .connect(other)
      .registerService(5, "Launch Strategy", "Go-to-market support.", [180_000_000n, 0n, 0n], ["launch"]);
    await thirdTx.wait();

    await serviceRegistry.connect(agent).deactivateService(second);

    expect(await serviceRegistry.getServicesByGuild(5)).to.deep.equal([first, second, 3n]);
    expect(await serviceRegistry.getActiveServicesByGuild(5)).to.deep.equal([first, 3n]);
    expect(await serviceRegistry.getServicesByAgent(agent.address)).to.deep.equal([first, second]);
  });
});
