import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

import { deployServiceMarketplaceFixture } from "./helpers/deployServiceMarketplaceFixture";

describe("TavernMatchmaker", function () {
  async function prepareRankedServices() {
    const fixture = await deployServiceMarketplaceFixture();
    const { deployer, clientRPG, serviceRegistry, matchmaker, agent, other, registerService } = fixture;

    const alpha = await registerService(
      agent,
      0,
      "Alpha Build",
      "High quality implementation.",
      [90_000_000n, 140_000_000n, 0n],
      ["automation"]
    );
    const beta = await registerService(
      other,
      0,
      "Beta Build",
      "Lower-cost implementation.",
      [60_000_000n, 0n, 0n],
      ["automation"]
    );

    await serviceRegistry.connect(deployer).recordServiceCompletion(alpha, 90_000_000n, 50);
    await serviceRegistry.connect(deployer).recordServiceCompletion(alpha, 90_000_000n, 48);
    await serviceRegistry.connect(deployer).recordServiceCompletion(beta, 60_000_000n, 38);

    await clientRPG.grantJobCompleteEXP(agent.address);
    await clientRPG.grantJobCompleteEXP(agent.address);
    await clientRPG.grantJobCompleteEXP(other.address);
    await clientRPG.setVerified(agent.address, true);

    return {
      ...fixture,
      matchmaker,
      alpha,
      beta
    };
  }

  it("ranks agents by composite score", async function () {
    const { matchmaker, agent, other, alpha, beta } = await loadFixture(prepareRankedServices);

    const [agents, serviceIds, scores] = await matchmaker.getRecommendedAgents(0, 100_000_000n, 5);

    expect(agents[0]).to.equal(agent.address);
    expect(serviceIds[0]).to.equal(alpha);
    expect(scores[0]).to.be.gt(scores[1]);
    expect(agents[1]).to.equal(other.address);
    expect(serviceIds[1]).to.equal(beta);
  });

  it("applies the budget filter", async function () {
    const { matchmaker, other, beta } = await loadFixture(prepareRankedServices);

    const [agents, serviceIds] = await matchmaker.getRecommendedAgents(0, 70_000_000n, 5);

    expect(agents).to.deep.equal([other.address]);
    expect(serviceIds).to.deep.equal([beta]);
  });

  it("excludes banned agents from recommendations", async function () {
    const { matchmaker, clientRPG, agent, other } = await loadFixture(prepareRankedServices);

    await clientRPG.banClient(agent.address);
    const [agents] = await matchmaker.getRecommendedAgents(0, 0, 5);

    expect(agents).to.deep.equal([other.address]);
  });

  it("gives verified agents a bonus", async function () {
    const { matchmaker, clientRPG, agent, other, registerService, deployer, serviceRegistry } = await loadFixture(
      deployServiceMarketplaceFixture
    );

    const alpha = await registerService(agent, 1, "Verified Build", "desc", [100_000_000n, 0n, 0n], ["verified"]);
    const beta = await registerService(other, 1, "Unverified Build", "desc", [100_000_000n, 0n, 0n], ["plain"]);

    await serviceRegistry.connect(deployer).recordServiceCompletion(alpha, 100_000_000n, 40);
    await serviceRegistry.connect(deployer).recordServiceCompletion(beta, 100_000_000n, 40);
    await clientRPG.setVerified(agent.address, true);

    const [agents, , scores] = await matchmaker.getRecommendedAgents(1, 100_000_000n, 2);
    expect(agents).to.deep.equal([agent.address, other.address]);
    expect(scores[0]).to.equal(scores[1] + 5n);
  });

  it("supports admin weight changes", async function () {
    const { matchmaker, agent, other } = await loadFixture(prepareRankedServices);

    await matchmaker.setWeights(10, 5, 5, 80);
    const [agents] = await matchmaker.getRecommendedAgents(0, 100_000_000n, 5);

    expect(agents[0]).to.equal(other.address);
    expect(agents[1]).to.equal(agent.address);
  });

  it("caps results by maxResults", async function () {
    const { matchmaker, registerService, other, referrer } = await loadFixture(deployServiceMarketplaceFixture);

    await registerService(other, 2, "Oracle One");
    await registerService(referrer, 2, "Oracle Two");

    const [agents] = await matchmaker.getRecommendedAgents(2, 0, 1);
    expect(agents.length).to.equal(1);
  });

  it("returns empty arrays for empty guilds", async function () {
    const { matchmaker } = await loadFixture(deployServiceMarketplaceFixture);

    const [agents, serviceIds, scores] = await matchmaker.getRecommendedAgents(6, 0, 5);
    expect(agents).to.deep.equal([]);
    expect(serviceIds).to.deep.equal([]);
    expect(scores).to.deep.equal([]);
  });
});
