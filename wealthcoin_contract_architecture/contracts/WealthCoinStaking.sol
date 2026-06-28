// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * Simple separate staking contract.
 * Owner must fund this contract with reward WTC before users claim rewards.
 */
contract WealthCoinStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable wtc;

    uint256 public rewardRatePerSecond; // reward tokens per staked token per second, scaled by 1e18
    uint256 public totalStaked;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public rewardDebt;
    mapping(address => uint256) public lastUpdate;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 newRate);

    constructor(address _wtc, uint256 _rewardRatePerSecond, address initialOwner) Ownable(initialOwner) {
        require(_wtc != address(0), "Invalid WTC");
        wtc = IERC20(_wtc);
        rewardRatePerSecond = _rewardRatePerSecond;
    }

    function pendingRewards(address user) public view returns (uint256) {
        uint256 staked = stakedBalance[user];
        if (staked == 0) return rewardDebt[user];

        uint256 elapsed = block.timestamp - lastUpdate[user];
        uint256 earned = (staked * rewardRatePerSecond * elapsed) / 1e18;
        return rewardDebt[user] + earned;
    }

    function _update(address user) internal {
        rewardDebt[user] = pendingRewards(user);
        lastUpdate[user] = block.timestamp;
    }

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount required");
        _update(msg.sender);

        stakedBalance[msg.sender] += amount;
        totalStaked += amount;

        wtc.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount required");
        require(stakedBalance[msg.sender] >= amount, "Not enough staked");
        _update(msg.sender);

        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;

        wtc.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function claimRewards() external nonReentrant {
        _update(msg.sender);

        uint256 rewards = rewardDebt[msg.sender];
        require(rewards > 0, "No rewards");

        rewardDebt[msg.sender] = 0;
        wtc.safeTransfer(msg.sender, rewards);

        emit RewardsClaimed(msg.sender, rewards);
    }

    function setRewardRate(uint256 newRate) external onlyOwner {
        rewardRatePerSecond = newRate;
        emit RewardRateUpdated(newRate);
    }
}
