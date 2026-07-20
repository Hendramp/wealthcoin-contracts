// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract WTCStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable wtc;

    uint256 public totalStaked;
    uint256 public rewardRatePerSecond;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public lastUpdate;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 newRate);

    constructor(address _wtc, uint256 _rewardRatePerSecond, address initialOwner) Ownable(initialOwner) {
        require(_wtc != address(0), "Invalid WTC token");
        wtc = IERC20(_wtc);
        rewardRatePerSecond = _rewardRatePerSecond;
    }

    function pendingRewards(address user) public view returns (uint256) {
        uint256 balance = stakedBalance[user];
        if (balance == 0) return rewards[user];

        uint256 elapsed = block.timestamp - lastUpdate[user];
        uint256 earned = (balance * rewardRatePerSecond * elapsed) / 1e18;

        return rewards[user] + earned;
    }

    function _updateRewards(address user) internal {
        rewards[user] = pendingRewards(user);
        lastUpdate[user] = block.timestamp;
    }

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount required");

        _updateRewards(msg.sender);

        stakedBalance[msg.sender] += amount;
        totalStaked += amount;

        wtc.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount required");
        require(stakedBalance[msg.sender] >= amount, "Insufficient staked balance");

        _updateRewards(msg.sender);

        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;

        wtc.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount);
    }

    function claimRewards() external nonReentrant {
        _updateRewards(msg.sender);

        uint256 rewardAmount = rewards[msg.sender];
        require(rewardAmount > 0, "No rewards");

        rewards[msg.sender] = 0;

        wtc.safeTransfer(msg.sender, rewardAmount);

        emit RewardsClaimed(msg.sender, rewardAmount);
    }

    function setRewardRate(uint256 newRate) external onlyOwner {
        rewardRatePerSecond = newRate;
        emit RewardRateUpdated(newRate);
    }
}