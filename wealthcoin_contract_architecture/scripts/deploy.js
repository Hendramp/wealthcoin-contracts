const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const WTC_TOKEN = process.env.WTC_TOKEN_ADDRESS;
  const TREASURY_WALLET = process.env.TREASURY_WALLET || deployer.address;
  const START_TIME = Number(process.env.PRESALE_START_TIME || "0");

  if (!WTC_TOKEN) {
    throw new Error("Missing WTC_TOKEN_ADDRESS in .env");
  }

  console.log("Deploying with:", deployer.address);
  console.log("Using WTC token:", WTC_TOKEN);
  console.log("Treasury wallet:", TREASURY_WALLET);

  const Treasury = await hre.ethers.getContractFactory("WealthCoinTreasury");
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();

  const Presale = await hre.ethers.getContractFactory("WealthCoinPresale");
  const presale = await Presale.deploy(
    WTC_TOKEN,
    TREASURY_WALLET,
    START_TIME,
    deployer.address
  );
  await presale.waitForDeployment();

  // Example reward rate: 0.000000003 WTC per staked WTC per second.
  // Tune this before production.
  const rewardRate = hre.ethers.parseUnits("0.000000003", 18);

  const Staking = await hre.ethers.getContractFactory("WealthCoinStaking");
  const staking = await Staking.deploy(WTC_TOKEN, rewardRate, deployer.address);
  await staking.waitForDeployment();

  console.log("\nDeployment complete:");
  console.log("Treasury:", await treasury.getAddress());
  console.log("Presale:", await presale.getAddress());
  console.log("Staking:", await staking.getAddress());
  console.log("\nNext: transfer 21,000,000 WTC to the Presale address.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
