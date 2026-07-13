const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const WTC_TOKEN = process.env.WTC_TOKEN_ADDRESS;
  const TREASURY_WALLET = process.env.TREASURY_WALLET;
  const START_TIME = Number(process.env.PRESALE_START_TIME || "0");

  if (!WTC_TOKEN) throw new Error("Missing WTC_TOKEN_ADDRESS in .env");
  if (!TREASURY_WALLET) throw new Error("Missing TREASURY_WALLET in .env");
  if (!START_TIME) throw new Error("Missing PRESALE_START_TIME in .env");

  console.log("Deploying WealthCoin v2 contracts...");
  console.log("Deployer:", deployer.address);
  console.log("WTC Token:", WTC_TOKEN);
  console.log("Treasury Wallet:", TREASURY_WALLET);
  console.log("Presale Start Time:", START_TIME);

  const Treasury = await hre.ethers.getContractFactory("WTCTreasury");
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();

  const treasuryAddress = await treasury.getAddress();

  const Presale = await hre.ethers.getContractFactory("WTCPresale");
  const presale = await Presale.deploy(
    WTC_TOKEN,
    payableAddress(TREASURY_WALLET),
    START_TIME,
    deployer.address
  );
  await presale.waitForDeployment();

  const presaleAddress = await presale.getAddress();

  const rewardRate = hre.ethers.parseUnits("0.000000003", 18);

  const Staking = await hre.ethers.getContractFactory("WTCStaking");
  const staking = await Staking.deploy(WTC_TOKEN, rewardRate, deployer.address);
  await staking.waitForDeployment();

  const stakingAddress = await staking.getAddress();

  const Admin = await hre.ethers.getContractFactory("WTCAdmin");
  const admin = await Admin.deploy(deployer.address);
  await admin.waitForDeployment();

  const adminAddress = await admin.getAddress();

  console.log("\nDeployment complete:");
  console.log("WTCTreasury:", treasuryAddress);
  console.log("WTCPresale:", presaleAddress);
  console.log("WTCStaking:", stakingAddress);
  console.log("WTCAdmin:", adminAddress);

  console.log("\nNext steps:");
  console.log("1. Add these addresses to .env");
  console.log("2. Transfer 21,000,000 WTC to the WTCPresale contract");
  console.log("3. Add these addresses to your Vercel environment variables");
}

function payableAddress(address) {
  if (!hre.ethers.isAddress(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  return address;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
