import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployCoreFixture } from "./helpers/deployCoreFixture";

describe("TavernRegistry monthly ejection", function () {
  async function registerTenAgents() {
    const fixture = await deployCoreFixture();
    const signers = (await ethers.getSigners()).slice(1, 11);

    for (const signer of signers) {
      await fixture.token.operationMint(signer.address, ethers.parseEther("1000"), "seed");
      await fixture.token.connect(signer).approve(await fixture.staking.getAddress(), await fixture.staking.STAKE_AMOUNT());
      await fixture.staking.connect(signer).stake();
      await fixture.registry.connect(signer).joinGuild(1, "ranked-agent");
    }

    return { ...fixture, rankedAgents: signers };
  }

  it("warns the worst-ranked bottom 10 percent agent", async function () {
    const { registry, keeper, rankedAgents } = await loadFixture(registerTenAgents);

    await expect(registry.connect(keeper).monthlyEjectionReview(rankedAgents.map((signer) => signer.address)))
      .to.emit(registry, "AgentWarned")
      .withArgs(rankedAgents[0].address, 1n);

    const perf = await registry.agentPerformance(rankedAgents[0].address);
    expect(perf.warningCount).to.equal(1n);
    expect((await registry.getAgent(rankedAgents[0].address)).isActive).to.equal(true);
  });

  it("ejects after two consecutive warnings and bans after the third ejection", async function () {
    const { registry, keeper, rankedAgents, staking, token } = await loadFixture(registerTenAgents);
    const target = rankedAgents[0];

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await registry.connect(keeper).monthlyEjectionReview(rankedAgents.map((signer) => signer.address));
      await registry.connect(keeper).monthlyEjectionReview(rankedAgents.map((signer) => signer.address));

      const profile = await registry.getAgent(target.address);
      expect(profile.isActive).to.equal(false);

      if (cycle < 2) {
        await token.connect(target).approve(await staking.getAddress(), 0n);
        await registry.connect(target).joinGuild(1, "returning-agent");
        expect((await registry.getAgent(target.address)).isActive).to.equal(true);
      }
    }

    const perf = await registry.agentPerformance(target.address);
    expect(perf.ejectionCount).to.equal(3n);
    expect(perf.bannedUntil).to.be.gt(0n);
    await expect(registry.connect(target).joinGuild(1, "banned-agent")).to.be.revertedWith(
      "Agent is temporarily banned"
    );
  });
});
