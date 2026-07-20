const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("WealthCoinGenesis", function () {
  let owner;
  let treasury;
  let buyer;
  let secondBuyer;
  let publicReserve;

  let token;
  let genesis;

  const STAGE_COUNT = 10;
  const STAGE_DURATION = 7 * 24 * 60 * 60;

  const MIN_PURCHASE = ethers.parseEther("1");
  const MAX_PURCHASE = ethers.parseEther("5000");

  const GENESIS_ALLOCATION =
    ethers.parseEther("21000000");

  const STAGE_ALLOCATION =
    ethers.parseEther("2100000");

  const STAGE_RATES = [
    "34",
    "30",
    "27",
    "24",
    "21",
    "18",
    "16",
    "14",
    "12",
    "10",
  ].map((rate) => ethers.parseUnits(rate, 18));

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [
      seconds,
    ]);

    await ethers.provider.send("evm_mine");
  }

  async function deployGenesis({
    rates = STAGE_RATES,
    minimum = MIN_PURCHASE,
    walletMaximum = MAX_PURCHASE,
  } = {}) {
    const WealthCoinGenesis =
      await ethers.getContractFactory(
        "WealthCoinGenesis"
      );

    const deployedGenesis =
      await WealthCoinGenesis.deploy(
        await token.getAddress(),
        treasury.address,
        publicReserve.address,
        owner.address,
        rates,
        minimum,
        walletMaximum
      );

    await deployedGenesis.waitForDeployment();

    return deployedGenesis;
  }

  beforeEach(async function () {
    [
      owner,
      treasury,
      buyer,
      secondBuyer,
      publicReserve,
    ] = await ethers.getSigners();

    const MockWTC =
      await ethers.getContractFactory("MockWTC");

    token = await MockWTC.deploy(owner.address);
    await token.waitForDeployment();

    genesis = await deployGenesis();

    await token.transfer(
      await genesis.getAddress(),
      GENESIS_ALLOCATION
    );

    await ethers.provider.send("hardhat_setBalance", [
      buyer.address,
      ethers.toBeHex(
        ethers.parseEther("100000")
      ),
    ]);

    await ethers.provider.send("hardhat_setBalance", [
      secondBuyer.address,
      ethers.toBeHex(
        ethers.parseEther("100000")
      ),
    ]);
  });

  describe("Deployment", function () {
    it("sets the owner correctly", async function () {
      expect(await genesis.owner()).to.equal(
        owner.address
      );
    });

    it("sets the treasury correctly", async function () {
      expect(await genesis.treasury()).to.equal(
        treasury.address
      );
    });

    it("sets the public reserve correctly", async function () {
      expect(
        await genesis.publicReserve()
      ).to.equal(publicReserve.address);
    });

    it("sets the WTC token correctly", async function () {
      expect(await genesis.wealthCoin()).to.equal(
        await token.getAddress()
      );
    });

    it("stores all ten stage rates", async function () {
      for (let i = 0; i < STAGE_COUNT; i += 1) {
        expect(
          await genesis.stageRates(i)
        ).to.equal(STAGE_RATES[i]);
      }
    });

    it("sets the purchase limits", async function () {
      expect(
        await genesis.minPurchase()
      ).to.equal(MIN_PURCHASE);

      expect(
        await genesis.maxPurchasePerWallet()
      ).to.equal(MAX_PURCHASE);
    });

    it("sets the Genesis allocation", async function () {
      expect(
        await genesis.genesisAllocation()
      ).to.equal(GENESIS_ALLOCATION);
    });

    it("sets the equal stage allocation", async function () {
      expect(
        await genesis.stageAllocation()
      ).to.equal(STAGE_ALLOCATION);
    });

    it("sets ten stages of seven days each", async function () {
      expect(
        await genesis.STAGE_COUNT()
      ).to.equal(10n);

      expect(
        await genesis.STAGE_DURATION()
      ).to.equal(BigInt(STAGE_DURATION));
    });

    it("starts unopened, closed, paused, and unfinalized", async function () {
      expect(await genesis.hasOpened()).to.equal(
        false
      );

      expect(await genesis.saleOpen()).to.equal(
        false
      );

      expect(await genesis.paused()).to.equal(true);

      expect(
        await genesis.saleFinalized()
      ).to.equal(false);
    });

    it("reports full funding after receiving 21M WTC", async function () {
      expect(
        await genesis.isFullyFunded()
      ).to.equal(true);
    });

    it("rejects a zero stage rate", async function () {
      const invalidRates = [...STAGE_RATES];
      invalidRates[4] = 0n;

      await expect(
        deployGenesis({
          rates: invalidRates,
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "InvalidStageRate"
      );
    });

    it("rejects rates that do not decrease", async function () {
      const invalidRates = [...STAGE_RATES];

      invalidRates[5] = invalidRates[4];

      await expect(
        deployGenesis({
          rates: invalidRates,
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "StageRatesMustDecrease"
      );
    });

    it("rejects invalid purchase limits", async function () {
      await expect(
        deployGenesis({
          minimum: ethers.parseEther("10"),
          walletMaximum: ethers.parseEther("5"),
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "InvalidPurchaseLimits"
      );
    });
  });

  describe("Opening Genesis", function () {
    it("allows the owner to open a fully funded sale", async function () {
      await expect(genesis.openGenesis())
        .to.emit(genesis, "GenesisOpened");

      expect(await genesis.hasOpened()).to.equal(
        true
      );

      expect(await genesis.saleOpen()).to.equal(
        true
      );

      expect(await genesis.paused()).to.equal(
        false
      );

      expect(await genesis.currentStage()).to.equal(
        0n
      );

      expect(
        await genesis.currentRate()
      ).to.equal(STAGE_RATES[0]);
    });

    it("sets the first stage timing when opened", async function () {
      await genesis.openGenesis();

      const start =
        await genesis.currentStageStart();

      const end =
        await genesis.currentStageEnd();

      expect(start).to.be.greaterThan(0n);

      expect(end - start).to.equal(
        BigInt(STAGE_DURATION)
      );
    });

    it("rejects opening by a non-owner", async function () {
      await expect(
        genesis.connect(buyer).openGenesis()
      ).to.be.revertedWithCustomError(
        genesis,
        "OwnableUnauthorizedAccount"
      );
    });

    it("rejects opening when underfunded", async function () {
      const underfundedGenesis =
        await deployGenesis();

      await expect(
        underfundedGenesis.openGenesis()
      ).to.be.revertedWithCustomError(
        underfundedGenesis,
        "InsufficientGenesisFunding"
      );
    });

    it("rejects opening more than once", async function () {
      await genesis.openGenesis();
      await genesis.pauseGenesis();

      await expect(
        genesis.openGenesis()
      ).to.be.revertedWithCustomError(
        genesis,
        "SaleAlreadyOpened"
      );
    });
  });

  describe("Purchases", function () {
    beforeEach(async function () {
      await genesis.openGenesis();
    });

    it("rejects a purchase below the minimum", async function () {
      await expect(
        genesis.connect(buyer).buyTokens({
          value: ethers.parseEther("0.5"),
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "BelowMinimumPurchase"
      );
    });

    it("sells WTC at the current stage rate", async function () {
      const purchase =
        ethers.parseEther("1");

      const expectedWtc =
        ethers.parseEther("34");

      await expect(
        genesis.connect(buyer).buyTokens({
          value: purchase,
        })
      ).to.emit(genesis, "TokensPurchased");

      expect(
        await token.balanceOf(buyer.address)
      ).to.equal(expectedWtc);

      expect(
        await genesis.stageWtcSold(0)
      ).to.equal(expectedWtc);

      expect(
        await genesis.totalPolRaised()
      ).to.equal(purchase);

      expect(
        await genesis.totalWtcSold()
      ).to.equal(expectedWtc);
    });

    it("calculates the current-stage token amount", async function () {
      expect(
        await genesis.calculateTokenAmount(
          ethers.parseEther("10")
        )
      ).to.equal(ethers.parseEther("340"));
    });

    it("calculates token amounts for a selected stage", async function () {
      expect(
        await genesis.calculateTokenAmountAtStage(
          ethers.parseEther("10"),
          1
        )
      ).to.equal(ethers.parseEther("300"));
    });

    it("delivers WTC immediately", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("100"),
      });

      expect(
        await token.balanceOf(buyer.address)
      ).to.equal(ethers.parseEther("3400"));
    });

    it("forwards accepted POL immediately to treasury", async function () {
      const amount =
        ethers.parseEther("100");

      await expect(() =>
        genesis.connect(buyer).buyTokens({
          value: amount,
        })
      ).to.changeEtherBalance(
        treasury,
        amount
      );
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
      ).to.equal(ethers.parseEther("10200"));
    });

    it("allows a wallet to reach exactly its cap", async function () {
      await genesis.connect(buyer).buyTokens({
        value: MAX_PURCHASE,
      });

      expect(
        await genesis.polPurchasedByWallet(
          buyer.address
        )
      ).to.equal(MAX_PURCHASE);

      expect(
        await genesis.remainingWalletAllowance(
          buyer.address
        )
      ).to.equal(0n);
    });

    it("rejects a cumulative purchase above the wallet cap", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("4999"),
      });

      await expect(
        genesis.connect(buyer).buyTokens({
          value: ethers.parseEther("2"),
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "WalletCapExceeded"
      );
    });

    it("keeps separate accounting for different buyers", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("10"),
      });

      await genesis
        .connect(secondBuyer)
        .buyTokens({
          value: ethers.parseEther("20"),
        });

      expect(
        await genesis.polPurchasedByWallet(
          buyer.address
        )
      ).to.equal(ethers.parseEther("10"));

      expect(
        await genesis.polPurchasedByWallet(
          secondBuyer.address
        )
      ).to.equal(ethers.parseEther("20"));
    });

    it("rejects direct POL transfers", async function () {
      await expect(
        buyer.sendTransaction({
          to: await genesis.getAddress(),
          value: ethers.parseEther("1"),
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "DirectPaymentsDisabled"
      );
    });
  });
    describe("Automatic stage progression", function () {
    beforeEach(async function () {
      await genesis.openGenesis();
    });

    it("advances after seven days", async function () {
      await increaseTime(STAGE_DURATION);

      await expect(genesis.syncStages())
        .to.emit(genesis, "StageClosed")
        .and.to.emit(genesis, "StageAdvanced");

      expect(
        await genesis.currentStage()
      ).to.equal(1n);

      expect(
        await genesis.stageClosed(0)
      ).to.equal(true);

      expect(
        await genesis.stageUnsoldWtc(0)
      ).to.equal(STAGE_ALLOCATION);

      expect(
        await genesis.totalWtcReturnedToPublicAllocation()
      ).to.equal(STAGE_ALLOCATION);
    });

    it("does not roll unsold WTC into the next stage", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("100"),
      });

      const stageZeroSold =
        ethers.parseEther("3400");

      await increaseTime(STAGE_DURATION);
      await genesis.syncStages();

      expect(
        await genesis.stageWtcSold(0)
      ).to.equal(stageZeroSold);

      expect(
        await genesis.stageUnsoldWtc(0)
      ).to.equal(
        STAGE_ALLOCATION - stageZeroSold
      );

      expect(
        await genesis.remainingCurrentStageAllocation()
      ).to.equal(STAGE_ALLOCATION);
    });

    it("syncs an expired stage before processing a purchase", async function () {
      await increaseTime(STAGE_DURATION);

      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("1"),
      });

      expect(
        await genesis.currentStage()
      ).to.equal(1n);

      expect(
        await genesis.stageClosed(0)
      ).to.equal(true);

      expect(
        await token.balanceOf(buyer.address)
      ).to.equal(ethers.parseEther("30"));

      expect(
        await genesis.stageWtcSold(1)
      ).to.equal(ethers.parseEther("30"));
    });

    it("advances across multiple expired stages", async function () {
      await increaseTime(STAGE_DURATION * 3);

      await genesis.syncStages();

      expect(
        await genesis.currentStage()
      ).to.equal(3n);

      expect(
        await genesis.stageClosed(0)
      ).to.equal(true);

      expect(
        await genesis.stageClosed(1)
      ).to.equal(true);

      expect(
        await genesis.stageClosed(2)
      ).to.equal(true);

      expect(
        await genesis.totalWtcReturnedToPublicAllocation()
      ).to.equal(STAGE_ALLOCATION * 3n);
    });

    it("uses the new rate after a stage advances", async function () {
      await increaseTime(STAGE_DURATION);
      await genesis.syncStages();

      expect(
        await genesis.currentRate()
      ).to.equal(STAGE_RATES[1]);

      expect(
        await genesis.calculateTokenAmount(
          ethers.parseEther("1")
        )
      ).to.equal(ethers.parseEther("30"));
    });

    it("automatically finalizes after all ten stages expire", async function () {
      await increaseTime(STAGE_DURATION * 10);

      await expect(genesis.syncStages())
        .to.emit(genesis, "GenesisFinalized");

      expect(
        await genesis.saleFinalized()
      ).to.equal(true);

      expect(
        await genesis.saleOpen()
      ).to.equal(false);

      expect(
        await genesis.paused()
      ).to.equal(true);

      expect(
        await genesis.totalWtcReturnedToPublicAllocation()
      ).to.equal(GENESIS_ALLOCATION);
    });
  });

  describe("Stage sellout and excess refund", function () {
    let selloutGenesis;

    beforeEach(async function () {
      const highWalletMaximum =
        ethers.parseEther("100000");

      selloutGenesis = await deployGenesis({
        walletMaximum: highWalletMaximum,
      });

      await token.transfer(
        await selloutGenesis.getAddress(),
        GENESIS_ALLOCATION
      );

      await selloutGenesis.openGenesis();
    });

    it("closes and advances immediately when a stage sells out", async function () {
      const oversizedPurchase =
        ethers.parseEther("62000");

      await expect(
        selloutGenesis.connect(buyer).buyTokens({
          value: oversizedPurchase,
        })
      )
        .to.emit(selloutGenesis, "ExcessPolRefunded")
        .and.to.emit(selloutGenesis, "StageClosed")
        .and.to.emit(selloutGenesis, "StageAdvanced");

      expect(
        await selloutGenesis.stageWtcSold(0)
      ).to.equal(STAGE_ALLOCATION);

      expect(
        await selloutGenesis.stageUnsoldWtc(0)
      ).to.equal(0n);

      expect(
        await selloutGenesis.stageClosed(0)
      ).to.equal(true);

      expect(
        await selloutGenesis.currentStage()
      ).to.equal(1n);

      expect(
        await token.balanceOf(buyer.address)
      ).to.equal(STAGE_ALLOCATION);
    });

    it("accepts only the POL required to finish the stage", async function () {
      const oversizedPurchase =
        ethers.parseEther("62000");

      await selloutGenesis
        .connect(buyer)
        .buyTokens({
          value: oversizedPurchase,
        });

      const acceptedPol =
        await selloutGenesis.totalPolRaised();

      expect(acceptedPol).to.be.lessThan(
        oversizedPurchase
      );

      expect(acceptedPol).to.be.greaterThan(0n);

      expect(
        await selloutGenesis.polPurchasedByWallet(
          buyer.address
        )
      ).to.equal(acceptedPol);
    });

    it("does not use excess POL to purchase from the next stage", async function () {
      await selloutGenesis
        .connect(buyer)
        .buyTokens({
          value: ethers.parseEther("62000"),
        });

      expect(
        await selloutGenesis.currentStage()
      ).to.equal(1n);

      expect(
        await selloutGenesis.stageWtcSold(1)
      ).to.equal(0n);
    });
  });

  describe("Pause and resume", function () {
    beforeEach(async function () {
      await genesis.openGenesis();
    });

    it("allows only the owner to pause", async function () {
      await expect(
        genesis.connect(buyer).pauseGenesis()
      ).to.be.revertedWithCustomError(
        genesis,
        "OwnableUnauthorizedAccount"
      );
    });

    it("blocks purchases while paused", async function () {
      await genesis.pauseGenesis();

      await expect(
        genesis.connect(buyer).buyTokens({
          value: ethers.parseEther("1"),
        })
      ).to.be.revertedWithCustomError(
        genesis,
        "EnforcedPause"
      );
    });

    it("resumes purchases", async function () {
      await genesis.pauseGenesis();
      await genesis.resumeGenesis();

      expect(
        await genesis.saleOpen()
      ).to.equal(true);

      expect(
        await genesis.paused()
      ).to.equal(false);

      await expect(
        genesis.connect(buyer).buyTokens({
          value: ethers.parseEther("1"),
        })
      ).to.emit(genesis, "TokensPurchased");
    });

    it("freezes the stage timer during a pause", async function () {
      const originalEnd =
        await genesis.currentStageEnd();

      await genesis.pauseGenesis();

      await increaseTime(3 * 24 * 60 * 60);

      await genesis.resumeGenesis();

      const resumedEnd =
        await genesis.currentStageEnd();

      expect(resumedEnd).to.be.greaterThan(
        originalEnd
      );

      expect(
        await genesis.currentStage()
      ).to.equal(0n);
    });

    it("rejects resume after finalization", async function () {
      await genesis.finalizeGenesis();

      await expect(
        genesis.resumeGenesis()
      ).to.be.revertedWithCustomError(
        genesis,
        "SaleAlreadyFinalized"
      );
    });
  });

  describe("Finalization and public reserve", function () {
    beforeEach(async function () {
      await genesis.openGenesis();
    });

    it("allows the owner to finalize Genesis", async function () {
      await expect(genesis.finalizeGenesis())
        .to.emit(genesis, "GenesisFinalized");

      expect(
        await genesis.saleFinalized()
      ).to.equal(true);

      expect(
        await genesis.saleOpen()
      ).to.equal(false);

      expect(
        await genesis.paused()
      ).to.equal(true);
    });

    it("closes every remaining stage during owner finalization", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("1"),
      });

      await genesis.finalizeGenesis();

      for (let i = 0; i < STAGE_COUNT; i += 1) {
        expect(
          await genesis.stageClosed(i)
        ).to.equal(true);
      }

      expect(
        await genesis.totalWtcReturnedToPublicAllocation()
      ).to.equal(
        GENESIS_ALLOCATION -
          ethers.parseEther("34")
      );
    });

    it("prevents non-owners from finalizing", async function () {
      await expect(
        genesis.connect(buyer).finalizeGenesis()
      ).to.be.revertedWithCustomError(
        genesis,
        "OwnableUnauthorizedAccount"
      );
    });

    it("rejects returning WTC before finalization", async function () {
      await expect(
        genesis.returnUnsoldTokensToPublicReserve()
      ).to.be.revertedWithCustomError(
        genesis,
        "SaleNotFinalized"
      );
    });

    it("returns all remaining WTC to the fixed public reserve", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("1"),
      });

      await genesis.finalizeGenesis();

      const remainingBalance =
        await token.balanceOf(
          await genesis.getAddress()
        );

      await expect(
        genesis.returnUnsoldTokensToPublicReserve()
      )
        .to.emit(
          genesis,
          "UnsoldTokensReturnedToPublicReserve"
        )
        .withArgs(
          publicReserve.address,
          remainingBalance
        );

      expect(
        await token.balanceOf(
          publicReserve.address
        )
      ).to.equal(remainingBalance);

      expect(
        await token.balanceOf(
          await genesis.getAddress()
        )
      ).to.equal(0n);
    });

    it("cannot send unsold WTC to an arbitrary wallet", async function () {
      await genesis.finalizeGenesis();

      await genesis.returnUnsoldTokensToPublicReserve();

      expect(
        await token.balanceOf(
          publicReserve.address
        )
      ).to.equal(GENESIS_ALLOCATION);

      expect(
        await token.balanceOf(
          secondBuyer.address
        )
      ).to.equal(0n);
    });

    it("rejects a second public-reserve return when empty", async function () {
      await genesis.finalizeGenesis();

      await genesis.returnUnsoldTokensToPublicReserve();

      await expect(
        genesis.returnUnsoldTokensToPublicReserve()
      ).to.be.revertedWithCustomError(
        genesis,
        "NoTokensToRecover"
      );
    });
  });

  describe("View functions", function () {
    beforeEach(async function () {
      await genesis.openGenesis();
    });

    it("returns current-stage details", async function () {
      const details =
        await genesis.getCurrentStageDetails();

      expect(details.stage).to.equal(0n);
      expect(details.rate).to.equal(
        STAGE_RATES[0]
      );
      expect(details.allocation).to.equal(
        STAGE_ALLOCATION
      );
      expect(details.sold).to.equal(0n);
      expect(details.remaining).to.equal(
        STAGE_ALLOCATION
      );
      expect(details.endTime).to.be.greaterThan(
        details.startTime
      );
    });

    it("returns details for any valid stage", async function () {
      const details =
        await genesis.getStageDetails(5);

      expect(details.rate).to.equal(
        STAGE_RATES[5]
      );

      expect(details.allocation).to.equal(
        STAGE_ALLOCATION
      );

      expect(details.sold).to.equal(0n);
      expect(details.unsold).to.equal(0n);
      expect(details.closed).to.equal(false);
    });

    it("rejects an invalid stage index", async function () {
      await expect(
        genesis.getStageDetails(10)
      ).to.be.revertedWithCustomError(
        genesis,
        "InvalidStage"
      );
    });

    it("reports the remaining Genesis allocation", async function () {
      await genesis.connect(buyer).buyTokens({
        value: ethers.parseEther("1"),
      });

      expect(
        await genesis.remainingAllocation()
      ).to.equal(
        GENESIS_ALLOCATION -
          ethers.parseEther("34")
      );
    });
  });
});