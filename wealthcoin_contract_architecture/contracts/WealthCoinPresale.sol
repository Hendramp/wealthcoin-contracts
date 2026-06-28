// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * Separate staged presale contract for existing WTC token.
 * Buyers send POL/MATIC and receive WTC.
 */
contract WealthCoinPresale is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable wtc;
    address payable public treasury;

    uint256 public constant PRESALE_CAP = 21_000_000 ether;
    uint256 public totalSold;
    uint256 public startTime;
    bool public paused;

    // Durations: stage 1 = 7 days, stages 2-5 = 8 days each.
    uint256[5] public stageEndDays = [7, 15, 23, 31, 39];

    // Rates are WTC per 1 POL/MATIC.
    uint256[5] public rates = [
        5_000 ether,
        4_000 ether,
        3_000 ether,
        2_250 ether,
        1_500 ether
    ];

    event TokensPurchased(address indexed buyer, uint256 polAmount, uint256 wtcAmount, uint256 stage);
    event TreasuryUpdated(address indexed newTreasury);
    event PausedUpdated(bool paused);

    constructor(
        address _wtc,
        address payable _treasury,
        uint256 _startTime,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_wtc != address(0), "Invalid WTC");
        require(_treasury != address(0), "Invalid treasury");

        wtc = IERC20(_wtc);
        treasury = _treasury;
        startTime = _startTime == 0 ? block.timestamp : _startTime;
    }

    function currentStage() public view returns (uint256) {
        require(block.timestamp >= startTime, "Presale not started");

        uint256 elapsedDays = (block.timestamp - startTime) / 1 days;

        if (elapsedDays < stageEndDays[0]) return 0;
        if (elapsedDays < stageEndDays[1]) return 1;
        if (elapsedDays < stageEndDays[2]) return 2;
        if (elapsedDays < stageEndDays[3]) return 3;
        return 4;
    }

    function getCurrentRate() public view returns (uint256) {
        return rates[currentStage()];
    }

    function estimateTokens(uint256 polAmount) public view returns (uint256) {
        return (polAmount * getCurrentRate()) / 1 ether;
    }

    function remainingTokens() external view returns (uint256) {
        return PRESALE_CAP - totalSold;
    }

    function buy() external payable nonReentrant {
        require(!paused, "Presale paused");
        require(msg.value > 0, "Send POL");

        uint256 stage = currentStage();
        uint256 tokensOut = (msg.value * rates[stage]) / 1 ether;

        require(totalSold + tokensOut <= PRESALE_CAP, "Presale cap reached");
        require(wtc.balanceOf(address(this)) >= tokensOut, "Insufficient WTC in presale");

        totalSold += tokensOut;

        wtc.safeTransfer(msg.sender, tokensOut);

        (bool sent, ) = treasury.call{value: msg.value}("");
        require(sent, "Treasury transfer failed");

        emit TokensPurchased(msg.sender, msg.value, tokensOut, stage);
    }

    function setTreasury(address payable newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedUpdated(value);
    }

    function recoverUnsoldTokens(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        wtc.safeTransfer(to, amount);
    }
}
