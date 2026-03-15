import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("AdminPriceFeed", function () {
  async function deployFixture() {
    const [owner, other, refresher] = await ethers.getSigners();
    const AdminPriceFeed = await ethers.getContractFactory("AdminPriceFeed");
    const feed: any = await AdminPriceFeed.deploy(1_000_000);
    await feed.waitForDeployment();

    return { owner, other, refresher, feed };
  }

  it("returns the expected Chainlink metadata", async function () {
    const { feed } = await loadFixture(deployFixture);

    expect(await feed.decimals()).to.equal(8);
    expect(await feed.description()).to.equal("TVRN / USD");
    expect(await feed.version()).to.equal(1);
  });

  it("returns the initial round from latestRoundData", async function () {
    const { feed } = await loadFixture(deployFixture);

    const [roundId, answer, startedAt, updatedAt, answeredInRound] = await feed.latestRoundData();
    expect(roundId).to.equal(1n);
    expect(answer).to.equal(1_000_000n);
    expect(startedAt).to.equal(updatedAt);
    expect(updatedAt).to.be.gt(0n);
    expect(answeredInRound).to.equal(roundId);
  });

  it("updates price and increments round id", async function () {
    const { feed } = await loadFixture(deployFixture);

    await time.increase(1);
    const tx = await feed.updatePrice(2_000_000);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);
    await expect(tx)
      .to.emit(feed, "PriceUpdated")
      .withArgs(2n, 2_000_000n, BigInt(block!.timestamp));

    const [roundId, answer, , updatedAt, answeredInRound] = await feed.latestRoundData();
    expect(roundId).to.equal(2n);
    expect(answer).to.equal(2_000_000n);
    expect(updatedAt).to.equal(BigInt(block!.timestamp));
    expect(answeredInRound).to.equal(roundId);
  });

  it("reverts for zero or negative prices", async function () {
    const { feed } = await loadFixture(deployFixture);

    await expect(feed.updatePrice(0)).to.be.revertedWithCustomError(feed, "InvalidPrice");
    await expect(feed.updatePrice(-1n)).to.be.revertedWithCustomError(feed, "InvalidPrice");
  });

  it("refreshes the current price with a new timestamp", async function () {
    const { feed } = await loadFixture(deployFixture);

    const [, initialAnswer, , initialUpdatedAt] = await feed.latestRoundData();
    await time.increase(60);
    await feed.refreshPrice();

    const [roundId, refreshedAnswer, , refreshedUpdatedAt, answeredInRound] = await feed.latestRoundData();
    expect(roundId).to.equal(2n);
    expect(refreshedAnswer).to.equal(initialAnswer);
    expect(refreshedUpdatedAt).to.be.gt(initialUpdatedAt);
    expect(answeredInRound).to.equal(roundId);
  });

  it("allows assigned refreshers to refresh the current price", async function () {
    const { feed, refresher } = await loadFixture(deployFixture);

    await feed.setRefresher(refresher.address, true);
    await time.increase(60);
    await expect(feed.connect(refresher).refreshPrice()).to.emit(feed, "PriceUpdated");
  });

  it("prevents non-owners from updating and unauthorized callers from refreshing", async function () {
    const { feed, other } = await loadFixture(deployFixture);

    await expect(feed.connect(other).updatePrice(2_000_000))
      .to.be.revertedWithCustomError(feed, "OwnableUnauthorizedAccount")
      .withArgs(other.address);
    await expect(feed.connect(other).refreshPrice()).to.be.revertedWith("Not authorized");
  });

  it("returns historical round data and reverts for missing rounds", async function () {
    const { feed } = await loadFixture(deployFixture);

    await time.increase(1);
    await feed.updatePrice(2_000_000);

    const firstRound = await feed.getRoundData(1);
    const secondRound = await feed.getRoundData(2);

    expect(firstRound[0]).to.equal(1n);
    expect(firstRound[1]).to.equal(1_000_000n);
    expect(firstRound[4]).to.equal(1n);

    expect(secondRound[0]).to.equal(2n);
    expect(secondRound[1]).to.equal(2_000_000n);
    expect(secondRound[4]).to.equal(2n);

    await expect(feed.getRoundData(999)).to.be.revertedWith("No data present");
  });
});
