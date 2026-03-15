import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

import { deployCoreFixture } from "./helpers/deployCoreFixture";

describe("TavernRegistry master settlement", function () {
  it("records master contributions through arbiter and keeper roles", async function () {
    const { registry, keeper, arbiter, masterFounder } = await loadFixture(deployCoreFixture);

    await registry.setMasterFounder(masterFounder.address, true);

    await registry.connect(arbiter).recordMasterJobCompletion(masterFounder.address, 90);
    await registry.connect(keeper).recordMasterUptime(masterFounder.address);
    await time.increase(30 * 60);
    await registry.connect(keeper).recordMasterUptime(masterFounder.address);

    const contribution = await registry.masterContributions(masterFounder.address);
    expect(contribution.jobsProcessed).to.equal(1n);
    expect(contribution.satisfactionSum).to.equal(90n);
    expect(contribution.satisfactionCount).to.equal(1n);
    expect(contribution.uptimeSeconds).to.be.gte(30n * 60n);
  });

  it("distributes monthly master rewards with the year multiplier and resets counters", async function () {
    const { registry, token, keeper, arbiter, masterFounder, masterSuccessor } = await loadFixture(
      deployCoreFixture
    );

    await registry.setMasterFounder(masterFounder.address, true);
    await registry.setMasterSuccessor(masterSuccessor.address, true);

    await registry.connect(arbiter).recordMasterJobCompletion(masterFounder.address, 100);
    await registry.connect(arbiter).recordMasterJobCompletion(masterFounder.address, 95);
    await registry.connect(arbiter).recordMasterJobCompletion(masterSuccessor.address, 40);

    const founderBefore = await token.balanceOf(masterFounder.address);
    const successorBefore = await token.balanceOf(masterSuccessor.address);

    await time.increase(30 * 24 * 60 * 60 + 1);
    await expect(registry.connect(keeper).monthlyMasterSettle()).to.emit(registry, "MasterSettlementExecuted");

    const founderAfter = await token.balanceOf(masterFounder.address);
    const successorAfter = await token.balanceOf(masterSuccessor.address);
    expect(founderAfter).to.be.gt(founderBefore);
    expect(successorAfter).to.be.gt(successorBefore);
    expect(founderAfter - founderBefore).to.be.gt(successorAfter - successorBefore);

    const founderContribution = await registry.masterContributions(masterFounder.address);
    const successorContribution = await registry.masterContributions(masterSuccessor.address);
    expect(founderContribution.jobsProcessed).to.equal(0n);
    expect(successorContribution.jobsProcessed).to.equal(0n);
  });

  it("returns the declining year multiplier over time", async function () {
    const { registry } = await loadFixture(deployCoreFixture);

    expect(await registry.getCurrentMultiplier()).to.equal(5n);
    await time.increase(366 * 24 * 60 * 60);
    expect(await registry.getCurrentMultiplier()).to.equal(4n);
    await time.increase(4 * 366 * 24 * 60 * 60);
    expect(await registry.getCurrentMultiplier()).to.equal(1n);
  });
});
