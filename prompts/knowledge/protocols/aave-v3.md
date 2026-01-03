# Aave V3 Protocol Security Guide

## Protocol Overview
Aave V3 is a decentralized lending protocol where users can supply assets to earn interest or borrow assets against collateral. Key innovations include Efficiency Mode (E-Mode), Isolation Mode, and Portal for cross-chain liquidity.

## Core Contracts

### Pool (0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2 on Mainnet)
- Main entry point for all lending operations
- Handles supply, borrow, repay, withdraw, liquidation
- Flash loan provider

### aTokens
- Interest-bearing tokens representing deposits
- Balance increases over time via rebasing
- 1:1 redeemable for underlying

### Debt Tokens
- VariableDebtToken: Variable rate borrowing
- StableDebtToken: Fixed rate borrowing (being phased out)

## Common Vulnerability Patterns

### 1. Flash Loan Callback Exploitation
```solidity
// VULNERABLE - No validation in callback
function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
) external returns (bool) {
    // Missing: require(msg.sender == AAVE_POOL);
    // Missing: require(initiator == address(this));
    doSomething(assets, amounts);
    return true;
}
```

### 2. Health Factor Manipulation
Attackers may try to manipulate their health factor to:
- Avoid liquidation
- Borrow more than allowed
- Extract value through self-liquidation

```solidity
// Key function to check
(
    totalCollateralBase,
    totalDebtBase,
    availableBorrowsBase,
    currentLiquidationThreshold,
    ltv,
    healthFactor
) = pool.getUserAccountData(user);

// Health Factor = (TotalCollateral * LiquidationThreshold) / TotalDebt
// If HF < 1, position can be liquidated
```

### 3. Oracle Manipulation
Aave uses Chainlink oracles but integrations may be vulnerable:
- Stale price attacks
- Price manipulation in thinly traded pairs
- Decimal precision issues

### 4. E-Mode Exploitation
E-Mode allows higher LTV for correlated assets. Risks:
- Depegging events (stETH/ETH, USDC/USDT)
- Incorrect asset correlation assumptions
- Category configuration errors

### 5. Isolation Mode Bypass
Isolation mode limits borrowing for new/risky assets. Check for:
- Incorrect debt ceiling enforcement
- Collateral type confusion
- Mode transition issues

## Flash Loan Integration

### Correct Implementation
```solidity
import {IPool} from "@aave/v3-core/contracts/interfaces/IPool.sol";
import {IFlashLoanSimpleReceiver} from "@aave/v3-core/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";

contract SecureFlashLoan is IFlashLoanSimpleReceiver {
    IPool public immutable POOL;
    address public immutable OWNER;

    constructor(address pool) {
        POOL = IPool(pool);
        OWNER = msg.sender;
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        // CRITICAL: Verify caller is the pool
        require(msg.sender == address(POOL), "Caller must be pool");
        // CRITICAL: Verify initiator is this contract
        require(initiator == address(this), "Initiator must be self");

        // Your logic here

        // Approve repayment
        uint256 amountOwed = amount + premium;
        IERC20(asset).approve(address(POOL), amountOwed);

        return true;
    }
}
```

### Flash Loan Fees
- Standard: 0.09% (9 basis points)
- Can check: `pool.FLASHLOAN_PREMIUM_TOTAL()`

## Liquidation Mechanics

### Liquidation Conditions
- Health Factor < 1
- Maximum 50% of debt can be liquidated per tx (close factor)
- Liquidator receives collateral + bonus

### Liquidation Bonus
- Typically 5-10% depending on asset
- Check `reserveData.liquidationBonus`

### Attack Vectors
```solidity
// Self-liquidation exploit pattern (like Euler)
// 1. Deposit collateral
// 2. Borrow against it
// 3. Donate to increase reserve value
// 4. Liquidate self for profit

// Defense: Aave has donation attack protections
```

## Interest Rate Model

### Variable Rate
Based on utilization rate:
- Below optimal: Low rates to encourage borrowing
- Above optimal: High rates to encourage repayment

```
if (utilization < optimalUtilization):
    rate = baseRate + (utilization / optimalUtilization) * slope1
else:
    rate = baseRate + slope1 + ((utilization - optimal) / (1 - optimal)) * slope2
```

### Manipulation Vectors
- Flash loan to temporarily spike utilization
- Rate jumping attacks
- Interest accrual timing issues

## Security Checklist for Aave Integrations

1. **Flash Loan Callbacks**
   - [ ] Verify msg.sender is the Pool
   - [ ] Verify initiator is expected address
   - [ ] Handle premium payment correctly
   - [ ] No reentrancy vulnerabilities

2. **Position Management**
   - [ ] Check health factor before actions
   - [ ] Handle E-mode correctly
   - [ ] Account for liquidation risk

3. **Token Accounting**
   - [ ] Understand aToken rebasing
   - [ ] Handle debt token balance changes
   - [ ] Account for interest accrual

4. **Oracle Usage**
   - [ ] Don't use Aave's internal prices for spot prices
   - [ ] Check for stale prices
   - [ ] Handle decimal conversions

5. **Access Control**
   - [ ] Verify only authorized users can withdraw
   - [ ] Check delegation permissions
   - [ ] Validate approved amounts

## Historical Aave-Related Exploits

| Date | Incident | Impact | Root Cause |
|------|----------|--------|------------|
| 2020-11 | Flash Loan Attack | - | Uniswap price manipulation |
| 2022-03 | Hundred Finance | $7M | Compound-fork reentrancy |
| 2022-04 | CREAM (Iron Bank) | $37M | Lending pool oracle manipulation |

Note: Aave V3 mainnet has not been directly exploited as of knowledge cutoff.
