// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * Basic treasury receiver.
 * For production, consider a Safe multisig instead of this simple contract.
 */
contract WealthCoinTreasury is Ownable {
    event Received(address indexed sender, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function withdraw(address payable recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        require(address(this).balance >= amount, "Insufficient balance");

        (bool sent, ) = recipient.call{value: amount}("");
        require(sent, "Withdraw failed");

        emit Withdrawn(recipient, amount);
    }
}
