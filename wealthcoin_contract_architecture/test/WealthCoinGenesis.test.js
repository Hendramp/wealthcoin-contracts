const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("WealthCoinGenesis", function () {
  let owner;
  let treasury;
  let buyer;
  let secondBuyer;
  let recoveryWallet;

  let token;
  let genesis;

  const RATE = 350n;
  const MIN_PURCHASE = ethers.parseEther("50");
  const MAX_PURCHASE = ethers.parseEther("5000");
  const ALLOCATION = ethers.parseEther("21000000");

  beforeEach(async function () {
    [owner, treasury, buyer, secondBuyer, recoveryWallet] =
      await ethers.getSigners();

    const MockWTC = await ethers.getContractFactory("MockWTC");
    token = await MockWTC.deploy(owner.address);
    await token.waitForDeployment();
    await ethers.provider.send("hardhat_setBalance", [
  buyer.address,
  ethers.toBeHex(ethers.parseEther("10000")),
]);

await ethers.provider.send("hardhat_setBalance", [
  secondBuyer.address,
  ethers.toBeHex(ethers.parseEther("10000")),
]);

    const WealthCoinGenesis =
      await ethers.getContractFactory("WealthCoinGenesis");

    genesis = await WealthCoinGenesis.deploy(
      await token.getAddress(),
      treasury.address,
      owner.address
    );

    await genesis.waitForDeployment();

    await token.transfer(
      await genesis.getAddress(),
      ALLOCATION
    );
  });

  describe("Deployment", function () {
    it("sets the correct owner", async function () {
      expect(await genesis.owner()).to.equal(owner.address);
    });

    it("sets the correct treasury", async function () {
      expect(await genesis.treasury()).to.equal(
        treasury.address
      );
    });

    it("sets the correct rate", async function () {
      expect(await genesis.WTC_PER_POL()).to.equal(RATE);
    });

    it("sets the correct minimum purchase", async function () {
      expect(await genesis.MIN_PURCHASE()).to.equal(
        MIN_PURCHASE
      );
    });

    it("sets the correct cumulative wallet maximum", async function () {
      expect(
        await genesis.MAX_PURCHASE_PER_WALLET()
      ).to.equal(MAX_PURCHASE);
    });

    it("sets the full Genesis allocation", async function () {
      expect(
        await genesis.genesisAllocation()
      ).to.equal(ALLOCATION);
    });

    it("starts closed and paused", async function () {
      expect(await genesis.saleOpen()).to.equal(false);
      expect(await genesis.paused()).to.equal(true);
    });

    it("is fully funded before opening", async function () {
      expect(await genesis.isFullyFunded()).to.equal(true);
    });
  });

  describe("Opening Genesis", function () {
    it("allows the owner to open a fully funded sale", async function () {
      await expect(genesis.openGenesis())
        .to.emit(genesis, "GenesisOpened");

      expect(await genesis.saleOpen()).to.equal(true);
      expect(await genesis.hasOpened()).to.equal(true);
      expect(await genesis.paused()).to.equal(false);
    });

    it("rejects opening from a non-owner", async function () {
      await expect(
        genesis.connect(buyer).openGenesis()
      ).to.be.revertedWithCustomError(
        genesis,
        "OwnableUnauthorizedAccount"
      );
    });

    it("rejects opening if the contract is underfunded", async function () {
      const WealthCoinGenesis =
        await ethers.getContractFactory(
          "WealthCoinGenesis"
        );

      const underfundedGenesis =
        await WealthCoinGenesis.deploy(
          await token.getAddress(),
          treasury.address,
          owner.address
        );

      await underfundedGenesis.waitForDeployment();

      await expect(
        underfundedGenesis.openGenesis()
      ).to.be.revertedWithCustomError(
        underfundedGenesis,
        "InsufficientGenesisFunding"
      );
    });
  });

  describe("Purchases", function () {
    beforeEach(async function () {
      await genesis.openGenesis();
    });

    it("rejects a purchase below 50 POL", async function () {
      await expect(
        genesis.connect(buyer).buyTokens({
          value: ethers.parseEther("49"),
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "BelowMinimumPurchase"
      );
    });

    it("accepts a valid 50 POL purchase", async function () {
      const purchaseAmount = ethers.parseEther("50");
      const expectedTokens = ethers.parseEther("17500");

      await expect(
        genesis.connect(buyer).buyTokens({
          value: purchaseAmount,
        })
      )
        .to.emit(genesis, "TokensPurchased")
        .withArgs(
          1n,
          buyer.address,
          purchaseAmount,
          expectedTokens,
          purchaseAmount,
          anyTimestamp
        );

      expect(
        await token.balanceOf(buyer.address)
      ).to.equal(expectedTokens);

      expect(
        await genesis.totalPolRaised()
      ).to.equal(purchaseAmount);

      expect(
        await genesis.totalWtcSold()
      ).to.equal(expectedTokens);

      expect(
        await genesis.purchaseCount()
      ).to.equal(1n);
    });

    it("delivers WTC immediately", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("100"),
      });

      expect(
        await token.balanceOf(buyer.address)
      ).to.equal(ethers.parseEther("35000"));
    });

    it("forwards POL immediately to treasury", async function () {
      const amount = ethers.parseEther("100");

      await expect(() =>
        genesis.connect(buyer).buyTokens({
          value: amount,
        })
      ).to.changeEtherBalance(treasury, amount);
    });

    it("tracks cumulative wallet purchases", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("100"),
      });

      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("200"),
      });

      expect(
        await genesis.polPurchasedByWallet(
          buyer.address
        )
      ).to.equal(ethers.parseEther("300"));

      expect(
        await genesis.wtcPurchasedByWallet(
          buyer.address
        )
      ).to.equal(ethers.parseEther("105000"));
    });

    it("allows a wallet to reach exactly 5,000 POL", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("5000"),
      });

      expect(
        await genesis.polPurchasedByWallet(
          buyer.address
        )
      ).to.equal(MAX_PURCHASE);

      expect(
        await token.balanceOf(buyer.address)
      ).to.equal(ethers.parseEther("1750000"));
    });

    it("rejects a cumulative wallet purchase over 5,000 POL", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("4900"),
      });

      await expect(
        genesis.connect(buyer).buyTokens({
          value: ethers.parseEther("101"),
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "WalletCapExceeded"
      );
    });

    it("increments purchase numbers sequentially", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("50"),
      });

      await genesis.connect(secondBuyer).buyTokens({
        value: ethers.parseEther("50"),
      });

      expect(
        await genesis.purchaseCount()
      ).to.equal(2n);
    });

    it("rejects direct POL transfers", async function () {
      await expect(
        buyer.sendTransaction({
          to: await genesis.getAddress(),
          value: ethers.parseEther("50"),
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "DirectPaymentsDisabled"
      );
    });
  });

  describe("Pause and resume", function () {
    beforeEach(async function () {
      await genesis.openGenesis();
    });

    it("blocks purchases while paused", async function () {
      await genesis.pauseGenesis();

      await expect(
        genesis.connect(buyer).buyTokens({
          value: ethers.parseEther("50"),
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "EnforcedPause"
      );
    });

    it("allows purchases after resuming", async function () {
      await genesis.pauseGenesis();
      await genesis.resumeGenesis();

      await expect(
        genesis.connect(buyer).buyTokens({
          value: ethers.parseEther("50"),
        })
      ).to.emit(genesis, "TokensPurchased");
    });
  });

  describe("Finalization and recovery", function () {
    beforeEach(async function () {
      await genesis.openGenesis();
    });

    it("permanently finalizes the sale", async function () {
      await expect(genesis.finalizeGenesis())
        .to.emit(genesis, "GenesisFinalized");

      expect(
        await genesis.saleFinalized()
      ).to.equal(true);

      expect(await genesis.saleOpen()).to.equal(false);
      expect(await genesis.paused()).to.equal(true);
    });

    it("blocks reopening after finalization", async function () {
      await genesis.finalizeGenesis();

      await expect(
        genesis.resumeGenesis()
      ).to.be.revertedWithCustomError(
        genesis,
        "SaleAlreadyFinalized"
      );
    });

    it("rejects unsold-token recovery before finalization", async function () {
      await expect(
        genesis.recoverUnsoldTokens(
          recoveryWallet.address
        )
      ).to.be.revertedWithCustomError(
        genesis,
        "SaleNotFinalized"
      );
    });

    it("recovers unsold WTC after finalization", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("50"),
      });

      await genesis.finalizeGenesis();

      const remaining =
        await token.balanceOf(
          await genesis.getAddress()
        );

      await expect(
        genesis.recoverUnsoldTokens(
          recoveryWallet.address
        )
      )
        .to.emit(genesis, "UnsoldTokensRecovered")
        .withArgs(
          recoveryWallet.address,
          remaining
        );

      expect(
        await token.balanceOf(
          recoveryWallet.address
        )
      ).to.equal(remaining);
    });
  });
});

const anyTimestamp = () => true;