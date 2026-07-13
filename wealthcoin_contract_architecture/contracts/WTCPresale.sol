// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract WTCPresale is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable wtc;
    address payable public treasury;

    uint256 public immutable startTime;
    uint256 public constant PRESALE_CAP = 21_000_000 ether;

    uint256 public totalSold;
    uint256 public totalRaised;
    bool public paused;

    uint256[5] public stageCaps = [
        4_200_000 ether,
        8_400_000 ether,
        12_600_000 ether,
        16_800_000 ether,
        21_000_000 ether
    ];

    uint256[5] public rates = [
        5_000 ether,
        4_000 ether,
        3_000 ether,
        2_250 ether,
        1_500 ether
    ];

    event TokensPurchased(
        address indexed buyer,
        uint256 polAmount,
        uint256 wtcAmount,
        uint256 stage
    );

    event TreasuryUpdated(address indexed newTreasury);
    event PausedUpdated(bool paused);

    constructor(
        address _wtc,
        address payable _treasury,
        uint256 _startTime,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_wtc != address(0), "Invalid WTC token");
        require(_treasury != address(0), "Invalid treasury");
        require(_startTime > block.timestamp, "Start must be future");

        wtc = IERC20(_wtc);
        treasury = _treasury;
        startTime = _startTime;
    }

    function hasStarted() public view returns (bool) {
        return block.timestamp >= startTime;
    }

    function currentStage() public view returns (uint256) {
        if (totalSold < stageCaps[0]) return 0;
        if (totalSold < stageCaps[1]) return 1;
        if (totalSold < stageCaps[2]) return 2;
        if (totalSold < stageCaps[3]) return 3;
        return 4;
    }

    function getCurrentRate() public view returns (uint256) {
        return rates[currentStage()];
    }

    function estimateTokens(uint256 polAmount) public view returns (uint256) {
        return (polAmount * getCurrentRate()) / 1 ether;
    }

    function remainingTokens() public view returns (uint256) {
        return PRESALE_CAP - totalSold;
    }

    function currentStageRemaining() public view returns (uint256) {
        uint256 stage = currentStage();
        return stageCaps[stage] - totalSold;
    }

    function buy() external payable nonReentrant {
        require(!paused, "Presale paused");
        require(hasStarted(), "Presale not started");
        require(msg.value > 0, "Send POL");
        require(totalSold < PRESALE_CAP, "Presale sold out");

        uint256 tokensOut = estimateTokens(msg.value);

        require(tokensOut > 0, "Amount too small");
        require(totalSold + tokensOut <= PRESALE_CAP, "Exceeds presale cap");
        require(wtc.balanceOf(address(this)) >= tokensOut, "Insufficient WTC in presale");

        totalSold += tokensOut;
        totalRaised += msg.value;

        wtc.safeTransfer(msg.sender, tokensOut);

        (bool sent, ) = treasury.call{value: msg.value}("");
        require(sent, "Treasury transfer failed");

        emit TokensPurchased(msg.sender, msg.value, tokensOut, currentStage());
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedUpdated(value);
    }

    function setTreasury(address payable newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function recoverUnsoldTokens(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        wtc.safeTransfer(to, amount);
    }
}