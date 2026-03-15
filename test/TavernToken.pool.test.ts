import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

const TVRN = 10n ** 18n;

describe("TavernToken pool accounting", function () {
  async function deployFixture() {
    const [deployer, recipient, governance, outsider] = await ethers.getSigners();

    const TavernToken = await getWorkspaceContractFactory("TavernToken");
    const token: any = await TavernToken.deploy();
    await token.waitForDeployment();

    await token.grantRole(await token.MINTER_ROLE(), deployer.address);
    await token.grantRole(await token.GOVERNANCE_ROLE(), governance.address);

    return { deployer, recipient, governance, outsider, token };
  }

  it("starts with the four roadmap pools and no direct team mint", async function () {
    const { token } = await loadFixture(deployFixture);

    expect(await token.totalSupply()).to.equal(0n);
    expect(await token.MAX_SUPPLY()).to.equal(2_100_000_000n * TVRN);
    expect(await token.questPoolRemaining()).to.equal(1_050_000_000n * TVRN);
    expect(await token.attendancePoolRemaining()).to.equal(210_000_000n * TVRN);
    expect(await token.clientPoolRemaining()).to.equal(168_000_000n * TVRN);
    expect(await token.operationPoolRemaining()).to.equal(672_000_000n * TVRN);
    expect(await token.totalPoolRemaining()).to.equal(2_100_000_000n * TVRN);
  });

  it("debits only the targeted pool for each mint path", async function () {
    const { token, recipient } = await loadFixture(deployFixture);

    await token.questMint(recipient.address, 11n * TVRN, "quest");
    await token.attendanceMint(recipient.address, 7n * TVRN);
    await token.clientRewardMint(recipient.address, 5n * TVRN, "client");
    await token.operationMint(recipient.address, 3n * TVRN, "ops");

    expect(await token.questPoolRemaining()).to.equal(1_049_999_989n * TVRN);
    expect(await token.attendancePoolRemaining()).to.equal(209_999_993n * TVRN);
    expect(await token.clientPoolRemaining()).to.equal(167_999_995n * TVRN);
    expect(await token.operationPoolRemaining()).to.equal(671_999_997n * TVRN);
    expect(await token.totalSupply()).to.equal(26n * TVRN);
  });

  it("halves the attendance budget and floors it at 7M", async function () {
    const { token, recipient } = await loadFixture(deployFixture);

    expect(await token.attendanceYearlyBudget()).to.equal(60_000_000n * TVRN);

    await token.attendanceMint(recipient.address, 1n * TVRN);
    await time.increase(365 * 24 * 60 * 60 + 1);
    await token.attendanceMint(recipient.address, 1n * TVRN);
    expect(await token.attendanceYearlyBudget()).to.equal(30_000_000n * TVRN);

    await time.increase(365 * 24 * 60 * 60 + 1);
    await token.attendanceMint(recipient.address, 1n * TVRN);
    expect(await token.attendanceYearlyBudget()).to.equal(15_000_000n * TVRN);

    await time.increase(365 * 24 * 60 * 60 + 1);
    await token.attendanceMint(recipient.address, 1n * TVRN);
    expect(await token.attendanceYearlyBudget()).to.equal(7_500_000n * TVRN);

    await time.increase(365 * 24 * 60 * 60 + 1);
    await token.attendanceMint(recipient.address, 1n * TVRN);
    expect(await token.attendanceYearlyBudget()).to.equal(7_000_000n * TVRN);
  });

  it("enforces DAO epoch caps, total reallocation caps, and access control", async function () {
    const { token, governance, outsider, recipient } = await loadFixture(deployFixture);

    await expect(token.connect(outsider).daoReallocate(recipient.address, 1n)).to.be.reverted;

    await token.connect(governance).daoReallocate(recipient.address, 20_000_000n * TVRN);
    expect(await token.epochMinted()).to.equal(20_000_000n * TVRN);
    expect(await token.daoReallocated()).to.equal(20_000_000n * TVRN);

    await expect(
      token.connect(governance).daoReallocate(recipient.address, 11_000_000n * TVRN)
    ).to.be.revertedWith("Epoch cap exceeded");

    await time.increase(30 * 24 * 60 * 60 + 1);
    await token.connect(governance).daoReallocate(recipient.address, 10_000_000n * TVRN);
    expect(await token.epochMinted()).to.equal(10_000_000n * TVRN);
    expect(await token.daoReallocated()).to.equal(30_000_000n * TVRN);

    for (const amount of [30_000_000n, 30_000_000n, 10_000_000n]) {
      await time.increase(30 * 24 * 60 * 60 + 1);
      await token.connect(governance).daoReallocate(recipient.address, amount * TVRN);
    }

    expect(await token.daoReallocated()).to.equal(100_000_000n * TVRN);
    await time.increase(30 * 24 * 60 * 60 + 1);
    await expect(token.connect(governance).daoReallocate(recipient.address, 1n)).to.be.revertedWith(
      "Cap exceeded"
    );
  });

  it("blocks further minting once MAX_SUPPLY is reached", async function () {
    const { token, governance, recipient } = await loadFixture(deployFixture);

    await token.questMint(recipient.address, 1_050_000_000n * TVRN, "quest");
    await token.clientRewardMint(recipient.address, 168_000_000n * TVRN, "client");
    await token.operationMint(recipient.address, 672_000_000n * TVRN, "ops");

    const yearlyAttendanceMints = [
      60_000_000n,
      30_000_000n,
      15_000_000n,
      7_500_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      7_000_000n,
      6_500_000n
    ];

    for (let index = 0; index < yearlyAttendanceMints.length; index += 1) {
      if (index > 0) {
        await time.increase(365 * 24 * 60 * 60 + 1);
      }

      await token.attendanceMint(recipient.address, yearlyAttendanceMints[index] * TVRN);
    }

    expect(await token.totalSupply()).to.equal(await token.MAX_SUPPLY());
    expect(await token.totalPoolRemaining()).to.equal(0n);

    await time.increase(30 * 24 * 60 * 60 + 1);
    await expect(token.connect(governance).daoReallocate(recipient.address, 1n)).to.be.revertedWith(
      "Max supply exceeded"
    );
  });
});
