const hre = require("hardhat");
require("dotenv").config();

const POLYGON_MAINNET_CHAIN_ID = 137n;

function requireAddress(name) {
  const value = process.env[name];

  if (!value || !hre.ethers.isAddress(value)) {
    throw new Error(`Invalid or missing ${name}`);
  }

  return hre.ethers.getAddress(value);
}

async function main() {
  console.log("\n=== WealthCoin Genesis Polygon Mainnet Deployment ===");

  const network = await hre.ethers.provider.getNetwork();

  if (network.chainId !== POLYGON_MAINNET_CHAIN_ID) {
    throw new Error(
      `Wrong network. Expected Polygon mainnet chain ID 137, received ${network.chainId}.`
    );
  }

  const [deployer] = await hre.ethers.getSigners();

  if (!deployer) {
    throw new Error("No deployment signer is configured.");
  }

  const deployerAddress = await deployer.getAddress();
  const deployerBalance =
    await hre.ethers.provider.getBalance(deployerAddress);

  const tokenAddress = requireAddress("WTC_TOKEN_ADDRESS");
  const treasuryAddress = requireAddress("TREASURY_WALLET");

  console.log("Network:", hre.network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Deployer:", deployerAddress);
  console.log(
    "Deployer POL balance:",
    hre.ethers.formatEther(deployerBalance)
  );
  console.log("Existing WTC token:", tokenAddress);
  console.log("Treasury:", treasuryAddress);

  if (deployerBalance === 0n) {
    throw new Error(
      "The deployment wallet has no POL available for mainnet gas."
    );
  }

  const tokenCode =
    await hre.ethers.provider.getCode(tokenAddress);

  if (tokenCode === "0x") {
    throw new Error(
      `No smart contract exists at WTC_TOKEN_ADDRESS ${tokenAddress} on Polygon mainnet.`
    );
  }

  console.log("\nDeploying WealthCoinGenesis...");
  console.log("The sale will remain CLOSED and PAUSED.");

  const Genesis =
    await hre.ethers.getContractFactory("WealthCoinGenesis");

  const genesis = await Genesis.deploy(
    tokenAddress,
    treasuryAddress,
    deployerAddress
  );

  const deploymentTransaction =
    genesis.deploymentTransaction();

  console.log(
    "Deployment transaction:",
    deploymentTransaction?.hash || "Unavailable"
  );

  await genesis.waitForDeployment();

  const genesisAddress = await genesis.getAddress();

  console.log(
    "WealthCoinGenesis deployed:",
    genesisAddress
  );

  console.log("\n=== On-Chain Configuration Check ===");

  const [
    owner,
    treasury,
    wealthCoin,
    rate,
    minimum,
    maximum,
    allocation,
    saleOpen,
    paused,
    finalized,
  ] = await Promise.all([
    genesis.owner(),
    genesis.treasury(),
    genesis.wealthCoin(),
    genesis.WTC_PER_POL(),
    genesis.MIN_PURCHASE(),
    genesis.MAX_PURCHASE_PER_WALLET(),
    genesis.genesisAllocation(),
    genesis.saleOpen(),
    genesis.paused(),
    genesis.saleFinalized(),
  ]);

  console.log("Owner:", owner);
  console.log("Treasury:", treasury);
  console.log("WTC token:", wealthCoin);
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
    "Genesis allocation:",
    hre.ethers.formatUnits(allocation, 18),
    "WTC"
  );
  console.log("Sale open:", saleOpen);
  console.log("Paused:", paused);
  console.log("Finalized:", finalized);

  if (owner !== deployerAddress) {
    throw new Error("Owner verification failed.");
  }

  if (treasury !== treasuryAddress) {
    throw new Error("Treasury verification failed.");
  }

  if (wealthCoin !== tokenAddress) {
    throw new Error("WTC token verification failed.");
  }

  if (saleOpen !== false || paused !== true) {
    throw new Error(
      "Unsafe deployment state: Genesis must begin closed and paused."
    );
  }

  console.log("\n=== Deployment Complete ===");
  console.log("Polygon Genesis:", genesisAddress);
  console.log("WTC token:", tokenAddress);
  console.log("Treasury:", treasuryAddress);
  console.log("Owner:", owner);
  console.log("Sale opened:", saleOpen);
  console.log("Paused:", paused);

  console.log("\nSave this public address:");
  console.log(
    `POLYGON_GENESIS_ADDRESS=${genesisAddress}`
  );

  console.log("\nDo not open the sale yet.");
  console.log(
    "Next: verify the source and confirm every setting before transferring real WTC."
  );
}

main().catch((error) => {
  console.error("\nDeployment failed:");
  console.error(error);
  process.exitCode = 1;
});