import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployCoreFixture } from "./helpers/deployCoreFixture";

describe("TavernStaking slash differentiation", function () {
  it("slashes 50 percent on ejection and returns the remainder after cooldown", async function () {
    const { staking, token, agent } = await loadFixture(deployCoreFixture);

    await token.connect(agent).approve(await staking.getAddress(), await staking.STAKE_AMOUNT());
    await staking.connect(agent).stake();

    await staking.slashEjection(agent.address);
    const info = await staking.getStakeInfo(agent.address);
    expect(info.amount).to.equal(ethers.parseEther("50"));
    expect(info.slashed).to.equal(true);

    await time.increase(7 * 24 * 60 * 60 + 1);
    const before = await token.balanceOf(agent.address);
    await staking.connect(agent).withdraw();
    expect((await token.balanceOf(agent.address)) - before).to.equal(ethers.parseEther("50"));
  });

  it("slashes 10 percent on challenge failure and preserves 90 percent for withdrawal", async function () {
    const { staking, token, client } = await loadFixture(deployCoreFixture);

    await token.connect(client).approve(await staking.getAddress(), await staking.STAKE_AMOUNT());
    await staking.connect(client).stake();

    await staking.slashChallenge(client.address);
    const info = await staking.getStakeInfo(client.address);
    expect(info.amount).to.equal(ethers.parseEther("90"));
    expect(await staking.isStaked(client.address)).to.equal(false);

    await time.increase(7 * 24 * 60 * 60 + 1);
    const before = await token.balanceOf(client.address);
    await staking.connect(client).withdraw();
    expect((await token.balanceOf(client.address)) - before).to.equal(ethers.parseEther("90"));
  });

  it("keeps the legacy slash wrapper mapped to the 50 percent ejection path", async function () {
    const { staking, token, referrer } = await loadFixture(deployCoreFixture);

    await token.connect(referrer).approve(await staking.getAddress(), await staking.STAKE_AMOUNT());
    await staking.connect(referrer).stake();

    await staking.slash(referrer.address);
    const info = await staking.getStakeInfo(referrer.address);
    expect(info.amount).to.equal(ethers.parseEther("50"));
  });
});
