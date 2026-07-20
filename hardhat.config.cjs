require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const privateKey = process.env.PRIVATE_KEY || "";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    polygon: {
      url: process.env.POLYGON_RPC_URL || "",
      accounts: privateKey ? [privateKey] : []
    },
    polygonAmoy: {
      url: process.env.POLYGON_AMOY_RPC_URL || "",
      accounts: privateKey ? [privateKey] : []
    }
  },
 etherscan: {
  apiKey: {
    polygon: process.env.POLYGONSCAN_API_KEY || "",
    polygonAmoy: process.env.POLYGONSCAN_API_KEY || ""
  }
},
sourcify: {
  enabled: false
}
};
