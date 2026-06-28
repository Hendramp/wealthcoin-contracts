// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * WealthCoin ERC-20 token.
 * Use this only if you need to deploy a NEW WTC token.
 * If your existing token is already live, keep using the existing token address instead.
 */
contract WealthCoin is ERC20, Ownable {
    constructor(address initialOwner) ERC20("WealthCoin", "WTC") Ownable(initialOwner) {
        _mint(initialOwner, 1_000_000_000 ether);
    }
}
