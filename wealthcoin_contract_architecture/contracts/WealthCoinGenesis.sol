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
 * @notice Ten-stage Genesis Early Access sale for WealthCoin.
 *
 * Core rules:
 * - Fixed Genesis allocation of 21,000,000 WTC.
 * - Ten stages containing 2,100,000 WTC each.
 * - Each stage lasts seven days or ends when sold out.
 * - Unsold stage tokens never roll into the following stage.
 * - Unsold tokens remain reserved for the public allocation.
 * - Stage rates are supplied during deployment based on POL spot price.
 * - Buyers receive WTC immediately.
 * - Accepted POL is forwarded immediately to the treasury.
 *
 * Important:
 * A blockchain contract cannot wake itself up without a transaction.
 * buyTokens() and syncStages() both advance expired stages automatically.
 */
contract WealthCoinGenesis is
    Ownable,
    Pausable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    // =============================================================
    //                         CONSTANTS
    // =============================================================

    uint256 public constant STAGE_COUNT = 10;
    uint256 public constant STAGE_DURATION = 7 days;

    /// @notice Total Genesis allocation in full WTC.
    uint256 public constant GENESIS_ALLOCATION_WTC = 21_000_000;

    /// @notice Allocation of each stage in full WTC.
    uint256 public constant STAGE_ALLOCATION_WTC = 2_100_000;

    // =============================================================
    //                     IMMUTABLE CONFIGURATION
    // =============================================================

    /// @notice WealthCoin ERC-20 token.
    IERC20 public immutable wealthCoin;

    /// @notice Wallet receiving accepted POL.
    address payable public immutable treasury;

    /// @notice Wallet receiving unsold Genesis WTC after finalization.
    address public immutable publicReserve;

    /// @notice WTC base unit derived from token decimals.
    uint256 public immutable tokenUnit;

    /// @notice Genesis allocation expressed in token base units.
    uint256 public immutable genesisAllocation;

    /// @notice Per-stage allocation expressed in token base units.
    uint256 public immutable stageAllocation;

    /// @notice Minimum POL sent in a purchase transaction.
    uint256 public immutable minPurchase;

    /// @notice Maximum cumulative accepted POL per wallet.
    uint256 public immutable maxPurchasePerWallet;

    // =============================================================
    //                          STAGE STATE
    // =============================================================

    /**
     * @notice WTC base units received for exactly 1 POL.
     *
     * Example for an 18-decimal WTC token:
     * 38 WTC/POL is stored as 38 * 1e18.
     *
     * This allows fractional rates such as 37.5 WTC/POL.
     */
    uint256[STAGE_COUNT] public stageRates;

    /// @notice WTC sold from each stage in token base units.
    uint256[STAGE_COUNT] public stageWtcSold;

    /// @notice Unsold WTC assigned back to public allocation by stage.
    uint256[STAGE_COUNT] public stageUnsoldWtc;

    /// @notice True after a stage has permanently closed.
    bool[STAGE_COUNT] public stageClosed;

    /// @notice Current stage index, from 0 through 9.
    uint256 public currentStage;

    /// @notice Starting timestamp of the current stage.
    uint256 public currentStageStart;

    /// @notice Timestamp recorded when an emergency pause begins.
    uint256 public pausedAt;

    // =============================================================
    //                          SALE STATE
    // =============================================================

    bool public hasOpened;
    bool public saleOpen;
    bool public saleFinalized;

    uint256 public totalPolRaised;
    uint256 public totalWtcSold;

    /// @notice Unsold WTC permanently removed from Genesis availability.
    uint256 public totalWtcReturnedToPublicAllocation;

    mapping(address => uint256) public polPurchasedByWallet;
    mapping(address => uint256) public wtcPurchasedByWallet;

    // =============================================================
    //                         ENUMS
    // =============================================================

    enum StageCloseReason {
        SoldOut,
        TimeExpired,
        OwnerFinalization
    }

    // =============================================================
    //                            EVENTS
    // =============================================================

    event GenesisOpened(
        uint256 indexed stage,
        uint256 stageRate,
        uint256 timestamp
    );

    event GenesisPaused(uint256 timestamp);

    event GenesisResumed(
        uint256 indexed stage,
        uint256 newStageEnd,
        uint256 timestamp
    );

    event StageClosed(
        uint256 indexed stage,
        uint256 wtcSold,
        uint256 unsoldWtc,
        StageCloseReason reason,
        uint256 timestamp
    );

    event StageAdvanced(
        uint256 indexed previousStage,
        uint256 indexed newStage,
        uint256 newRate,
        uint256 newStageStart,
        uint256 newStageEnd
    );

    event GenesisFinalized(
        uint256 totalPolRaised,
        uint256 totalWtcSold,
        uint256 returnedToPublicAllocation,
        uint256 timestamp
    );

    event TokensPurchased(
        address indexed buyer,
        uint256 indexed stage,
        uint256 stageRate,
        uint256 polSpent,
        uint256 wtcReceived,
        uint256 cumulativePolSpent,
        uint256 timestamp
    );

    event ExcessPolRefunded(
        address indexed buyer,
        uint256 amount
    );

    event UnsoldTokensReturnedToPublicReserve(
        address indexed publicReserve,
        uint256 amount
    );

    event ForeignTokenRecovered(
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    // =============================================================
    //                            ERRORS
    // =============================================================

    error ZeroAddress();
    error UnsupportedTokenDecimals(uint8 decimals);
    error InvalidStageRate(uint256 stage);
    error StageRatesMustDecrease(uint256 stage);
    error InvalidPurchaseLimits();
    error SaleNotOpen();
    error SaleAlreadyOpen();
    error SaleAlreadyOpened();
    error SaleAlreadyFinalized();
    error SaleNotFinalized();
    error BelowMinimumPurchase(uint256 sent, uint256 minimum);
    error WalletCapExceeded(uint256 attemptedTotal, uint256 maximum);
    error InsufficientGenesisFunding(uint256 balance, uint256 required);
    error TreasuryTransferFailed();
    error RefundTransferFailed();
    error NoTokensToRecover();
    error CannotRecoverWealthCoinAsForeignToken();
    error DirectPaymentsDisabled();
    error NothingAvailableForPurchase();
    error InvalidStage(uint256 stage);

    // =============================================================
    //                          CONSTRUCTOR
    // =============================================================

    /**
     * @param tokenAddress Deployed WTC token contract.
     * @param treasuryAddress Wallet receiving POL.
     * @param publicReserveAddress Wallet receiving unsold Genesis WTC.
     * @param initialOwner Address controlling emergency functions.
     * @param rates WTC base units received per 1 POL for all ten stages.
     * @param minimumPurchase Minimum POL required in msg.value.
     * @param walletMaximum Maximum cumulative accepted POL per wallet.
     */
    constructor(
        address tokenAddress,
        address payable treasuryAddress,
        address publicReserveAddress,
        address initialOwner,
        uint256[STAGE_COUNT] memory rates,
        uint256 minimumPurchase,
        uint256 walletMaximum
    ) Ownable(initialOwner) {
        if (
            tokenAddress == address(0) ||
            treasuryAddress == address(0) ||
            publicReserveAddress == address(0) ||
            initialOwner == address(0)
        ) {
            revert ZeroAddress();
        }

        if (
            minimumPurchase == 0 ||
            walletMaximum < minimumPurchase
        ) {
            revert InvalidPurchaseLimits();
        }

        uint8 decimals = IERC20Metadata(tokenAddress).decimals();

        if (decimals > 18) {
            revert UnsupportedTokenDecimals(decimals);
        }

        for (uint256 i = 0; i < STAGE_COUNT; i++) {
            if (rates[i] == 0) {
                revert InvalidStageRate(i);
            }

            // Fewer WTC per POL means WTC becomes more expensive.
            if (i > 0 && rates[i] >= rates[i - 1]) {
                revert StageRatesMustDecrease(i);
            }

            stageRates[i] = rates[i];
        }

        wealthCoin = IERC20(tokenAddress);
        treasury = treasuryAddress;
        publicReserve = publicReserveAddress;

        tokenUnit = 10 ** uint256(decimals);
        genesisAllocation =
            GENESIS_ALLOCATION_WTC * tokenUnit;
        stageAllocation =
            STAGE_ALLOCATION_WTC * tokenUnit;

                minPurchase = minimumPurchase;
        maxPurchasePerWallet = walletMaximum;

        // Genesis deploys closed and paused.
        _pause();
    }

    // =============================================================
    //                       PURCHASE FUNCTION
    // =============================================================

    /**
     * @notice Purchase WTC using native POL.
     *
     * If msg.value is larger than the POL required to finish the current
     * stage, only the required amount is accepted and the excess is refunded.
     * The purchase does not cross into the next stage.
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

        if (msg.value < minPurchase) {
            revert BelowMinimumPurchase(
                msg.value,
                minPurchase
            );
        }

        _syncStages();

        if (!saleOpen || saleFinalized) {
            revert SaleNotOpen();
        }

        uint256 walletRemaining =
            remainingWalletAllowance(msg.sender);

        if (msg.value > walletRemaining) {
            revert WalletCapExceeded(
                polPurchasedByWallet[msg.sender] + msg.value,
                maxPurchasePerWallet
            );
        }

        uint256 stageRemaining =
            remainingCurrentStageAllocation();

        if (stageRemaining == 0) {
            revert NothingAvailableForPurchase();
        }

        uint256 rate = stageRates[currentStage];

        uint256 requestedWtc =
            (msg.value * rate) / 1 ether;

        uint256 acceptedPol;
        uint256 tokenAmount;
        uint256 refundAmount;

        if (requestedWtc <= stageRemaining) {
            acceptedPol = msg.value;
            tokenAmount = requestedWtc;
        } else {
            tokenAmount = stageRemaining;

            acceptedPol = _ceilDiv(
                stageRemaining * 1 ether,
                rate
            );

            refundAmount = msg.value - acceptedPol;
        }

        if (tokenAmount == 0 || acceptedPol == 0) {
            revert NothingAvailableForPurchase();
        }

        uint256 contractBalance =
            wealthCoin.balanceOf(address(this));

        if (contractBalance < tokenAmount) {
            revert InsufficientGenesisFunding(
                contractBalance,
                tokenAmount
            );
        }

        uint256 newWalletTotal =
            polPurchasedByWallet[msg.sender] + acceptedPol;

        if (newWalletTotal > maxPurchasePerWallet) {
            revert WalletCapExceeded(
                newWalletTotal,
                maxPurchasePerWallet
            );
        }

        uint256 purchaseStage = currentStage;

        // Effects.
        polPurchasedByWallet[msg.sender] =
            newWalletTotal;

        wtcPurchasedByWallet[msg.sender] +=
            tokenAmount;

        stageWtcSold[purchaseStage] +=
            tokenAmount;

        totalPolRaised += acceptedPol;
        totalWtcSold += tokenAmount;

        // Interactions.
        wealthCoin.safeTransfer(
            msg.sender,
            tokenAmount
        );

        (bool treasurySent, ) =
            treasury.call{value: acceptedPol}("");

        if (!treasurySent) {
            revert TreasuryTransferFailed();
        }

        if (refundAmount > 0) {
            (bool refundSent, ) =
                payable(msg.sender).call{
                    value: refundAmount
                }("");

            if (!refundSent) {
                revert RefundTransferFailed();
            }

            emit ExcessPolRefunded(
                msg.sender,
                refundAmount
            );
        }

        emit TokensPurchased(
            msg.sender,
            purchaseStage,
            rate,
            acceptedPol,
            tokenAmount,
            newWalletTotal,
            block.timestamp
        );

        // Advance immediately when this purchase sells out the stage.
        if (
            stageWtcSold[purchaseStage] >=
            stageAllocation
        ) {
            _closeAndAdvance(
                StageCloseReason.SoldOut,
                block.timestamp
            );
        }
    }

    // =============================================================
    //                     AUTOMATIC STAGE LOGIC
    // =============================================================

    /**
     * @notice Publicly advances any stages whose seven-day windows expired.
     *
     * Anyone may call this function. No owner wallet is required.
     */
    function syncStages()
        external
        whenNotPaused
    {
        if (!saleOpen || saleFinalized) {
            revert SaleNotOpen();
        }

        _syncStages();
    }

    function _syncStages() internal {
        while (
            saleOpen &&
            !saleFinalized &&
            block.timestamp >= currentStageEnd()
        ) {
            uint256 nextStart =
                currentStageEnd();

            _closeAndAdvance(
                StageCloseReason.TimeExpired,
                nextStart
            );
        }
    }

    function _closeAndAdvance(
        StageCloseReason reason,
        uint256 nextStageStart
    ) internal {
        uint256 closingStage = currentStage;

        if (!stageClosed[closingStage]) {
            uint256 unsold =
                stageAllocation -
                stageWtcSold[closingStage];

            stageClosed[closingStage] = true;
            stageUnsoldWtc[closingStage] = unsold;

            totalWtcReturnedToPublicAllocation +=
                unsold;

            emit StageClosed(
                closingStage,
                stageWtcSold[closingStage],
                unsold,
                reason,
                block.timestamp
            );
        }

        if (closingStage == STAGE_COUNT - 1) {
            _finalizeGenesis();
            return;
        }

        currentStage = closingStage + 1;
        currentStageStart = nextStageStart;

        emit StageAdvanced(
            closingStage,
            currentStage,
            stageRates[currentStage],
            currentStageStart,
            currentStageEnd()
        );
    }

    // =============================================================
    //                         ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Opens Genesis after confirming all 21M WTC are funded.
     */
    function openGenesis() external onlyOwner {
        if (saleFinalized) {
            revert SaleAlreadyFinalized();
        }

        if (hasOpened) {
            revert SaleAlreadyOpened();
        }

        if (saleOpen) {
            revert SaleAlreadyOpen();
        }

        uint256 currentBalance =
            wealthCoin.balanceOf(address(this));

        if (currentBalance < genesisAllocation) {
            revert InsufficientGenesisFunding(
                currentBalance,
                genesisAllocation
            );
        }

        hasOpened = true;
        saleOpen = true;
        currentStage = 0;
        currentStageStart = block.timestamp;

        if (paused()) {
            _unpause();
        }

        emit GenesisOpened(
            currentStage,
            stageRates[currentStage],
            block.timestamp
        );
    }

    /**
     * @notice Temporarily stops purchases and freezes the stage timer.
     */
    function pauseGenesis() external onlyOwner {
        if (!saleOpen || saleFinalized) {
            revert SaleNotOpen();
        }

        saleOpen = false;
        pausedAt = block.timestamp;
        _pause();

        emit GenesisPaused(block.timestamp);
    }

    /**
     * @notice Resumes purchases and preserves remaining stage time.
     */
    function resumeGenesis() external onlyOwner {
        if (saleFinalized) {
            revert SaleAlreadyFinalized();
        }

        if (!hasOpened) {
            revert SaleNotOpen();
        }

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

        if (pausedAt > 0) {
            currentStageStart +=
                block.timestamp - pausedAt;
        }

        pausedAt = 0;
        saleOpen = true;

        if (paused()) {
            _unpause();
        }

        emit GenesisResumed(
            currentStage,
            currentStageEnd(),
            block.timestamp
        );
    }

    /**
     * @notice Permanently closes Genesis before or after stage completion.
     */
    function finalizeGenesis() external onlyOwner {
        if (saleFinalized) {
            revert SaleAlreadyFinalized();
        }

        if (!hasOpened) {
            revert SaleNotOpen();
        }

        _closeAllRemainingStages();
        _finalizeGenesis();
    }

    function _closeAllRemainingStages() internal {
        for (
            uint256 i = currentStage;
            i < STAGE_COUNT;
            i++
        ) {
            if (!stageClosed[i]) {
                uint256 unsold =
                    stageAllocation -
                    stageWtcSold[i];

                stageClosed[i] = true;
                stageUnsoldWtc[i] = unsold;

                totalWtcReturnedToPublicAllocation +=
                    unsold;

                emit StageClosed(
                    i,
                    stageWtcSold[i],
                    unsold,
                    StageCloseReason.OwnerFinalization,
                    block.timestamp
                );
            }
        }
    }

    function _finalizeGenesis() internal {
        if (saleFinalized) {
            return;
        }

        saleOpen = false;
        saleFinalized = true;

        if (!paused()) {
            _pause();
        }

        emit GenesisFinalized(
            totalPolRaised,
            totalWtcSold,
            totalWtcReturnedToPublicAllocation,
            block.timestamp
        );
    }

    /**
     * @notice Sends all remaining WTC to the declared public reserve.
     *
     * This may only occur after Genesis has permanently finalized.
     */
    function returnUnsoldTokensToPublicReserve()
        external
        onlyOwner
        nonReentrant
    {
        if (!saleFinalized) {
            revert SaleNotFinalized();
        }

        uint256 balance =
            wealthCoin.balanceOf(address(this));

        if (balance == 0) {
            revert NoTokensToRecover();
        }

        wealthCoin.safeTransfer(
            publicReserve,
            balance
        );

        emit UnsoldTokensReturnedToPublicReserve(
            publicReserve,
            balance
        );
    }

    /**
     * @notice Recovers an unrelated ERC-20 accidentally sent here.
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
     * @notice Current WTC base-unit rate received for exactly 1 POL.
     */
    function currentRate()
        public
        view
        returns (uint256)
    {
        return stageRates[currentStage];
    }

    /**
     * @notice Calculates WTC received using the current stage rate.
     */
    function calculateTokenAmount(
        uint256 polAmount
    )
        public
        view
        returns (uint256)
    {
        return
            (polAmount * currentRate()) /
            1 ether;
    }

    /**
     * @notice Calculates WTC using a selected stage rate.
     */
    function calculateTokenAmountAtStage(
        uint256 polAmount,
        uint256 stage
    )
        external
        view
        returns (uint256)
    {
        if (stage >= STAGE_COUNT) {
            revert InvalidStage(stage);
        }

        return
            (polAmount * stageRates[stage]) /
            1 ether;
    }

    function currentStageEnd()
        public
        view
        returns (uint256)
    {
        if (!hasOpened) {
            return 0;
        }

        return currentStageStart + STAGE_DURATION;
    }

    function remainingCurrentStageAllocation()
        public
        view
        returns (uint256)
    {
        if (
            saleFinalized ||
            stageClosed[currentStage]
        ) {
            return 0;
        }

        return
            stageAllocation -
            stageWtcSold[currentStage];
    }

    /**
     * @notice WTC still available across current and future stages.
     *
     * Expired unsold WTC is excluded because it has returned to the
     * public allocation and cannot be sold through Genesis.
     */
    function remainingAllocation()
        public
        view
        returns (uint256)
    {
        return
            genesisAllocation -
            totalWtcSold -
            totalWtcReturnedToPublicAllocation;
    }

    function remainingWalletAllowance(
        address buyer
    )
        public
        view
        returns (uint256)
    {
        uint256 purchased =
            polPurchasedByWallet[buyer];

        if (purchased >= maxPurchasePerWallet) {
            return 0;
        }

        return
            maxPurchasePerWallet - purchased;
    }

    function isFullyFunded()
        external
        view
        returns (bool)
    {
        uint256 required = hasOpened
            ? remainingAllocation()
            : genesisAllocation;

        return
            wealthCoin.balanceOf(address(this)) >=
            required;
    }

    function getStageDetails(
        uint256 stage
    )
        external
        view
        returns (
            uint256 rate,
            uint256 allocation,
            uint256 sold,
            uint256 unsold,
            bool closed
        )
    {
        if (stage >= STAGE_COUNT) {
            revert InvalidStage(stage);
        }

        return (
            stageRates[stage],
            stageAllocation,
            stageWtcSold[stage],
            stageUnsoldWtc[stage],
            stageClosed[stage]
        );
    }

    function getCurrentStageDetails()
        external
        view
        returns (
            uint256 stage,
            uint256 rate,
            uint256 allocation,
            uint256 sold,
            uint256 remaining,
            uint256 startTime,
            uint256 endTime
        )
    {
        return (
            currentStage,
            currentRate(),
            stageAllocation,
            stageWtcSold[currentStage],
            remainingCurrentStageAllocation(),
            currentStageStart,
            currentStageEnd()
        );
    }

    // =============================================================
    //                         INTERNAL HELPERS
    // =============================================================

    function _ceilDiv(
        uint256 numerator,
        uint256 denominator
    )
        internal
        pure
        returns (uint256)
    {
        if (numerator == 0) {
            return 0;
        }

        return
            ((numerator - 1) / denominator) + 1;
    }

    // =============================================================
    //                      DIRECT PAYMENT GUARDS
    // =============================================================

    receive() external payable {
        revert DirectPaymentsDisabled();
    }

    fallback() external payable {
        revert DirectPaymentsDisabled();
    }
}