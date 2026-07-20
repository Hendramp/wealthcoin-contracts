// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MockWTC is ERC20, Ownable {
    constructor(
        address initialOwner
    )
        ERC20("Mock WealthCoin", "mWTC")
        Ownable(initialOwner)
    {
        _mint(
            initialOwner,
            1_000_000_000 ether
        );
    }
}