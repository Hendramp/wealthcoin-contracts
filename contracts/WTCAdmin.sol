// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract WTCAdmin is Ownable {
    string public projectStatus;
    string public currentDevelopmentPhase;

    event ProjectStatusUpdated(string status);
    event DevelopmentPhaseUpdated(string phase);

    constructor(address initialOwner) Ownable(initialOwner) {
        projectStatus = "Presale Preparation";
        currentDevelopmentPhase = "Phase 1: Presale Launch";
    }

    function setProjectStatus(string calldata status) external onlyOwner {
        projectStatus = status;
        emit ProjectStatusUpdated(status);
    }

    function setDevelopmentPhase(string calldata phase) external onlyOwner {
        currentDevelopmentPhase = phase;
        emit DevelopmentPhaseUpdated(phase);
    }
}