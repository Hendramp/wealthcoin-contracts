const hre = require("hardhat");
require("dotenv").config();

const POLYGON_MAINNET_CHAIN_ID = 137n;

const STAGE_COUNT = 10;
const GENESIS_ALLOCATION_WTC = 21_000_000;
const STAGE_ALLOCATION_WTC = 2_100_000;
const FINAL_TO_FIRST_PRICE_MULTIPLIER = 3.5;

/**
 * Requires a valid EVM address from the environment.
 */
function requireAddress(name) {
  const value = process.env[name];

  if (!value || !hre.ethers.isAddress(value)) {
    throw new Error(`Invalid or missing ${name}`);
  }

  return hre.ethers.getAddress(value);
}

/**
 * Requires a positive decimal number from the environment.
 */
function requirePositiveNumber(name) {
  const rawValue = process.env[name];
  const value = Number(rawValue);

  if (
    !rawValue ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new Error(
      `Invalid or missing ${name}. Received: ${rawValue}`
    );
  }

  return value;
}

/**
 * Builds a ten-stage geometric USD price curve.
 *
 * Stage 10 is exactly 3.5x the Stage 1 WTC price.
 * Every stage receives an equal 2.1M WTC allocation.
 * A complete sellout targets the configured USD raise.
 */
function buildStageModel({
  targetRaiseUsd,
  polSpotUsd,
}) {
  const stageGrowth =
    FINAL_TO_FIRST_PRICE_MULTIPLIER **
    (1 / (STAGE_COUNT - 1));

  let multiplierSum = 0;

  for (let i = 0; i < STAGE_COUNT; i += 1) {
    multiplierSum += stageGrowth ** i;
  }

  const firstStageWtcPriceUsd =
    targetRaiseUsd /
    (STAGE_ALLOCATION_WTC * multiplierSum);

  const stages = [];

  for (let i = 0; i < STAGE_COUNT; i += 1) {
    const wtcPriceUsd =
      firstStageWtcPriceUsd *
      stageGrowth ** i;

    const wtcPerPol =
      polSpotUsd / wtcPriceUsd;

    /*
     * The Solidity contract stores the rate as WTC base units
     * received for exactly 1 POL.
     *
     * parseUnits(..., 18) lets us retain fractional rates such as
     * 34.001234 WTC per POL.
     */
    const rateBaseUnits = hre.ethers.parseUnits(
      wtcPerPol.toFixed(18),
      18
    );

    const expectedStageRaiseUsd =
      STAGE_ALLOCATION_WTC * wtcPriceUsd;

    stages.push({
      index: i,
      stageNumber: i + 1,
      wtcPriceUsd,
      wtcPerPol,
      rateBaseUnits,
      expectedStageRaiseUsd,
    });
  }

  return stages;
}

function validateStageModel(stages) {
  if (stages.length !== STAGE_COUNT) {
    throw new Error(
      `Expected ${STAGE_COUNT} stages, received ${stages.length}.`
    );
  }

  for (let i = 0; i < stages.length; i += 1) {
    const stage = stages[i];

    if (stage.rateBaseUnits <= 0n) {
      throw new Error(
        `Stage ${stage.stageNumber} has an invalid rate.`
      );
    }

    if (
      i > 0 &&
      stage.rateBaseUnits >=
        stages[i - 1].rateBaseUnits
    ) {
      throw new Error(
        `Stage ${stage.stageNumber} must provide fewer WTC per POL than Stage ${i}.`
      );
    }
  }
}

async function main() {
  console.log(
    "\n=== WealthCoin Genesis Polygon Mainnet Deployment ==="
  );

  const network =
    await hre.ethers.provider.getNetwork();

  if (network.chainId !== POLYGON_MAINNET_CHAIN_ID) {
    throw new Error(
      `Wrong network. Expected Polygon mainnet chain ID 137, received ${network.chainId}.`
    );
  }

  const [deployer] = await hre.ethers.getSigners();

  if (!deployer) {
    throw new Error(
      "No deployment signer is configured."
    );
  }

  const deployerAddress =
    await deployer.getAddress();

  const deployerBalance =
    await hre.ethers.provider.getBalance(
      deployerAddress
    );

  const tokenAddress =
    requireAddress("WTC_TOKEN_ADDRESS");

  const treasuryAddress =
    requireAddress("TREASURY_WALLET");

  const publicReserveAddress =
    requireAddress("PUBLIC_RESERVE_WALLET");

  const polSpotUsd =
    requirePositiveNumber("POL_SPOT_USD");

  const targetRaiseUsd =
    requirePositiveNumber("GENESIS_TARGET_USD");

  const minimumPurchasePol =
    requirePositiveNumber("MIN_PURCHASE_POL");

  const walletMaximumPol =
    requirePositiveNumber(
      "MAX_PURCHASE_PER_WALLET_POL"
    );

  if (walletMaximumPol < minimumPurchasePol) {
    throw new Error(
      "MAX_PURCHASE_PER_WALLET_POL must be greater than or equal to MIN_PURCHASE_POL."
    );
  }

  const minimumPurchase =
    hre.ethers.parseEther(
      minimumPurchasePol.toString()
    );

  const walletMaximum =
    hre.ethers.parseEther(
      walletMaximumPol.toString()
    );

  const stages = buildStageModel({
    targetRaiseUsd,
    polSpotUsd,
  });

  validateStageModel(stages);

  const stageRates = stages.map(
    (stage) => stage.rateBaseUnits
  );

  const expectedTotalRaiseUsd = stages.reduce(
    (total, stage) =>
      total + stage.expectedStageRaiseUsd,
    0
  );

  console.log("\n=== Deployment Wallet ===");
  console.log("Network:", hre.network.name);
  console.log(
    "Chain ID:",
    network.chainId.toString()
  );
  console.log("Deployer / owner:", deployerAddress);
  console.log(
    "Deployer POL balance:",
    hre.ethers.formatEther(deployerBalance)
  );

  console.log("\n=== Contract Addresses ===");
  console.log("WTC token:", tokenAddress);
  console.log("Treasury:", treasuryAddress);
  console.log(
    "Public reserve:",
    publicReserveAddress
  );

  console.log("\n=== Genesis Economics ===");
  console.log(
    "Genesis allocation:",
    GENESIS_ALLOCATION_WTC.toLocaleString(),
    "WTC"
  );
  console.log(
    "Stage allocation:",
    STAGE_ALLOCATION_WTC.toLocaleString(),
    "WTC"
  );
  console.log(
    "Target complete sellout:",
    `$${targetRaiseUsd.toLocaleString()}`
  );
  console.log(
    "POL spot reference:",
    `$${polSpotUsd}`
  );
  console.log(
    "Stage 10 / Stage 1 price:",
    `${FINAL_TO_FIRST_PRICE_MULTIPLIER}x`
  );
  console.log(
    "Minimum purchase:",
    minimumPurchasePol,
    "POL"
  );
  console.log(
    "Maximum per wallet:",
    walletMaximumPol,
    "POL"
  );

  console.log("\n=== Ten-Stage Schedule ===");

  for (const stage of stages) {
    console.log(
      [
        `Stage ${stage.stageNumber}:`,
        `${stage.wtcPerPol.toFixed(6)} WTC/POL`,
        `| $${stage.wtcPriceUsd.toFixed(8)} per WTC`,
        `| ~$${stage.expectedStageRaiseUsd.toFixed(2)} at sellout`,
      ].join(" ")
    );
  }

  console.log(
    "\nExpected complete sellout:",
    `$${expectedTotalRaiseUsd.toFixed(2)}`
  );

  if (deployerBalance === 0n) {
    throw new Error(
      "The deployment wallet has no POL available for mainnet gas."
    );
  }

  const tokenCode =
    await hre.ethers.provider.getCode(
      tokenAddress
    );

  if (tokenCode === "0x") {
    throw new Error(
      `No smart contract exists at WTC_TOKEN_ADDRESS ${tokenAddress} on Polygon mainnet.`
    );
  }

  console.log(
    "\nDeploying WealthCoinGenesis..."
  );
  console.log(
    "The sale will begin CLOSED and PAUSED."
  );

  const Genesis =
    await hre.ethers.getContractFactory(
      "WealthCoinGenesis"
    );

  const genesis = await Genesis.deploy(
    tokenAddress,
    treasuryAddress,
    publicReserveAddress,
    deployerAddress,
    stageRates,
    minimumPurchase,
    walletMaximum
  );

  const deploymentTransaction =
    genesis.deploymentTransaction();

  console.log(
    "Deployment transaction:",
    deploymentTransaction?.hash ||
      "Unavailable"
  );

  await genesis.waitForDeployment();

  const genesisAddress =
    await genesis.getAddress();

  console.log(
    "WealthCoinGenesis deployed:",
    genesisAddress
  );

  console.log(
    "\n=== On-Chain Configuration Check ==="
  );

  const [
    owner,
    treasury,
    publicReserve,
    wealthCoin,
    minimum,
    maximum,
    allocation,
    stageAllocation,
    stageCount,
    stageDuration,
    saleOpen,
    paused,
    finalized,
    hasOpened,
  ] = await Promise.all([
    genesis.owner(),
    genesis.treasury(),
    genesis.publicReserve(),
    genesis.wealthCoin(),
    genesis.minPurchase(),
    genesis.maxPurchasePerWallet(),
    genesis.genesisAllocation(),
    genesis.stageAllocation(),
    genesis.STAGE_COUNT(),
    genesis.STAGE_DURATION(),
    genesis.saleOpen(),
    genesis.paused(),
    genesis.saleFinalized(),
    genesis.hasOpened(),
  ]);

  console.log("Owner:", owner);
  console.log("Treasury:", treasury);
  console.log(
    "Public reserve:",
    publicReserve
  );
  console.log("WTC token:", wealthCoin);
  console.log(
    "Minimum purchase:",
    hre.ethers.formatEther(minimum),
    "POL"
  );
  console.log(
    "Maximum per wallet:",
    hre.ethers.formatEther(maximum),
    "POL"
  );
  console.log(
    "Genesis allocation:",
    hre.ethers.formatUnits(allocation, 18),
    "WTC"
  );
  console.log(
    "Stage allocation:",
    hre.ethers.formatUnits(
      stageAllocation,
      18
    ),
    "WTC"
  );
  console.log(
    "Stage count:",
    stageCount.toString()
  );
  console.log(
    "Stage duration:",
    stageDuration.toString(),
    "seconds"
  );
  console.log("Has opened:", hasOpened);
  console.log("Sale open:", saleOpen);
  console.log("Paused:", paused);
  console.log("Finalized:", finalized);

  for (let i = 0; i < STAGE_COUNT; i += 1) {
    const onChainRate =
      await genesis.stageRates(i);

    if (onChainRate !== stageRates[i]) {
      throw new Error(
        `Stage ${i + 1} rate verification failed.`
      );
    }
  }

  if (owner !== deployerAddress) {
    throw new Error(
      "Owner verification failed."
    );
  }

  if (treasury !== treasuryAddress) {
    throw new Error(
      "Treasury verification failed."
    );
  }

  if (publicReserve !== publicReserveAddress) {
    throw new Error(
      "Public reserve verification failed."
    );
  }

  if (wealthCoin !== tokenAddress) {
    throw new Error(
      "WTC token verification failed."
    );
  }

  if (
    hasOpened !== false ||
    saleOpen !== false ||
    paused !== true ||
    finalized !== false
  ) {
    throw new Error(
      "Unsafe deployment state: Genesis must begin unopened, closed, paused, and unfinalized."
    );
  }

  console.log(
    "\n=== Deployment Complete ==="
  );
  console.log(
    "Polygon Genesis:",
    genesisAddress
  );
  console.log("WTC token:", tokenAddress);
  console.log("Treasury:", treasuryAddress);
  console.log(
    "Public reserve:",
    publicReserveAddress
  );
  console.log("Owner:", owner);
  console.log("Sale opened:", saleOpen);
  console.log("Paused:", paused);

  console.log(
    "\nSave this public address:"
  );
  console.log(
    `POLYGON_GENESIS_ADDRESS=${genesisAddress}`
  );

  console.log("\nDo not open the sale yet.");
  console.log(
    "Next steps: test locally, verify source, transfer exactly 21,000,000 WTC, confirm funding, and only then open Genesis."
  );
}

main().catch((error) => {
  console.error("\nDeployment failed:");
  console.error(error);
  process.exitCode = 1;
});