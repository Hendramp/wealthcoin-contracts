// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract WTCTreasury is Ownable {
    event Received(address indexed sender, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function withdrawPOL(address payable recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        require(address(this).balance >= amount, "Insufficient balance");

        (bool sent, ) = recipient.call{value: amount}("");
        require(sent, "Withdraw failed");

        emit Withdrawn(recipient, amount);
    }

    function treasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }
}