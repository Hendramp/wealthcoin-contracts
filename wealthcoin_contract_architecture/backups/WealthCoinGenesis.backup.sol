// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title WealthCoinGenesis
 * @notice Fixed-rate Genesis Early Access contract for WealthCoin.
 *
 * Buyers send native POL and receive WTC immediately in the same transaction.
 *
 * Genesis rules:
 * - Rate: 1 POL = 350 WTC
 * - Minimum: 1 POL per transaction
 * - Maximum: 5,000 POL cumulatively per wallet
 * - Allocation: 21,000,000 WTC
 * - POL is forwarded immediately to the treasury
 * - WTC is delivered immediately to the buyer
 */
contract WealthCoinGenesis is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =============================================================
    //                          CONSTANTS
    // =============================================================

    uint256 public constant WTC_PER_POL = 350;

    // On Polygon, Solidity's "ether" unit represents native POL units.
    uint256 public constant MIN_PURCHASE = 1 ether;

    uint256 public constant MAX_PURCHASE_PER_WALLET = 5_000 ether;

    uint256 public constant GENESIS_ALLOCATION_WTC = 21_000_000;

    // =============================================================
    //                    IMMUTABLE CONFIGURATION
    // =============================================================

    IERC20 public immutable wealthCoin;

    address payable public immutable treasury;

    uint256 public immutable tokenUnit;

    uint256 public immutable genesisAllocation;

    // =============================================================
    //                          SALE STATE
    // =============================================================

    bool public hasOpened;

    bool public saleOpen;

    bool public saleFinalized;

    uint256 public totalPolRaised;

    uint256 public totalWtcSold;

    /**
     * @notice Total successful Genesis purchases.
     * Each completed purchase receives a permanent sequential number.
     */
    uint256 public purchaseCount;

    mapping(address => uint256) public polPurchasedByWallet;

    mapping(address => uint256) public wtcPurchasedByWallet;

    // =============================================================
    //                            EVENTS
    // =============================================================

    event GenesisOpened(uint256 timestamp);

    event GenesisPaused(uint256 timestamp);

    event GenesisResumed(uint256 timestamp);

    event GenesisFinalized(
        uint256 totalPolRaised,
        uint256 totalWtcSold,
        uint256 totalPurchases,
        uint256 timestamp
    );

    event TokensPurchased(
        uint256 indexed purchaseNumber,
        address indexed buyer,
        uint256 polSpent,
        uint256 wtcReceived,
        uint256 cumulativePolSpent,
        uint256 timestamp
    );

    event UnsoldTokensRecovered(
        address indexed recipient,
        uint256 amount
    );

    event ForeignTokenRecovered(
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    // =============================================================
    //                         CUSTOM ERRORS
    // =============================================================

    error ZeroAddress();

    error UnsupportedTokenDecimals(uint8 decimals);

    error SaleNotOpen();

    error SaleAlreadyOpened();

    error SaleAlreadyFinalized();

    error SaleNotFinalized();

    error BelowMinimumPurchase(
        uint256 sent,
        uint256 minimum
    );

    error WalletCapExceeded(
        uint256 attemptedTotal,
        uint256 maximum
    );

    error AllocationExceeded(
        uint256 requested,
        uint256 remaining
    );

    error InsufficientGenesisFunding(
        uint256 balance,
        uint256 required
    );

    error TreasuryTransferFailed();

    error NoTokensToRecover();

    error CannotRecoverWealthCoinAsForeignToken();

    error DirectPaymentsDisabled();

    // =============================================================
    //                          CONSTRUCTOR
    // =============================================================

    /**
     * @param tokenAddress Deployed WTC token contract address.
     * @param treasuryAddress Wallet receiving all POL.
     * @param initialOwner Wallet controlling administrative functions.
     */
    constructor(
        address tokenAddress,
        address payable treasuryAddress,
        address initialOwner
    ) Ownable(initialOwner) {
        if (
            tokenAddress == address(0) ||
            treasuryAddress == address(0) ||
            initialOwner == address(0)
        ) {
            revert ZeroAddress();
        }

        uint8 tokenDecimals =
            IERC20Metadata(tokenAddress).decimals();

        if (tokenDecimals > 18) {
            revert UnsupportedTokenDecimals(tokenDecimals);
        }

        wealthCoin = IERC20(tokenAddress);
        treasury = treasuryAddress;

        tokenUnit = 10 ** uint256(tokenDecimals);

        genesisAllocation =
            GENESIS_ALLOCATION_WTC * tokenUnit;

        // Genesis begins closed and paused.
        _pause();
    }

    // =============================================================
    //                       PURCHASE FUNCTION
    // =============================================================

    /**
     * @notice Purchases WTC using native POL.
     * @dev WTC is delivered and POL is forwarded in one transaction.
     */
    function buyTokens()
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (!saleOpen || saleFinalized) {
            revert SaleNotOpen();
        }

        if (msg.value < MIN_PURCHASE) {
            revert BelowMinimumPurchase(
                msg.value,
                MIN_PURCHASE
            );
        }

        uint256 newWalletTotal =
            polPurchasedByWallet[msg.sender] + msg.value;

        if (
            newWalletTotal >
            MAX_PURCHASE_PER_WALLET
        ) {
            revert WalletCapExceeded(
                newWalletTotal,
                MAX_PURCHASE_PER_WALLET
            );
        }

        uint256 tokenAmount =
            calculateTokenAmount(msg.value);

        uint256 remaining =
            remainingAllocation();

        if (tokenAmount > remaining) {
            revert AllocationExceeded(
                tokenAmount,
                remaining
            );
        }

        uint256 availableTokenBalance =
            wealthCoin.balanceOf(address(this));

        if (availableTokenBalance < tokenAmount) {
            revert InsufficientGenesisFunding(
                availableTokenBalance,
                tokenAmount
            );
        }

        // Update contract state before external calls.
        polPurchasedByWallet[msg.sender] =
            newWalletTotal;

        wtcPurchasedByWallet[msg.sender] +=
            tokenAmount;

        totalPolRaised += msg.value;
        totalWtcSold += tokenAmount;

        // Give this purchase its permanent Genesis number.
        purchaseCount += 1;

        // Deliver WTC directly to the buyer.
        wealthCoin.safeTransfer(
            msg.sender,
            tokenAmount
        );

        // Forward POL directly to the treasury.
        (bool sent, ) = treasury.call{
            value: msg.value
        }("");

        if (!sent) {
            revert TreasuryTransferFailed();
        }

        emit TokensPurchased(
            purchaseCount,
            msg.sender,
            msg.value,
            tokenAmount,
            newWalletTotal,
            block.timestamp
        );
    }

    // =============================================================
    //                       ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Opens Genesis for the first time.
     * @dev The contract must contain the full remaining WTC allocation.
     */
    function openGenesis()
        external
        onlyOwner
        whenPaused
    {
        if (saleFinalized) {
            revert SaleAlreadyFinalized();
        }

        if (hasOpened) {
            revert SaleAlreadyOpened();
        }

        _requireFullFunding();

        hasOpened = true;
        saleOpen = true;

        _unpause();

        emit GenesisOpened(block.timestamp);
    }

    /**
     * @notice Temporarily pauses Genesis purchases.
     */
    function pauseGenesis()
        external
        onlyOwner
        whenNotPaused
    {
        saleOpen = false;

        _pause();

        emit GenesisPaused(block.timestamp);
    }

    /**
     * @notice Resumes purchases after a temporary pause.
     */
    function resumeGenesis()
        external
        onlyOwner
        whenPaused
    {
        if (saleFinalized) {
            revert SaleAlreadyFinalized();
        }

        _requireFullFunding();

        saleOpen = true;

        _unpause();

        emit GenesisResumed(block.timestamp);
    }

    /**
     * @notice Permanently closes the Genesis sale.
     */
    function finalizeGenesis()
        external
        onlyOwner
    {
        if (saleFinalized) {
            revert SaleAlreadyFinalized();
        }

        saleOpen = false;
        saleFinalized = true;

        if (!paused()) {
            _pause();
        }

        emit GenesisFinalized(
            totalPolRaised,
            totalWtcSold,
            purchaseCount,
            block.timestamp
        );
    }

    /**
     * @notice Recovers remaining WTC after permanent finalization.
     */
    function recoverUnsoldTokens(
        address recipient
    )
        external
        onlyOwner
        nonReentrant
    {
        if (!saleFinalized) {
            revert SaleNotFinalized();
        }

        if (recipient == address(0)) {
            revert ZeroAddress();
        }

        uint256 balance =
            wealthCoin.balanceOf(address(this));

        if (balance == 0) {
            revert NoTokensToRecover();
        }

        wealthCoin.safeTransfer(
            recipient,
            balance
        );

        emit UnsoldTokensRecovered(
            recipient,
            balance
        );
    }

    /**
     * @notice Recovers an unrelated ERC-20 sent accidentally.
     * @dev WTC cannot be recovered through this function.
     */
    function recoverForeignToken(
        address tokenAddress,
        address recipient
    )
        external
        onlyOwner
        nonReentrant
    {
        if (
            tokenAddress == address(0) ||
            recipient == address(0)
        ) {
            revert ZeroAddress();
        }

        if (tokenAddress == address(wealthCoin)) {
            revert CannotRecoverWealthCoinAsForeignToken();
        }

        IERC20 foreignToken =
            IERC20(tokenAddress);

        uint256 balance =
            foreignToken.balanceOf(address(this));

        if (balance == 0) {
            revert NoTokensToRecover();
        }

        foreignToken.safeTransfer(
            recipient,
            balance
        );

        emit ForeignTokenRecovered(
            tokenAddress,
            recipient,
            balance
        );
    }

    // =============================================================
    //                         VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Calculates WTC for a specified POL amount.
     */
    function calculateTokenAmount(
        uint256 polAmount
    )
        public
        view
        returns (uint256)
    {
        return (
            polAmount *
            WTC_PER_POL *
            tokenUnit
        ) / 1 ether;
    }

    /**
     * @notice Returns WTC remaining in the Genesis allocation.
     */
    function remainingAllocation()
        public
        view
        returns (uint256)
    {
        return
            genesisAllocation -
            totalWtcSold;
    }

    /**
     * @notice Returns the remaining POL allowance for a wallet.
     */
    function remainingWalletAllowance(
        address buyer
    )
        external
        view
        returns (uint256)
    {
        uint256 purchased =
            polPurchasedByWallet[buyer];

        if (
            purchased >=
            MAX_PURCHASE_PER_WALLET
        ) {
            return 0;
        }

        return
            MAX_PURCHASE_PER_WALLET -
            purchased;
    }

    /**
     * @notice Returns whether the contract currently holds enough WTC
     * to complete all remaining Genesis sales.
     */
    function isFullyFunded()
        external
        view
        returns (bool)
    {
        return
            wealthCoin.balanceOf(address(this)) >=
            remainingAllocation();
    }

    /**
     * @notice Returns the current WTC balance held by Genesis.
     */
    function contractWtcBalance()
        external
        view
        returns (uint256)
    {
        return
            wealthCoin.balanceOf(address(this));
    }

    // =============================================================
    //                       INTERNAL FUNCTIONS
    // =============================================================

    function _requireFullFunding()
        internal
        view
    {
        uint256 requiredBalance =
            remainingAllocation();

        uint256 currentBalance =
            wealthCoin.balanceOf(address(this));

        if (currentBalance < requiredBalance) {
            revert InsufficientGenesisFunding(
                currentBalance,
                requiredBalance
            );
        }
    }

    // =============================================================
    //                    DIRECT PAYMENT PROTECTION
    // =============================================================

    /**
     * @dev Buyers must call buyTokens().
     * Direct POL transfers are rejected.
     */
    receive() external payable {
        revert DirectPaymentsDisabled();
    }

    fallback() external payable {
        revert DirectPaymentsDisabled();
    }
}