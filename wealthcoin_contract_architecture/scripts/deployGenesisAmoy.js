const hre = require("hardhat");
require("dotenv").config();

const TEST_ALLOCATION = hre.ethers.parseUnits("21000000", 18);

function requireAddress(name, value) {
  if (!value) {
    throw new Error(`Missing ${name} in .env`);
  }

  if (!hre.ethers.isAddress(value)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }

  return value;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  if (!deployer) {
    throw new Error(
      "No deployer account found. Check PRIVATE_KEY in .env."
    );
  }

  const treasuryAddress = requireAddress(
    "AMOY_TREASURY_WALLET",
    process.env.AMOY_TREASURY_WALLET
  );

  const deployerBalance =
    await hre.ethers.provider.getBalance(deployer.address);

  console.log("\n=== WealthCoin Genesis Amoy Deployment ===");
  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);
  console.log(
    "Deployer test POL:",
    hre.ethers.formatEther(deployerBalance)
  );
  console.log("Treasury:", treasuryAddress);

  // -------------------------------------------------------------
  // Deploy test WTC
  // -------------------------------------------------------------

  console.log("\nDeploying MockWTC...");

  const MockWTC =
    await hre.ethers.getContractFactory("MockWTC");

  const mockWtc = await MockWTC.deploy(deployer.address);
  await mockWtc.waitForDeployment();

  const mockWtcAddress = await mockWtc.getAddress();

  console.log("MockWTC deployed:", mockWtcAddress);

  // -------------------------------------------------------------
  // Deploy Genesis
  // -------------------------------------------------------------

  console.log("\nDeploying WealthCoinGenesis...");

  const WealthCoinGenesis =
    await hre.ethers.getContractFactory(
      "WealthCoinGenesis"
    );

  const genesis = await WealthCoinGenesis.deploy(
    mockWtcAddress,
    treasuryAddress,
    deployer.address
  );

  await genesis.waitForDeployment();

  const genesisAddress = await genesis.getAddress();

  console.log(
    "WealthCoinGenesis deployed:",
    genesisAddress
  );

  // -------------------------------------------------------------
  // Fund Genesis with test WTC
  // -------------------------------------------------------------

  console.log(
    "\nFunding Genesis with 21,000,000 test WTC..."
  );

  const fundingTransaction = await mockWtc.transfer(
    genesisAddress,
    TEST_ALLOCATION
  );

  await fundingTransaction.wait();

  const genesisTokenBalance =
    await mockWtc.balanceOf(genesisAddress);

  console.log(
    "Genesis test WTC balance:",
    hre.ethers.formatUnits(genesisTokenBalance, 18)
  );

  // -------------------------------------------------------------
  // Confirm contract configuration
  // -------------------------------------------------------------

  const rate = await genesis.WTC_PER_POL();
  const minimum = await genesis.MIN_PURCHASE();
  const maximum =
    await genesis.MAX_PURCHASE_PER_WALLET();
  const allocation =
    await genesis.genesisAllocation();
  const fullyFunded =
    await genesis.isFullyFunded();

  console.log("\n=== Configuration Check ===");
  console.log("Rate:", rate.toString(), "WTC per POL");
  console.log(
    "Minimum:",
    hre.ethers.formatEther(minimum),
    "POL"
  );
  console.log(
    "Maximum per wallet:",
    hre.ethers.formatEther(maximum),
    "POL"
  );
  console.log(
    "Allocation:",
    hre.ethers.formatUnits(allocation, 18),
    "WTC"
  );
  console.log("Fully funded:", fullyFunded);

  if (!fullyFunded) {
    throw new Error(
      "Genesis funding verification failed."
    );
  }

  // We intentionally leave the sale closed.
  // Opening is a separate explicit transaction after verification.

  console.log("\n=== Deployment Complete ===");
  console.log("Mock WTC:", mockWtcAddress);
  console.log("Genesis:", genesisAddress);
  console.log("Treasury:", treasuryAddress);
  console.log("Owner:", deployer.address);
  console.log("Sale opened: false");

  console.log("\nSave these Amoy addresses.");
  console.log(
    `AMOY_WTC_TOKEN_ADDRESS=${mockWtcAddress}`
  );
  console.log(
    `AMOY_GENESIS_ADDRESS=${genesisAddress}`
  );
}

main().catch((error) => {
  console.error("\nDeployment failed:");
  console.error(error);
  process.exitCode = 1;
});