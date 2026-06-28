# WealthCoin Production Contract Architecture

This package gives WealthCoin a cleaner long-term structure:

- Existing WTC token stays as the official token.
- `WealthCoinPresale.sol` handles staged POL → WTC purchases.
- `WealthCoinStaking.sol` handles staking separately.
- `WealthCoinTreasury.sol` is a basic treasury receiver.
- React dApp should call the presale contract for purchases, not the token contract.

## Presale Rates

- Stage 1: 1 POL = 5,000 WTC
- Stage 2: 1 POL = 4,000 WTC
- Stage 3: 1 POL = 3,000 WTC
- Stage 4: 1 POL = 2,250 WTC
- Stage 5: 1 POL = 1,500 WTC

Presale cap: 21,000,000 WTC.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`.

## Compile

```bash
npm run compile
```

## Deploy to Polygon Amoy testnet first

```bash
npm run deploy:amoy
```

## Deploy to Polygon mainnet

```bash
npm run deploy:polygon
```

## Fund the presale

After deployment, set `PRESALE_ADDRESS` in `.env`, then run:

```bash
npm run fund-presale:polygon
```

## Frontend

Copy the logic from `frontend-snippets/presaleIntegration.js` into your React dApp.
