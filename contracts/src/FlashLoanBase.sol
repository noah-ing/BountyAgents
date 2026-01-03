// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./ExploitBase.sol";

/**
 * @title FlashLoanBase
 * @notice Base contract for flash loan-based exploits
 * @dev Supports Aave, Balancer, dYdX, and Uniswap flash loans
 */
abstract contract FlashLoanBase is ExploitBase {
    // ========================================================================
    // Flash Loan Providers
    // ========================================================================

    // Aave V3 Pool (Mainnet)
    address constant AAVE_V3_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;

    // Balancer Vault (Mainnet)
    address constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    // Uniswap V3 Factory (Mainnet)
    address constant UNISWAP_V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;

    // Common tokens
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address constant DAI = 0x6B175474E89094C44Da98b954EescdeCB5Dacb5AD;
    address constant WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;

    // ========================================================================
    // Aave V3 Flash Loan
    // ========================================================================

    /**
     * @notice Request flash loan from Aave V3
     * @param asset Token to borrow
     * @param amount Amount to borrow
     */
    function aaveFlashLoan(address asset, uint256 amount) internal {
        address[] memory assets = new address[](1);
        assets[0] = asset;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // No debt (flash loan must be repaid)

        bytes memory params = abi.encode(asset, amount);

        // Call Aave Pool
        IAavePool(AAVE_V3_POOL).flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            params,
            0 // referralCode
        );
    }

    /**
     * @notice Aave flash loan callback
     * @dev Override executeFlashLoanLogic() to implement exploit
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == AAVE_V3_POOL, "Caller must be Aave Pool");
        require(initiator == address(this), "Initiator must be this contract");

        // Execute exploit logic
        executeFlashLoanLogic(assets[0], amounts[0], premiums[0]);

        // Approve repayment
        uint256 amountOwed = amounts[0] + premiums[0];
        approveToken(assets[0], AAVE_V3_POOL, amountOwed);

        return true;
    }

    // ========================================================================
    // Balancer Flash Loan
    // ========================================================================

    /**
     * @notice Request flash loan from Balancer
     * @param token Token to borrow
     * @param amount Amount to borrow
     */
    function balancerFlashLoan(address token, uint256 amount) internal {
        address[] memory tokens = new address[](1);
        tokens[0] = token;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        bytes memory userData = abi.encode(token, amount);

        IBalancerVault(BALANCER_VAULT).flashLoan(
            IFlashLoanRecipient(address(this)),
            tokens,
            amounts,
            userData
        );
    }

    /**
     * @notice Balancer flash loan callback
     */
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        require(msg.sender == BALANCER_VAULT, "Caller must be Balancer Vault");

        // Execute exploit logic (Balancer has 0 fees!)
        executeFlashLoanLogic(tokens[0], amounts[0], feeAmounts[0]);

        // Repay
        transferToken(tokens[0], BALANCER_VAULT, amounts[0] + feeAmounts[0]);
    }

    // ========================================================================
    // Uniswap V3 Flash Swap
    // ========================================================================

    /**
     * @notice Request flash swap from Uniswap V3
     * @param pool Uniswap V3 pool address
     * @param amount0 Amount of token0 to borrow
     * @param amount1 Amount of token1 to borrow
     */
    function uniswapFlashSwap(address pool, uint256 amount0, uint256 amount1) internal {
        bytes memory data = abi.encode(pool, amount0, amount1);
        IUniswapV3Pool(pool).flash(address(this), amount0, amount1, data);
    }

    /**
     * @notice Uniswap V3 flash callback
     */
    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external {
        (address pool, uint256 amount0, uint256 amount1) = abi.decode(data, (address, uint256, uint256));
        require(msg.sender == pool, "Caller must be the pool");

        // Get tokens from pool
        address token0 = IUniswapV3Pool(pool).token0();
        address token1 = IUniswapV3Pool(pool).token1();

        // Execute exploit logic
        if (amount0 > 0) {
            executeFlashLoanLogic(token0, amount0, fee0);
            transferToken(token0, pool, amount0 + fee0);
        }
        if (amount1 > 0) {
            executeFlashLoanLogic(token1, amount1, fee1);
            transferToken(token1, pool, amount1 + fee1);
        }
    }

    // ========================================================================
    // Override Point
    // ========================================================================

    /**
     * @notice Implement your exploit logic here
     * @param token The borrowed token
     * @param amount The borrowed amount
     * @param fee The fee to pay back
     */
    function executeFlashLoanLogic(
        address token,
        uint256 amount,
        uint256 fee
    ) internal virtual;
}

// ========================================================================
// Interfaces
// ========================================================================

interface IAavePool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IBalancerVault {
    function flashLoan(
        IFlashLoanRecipient recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IFlashLoanRecipient {
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external;
}

interface IUniswapV3Pool {
    function flash(
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;

    function token0() external view returns (address);
    function token1() external view returns (address);
}
