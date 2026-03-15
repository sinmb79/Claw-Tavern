import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployCoreFixture } from "./helpers/deployCoreFixture";

describe("TavernRegistry appeals", function () {
  async function ejectedAgentFixture() {
    const fixture = await deployCoreFixture();
    const signers = (await ethers.getSigners()).slice(1, 11);

    for (const signer of signers) {
      await fixture.token.operationMint(signer.address, ethers.parseEther("1000"), "seed");
      await fixture.token.connect(signer).approve(await fixture.staking.getAddress(), await fixture.staking.STAKE_AMOUNT());
      await fixture.staking.connect(signer).stake();
      await fixture.registry.connect(signer).joinGuild(1, "appeal-agent");
    }

    const target = signers[0];
    const ranked = signers.map((signer) => signer.address);
    await fixture.registry.connect(fixture.keeper).monthlyEjectionReview(ranked);
    await fixture.registry.connect(fixture.keeper).monthlyEjectionReview(ranked);

    return { ...fixture, target };
  }

  it("files and accepts an appeal, reinstating the agent", async function () {
    const { registry, target } = await loadFixture(ejectedAgentFixture);

    await expect(registry.connect(target).fileAppeal("ranking anomaly"))
      .to.emit(registry, "AppealFiled")
      .withArgs(1n, target.address, "ranking anomaly");

    await registry.assignAppealArbiter(1, target.address);
    await expect(registry.resolveAppeal(1, true)).to.emit(registry, "AppealResolved");

    const appeal = await registry.appeals(1);
    const perf = await registry.agentPerformance(target.address);
    expect(appeal.state).to.equal(2n);
    expect((await registry.getAgent(target.address)).isActive).to.equal(true);
    expect(perf.warningCount).to.equal(0n);
  });

  it("allows a rejected appeal to escalate to DAO within the window", async function () {
    const { registry, target } = await loadFixture(ejectedAgentFixture);

    await registry.connect(target).fileAppeal("second review please");
    await registry.assignAppealArbiter(1, target.address);
    await registry.resolveAppeal(1, false);

    await expect(registry.connect(target).escalateAppealToDAO(1))
      .to.emit(registry, "AppealEscalated")
      .withArgs(1n);

    const appeal = await registry.appeals(1);
    expect(appeal.state).to.equal(4n);
  });
});
