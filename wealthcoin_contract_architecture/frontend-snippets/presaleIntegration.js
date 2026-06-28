// Add these constants to your React dApp.
// Keep TOKEN_ADDRESS as the existing official WTC token address.
// Set PRESALE_ADDRESS after deploying WealthCoinPresale.sol.

export const TOKEN_ADDRESS = "0x394b57F4a40ff31530d66f904e1Db2C6516c018F";
export const PRESALE_ADDRESS = "YOUR_DEPLOYED_PRESALE_ADDRESS";

export const PRESALE_ABI = [
  "function buy() external payable",
  "function getCurrentRate() view returns (uint256)",
  "function estimateTokens(uint256 polAmount) view returns (uint256)",
  "function currentStage() view returns (uint256)",
  "function totalSold() view returns (uint256)",
  "function remainingTokens() view returns (uint256)",
  "function PRESALE_CAP() view returns (uint256)"
];

// Example React helpers:
//
// const presale = new ethers.Contract(PRESALE_ADDRESS, PRESALE_ABI, signerOrProvider);
//
// const weiAmount = ethers.parseEther(polAmount || "0");
// const estimated = await presale.estimateTokens(weiAmount);
// setEstimatedWTC(ethers.formatEther(estimated));
//
// const tx = await presale.buy({ value: ethers.parseEther(polAmount) });
// await tx.wait();
