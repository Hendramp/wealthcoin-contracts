const hre = require("hardhat");
require("dotenv").config();

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)"
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const tokenAddress = process.env.WTC_TOKEN_ADDRESS;
  const presaleAddress = process.env.PRESALE_ADDRESS;

  if (!tokenAddress || !presaleAddress) {
    throw new Error("Missing WTC_TOKEN_ADDRESS or PRESALE_ADDRESS in .env");
  }

  const token = new hre.ethers.Contract(tokenAddress, ERC20_ABI, deployer);
  const amount = hre.ethers.parseUnits("21000000", 18);

  console.log("Funding presale with 21,000,000 WTC...");
  const tx = await token.transfer(presaleAddress, amount);
  await tx.wait();

  console.log("Done. Tx:", tx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
