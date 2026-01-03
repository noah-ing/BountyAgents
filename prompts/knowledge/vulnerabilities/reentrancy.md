# Reentrancy Vulnerabilities

## Overview
Reentrancy is one of the most dangerous and well-known smart contract vulnerabilities. It occurs when an external call to another contract allows that contract to make a recursive call back to the original function before the first invocation is complete.

## Types of Reentrancy

### 1. Classic/Single-Function Reentrancy
The simplest form where a function calls itself recursively through an external call.

```solidity
// VULNERABLE
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount);
    (bool success, ) = msg.sender.call{value: amount}("");  // External call BEFORE state update
    require(success);
    balances[msg.sender] -= amount;  // State update AFTER external call
}
```

### 2. Cross-Function Reentrancy
Attacker re-enters a different function that shares state with the vulnerable function.

```solidity
// VULNERABLE - cross-function reentrancy
function transfer(address to, uint256 amount) external {
    require(balances[msg.sender] >= amount);
    balances[msg.sender] -= amount;
    balances[to] += amount;
}

function withdraw() external {
    uint256 amount = balances[msg.sender];
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success);
    balances[msg.sender] = 0;
}
// Attacker can call transfer() during withdraw() callback
```

### 3. Cross-Contract Reentrancy
Attacker re-enters a different contract that shares state (e.g., through a shared storage or token).

### 4. Read-Only Reentrancy
View functions return stale state during a callback, leading to incorrect calculations.

```solidity
// VULNERABLE - read-only reentrancy (Curve-style)
function getVirtualPrice() external view returns (uint256) {
    return totalAssets / totalSupply;  // Returns stale value during callback
}

function addLiquidity(uint256 amount) external {
    _transferIn(amount);  // Callback here
    uint256 price = getVirtualPrice();  // Stale!
    _mintShares(amount * price);
}
```

### 5. Delegatecall Reentrancy
Context is preserved in delegatecall, allowing state manipulation.

## Detection Indicators

Look for these patterns:
- `call{value:}` before state updates
- `.call(` with any data
- `transfer(` to unknown addresses
- `send(` calls
- ERC-777 tokens (tokensReceived callback)
- ERC-721/ERC-1155 hooks (onERC721Received, onERC1155Received)
- Any token with callback mechanisms

## Protection Mechanisms

### 1. Checks-Effects-Interactions Pattern
```solidity
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount);  // Check
    balances[msg.sender] -= amount;            // Effect
    (bool success, ) = msg.sender.call{value: amount}("");  // Interaction
    require(success);
}
```

### 2. ReentrancyGuard (OpenZeppelin)
```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract Safe is ReentrancyGuard {
    function withdraw(uint256 amount) external nonReentrant {
        // Protected
    }
}
```

### 3. Mutex Lock (Manual)
```solidity
bool private locked;
modifier noReentrant() {
    require(!locked, "Reentrant call");
    locked = true;
    _;
    locked = false;
}
```

## Bypass Techniques

### 1. Bypassing ReentrancyGuard via Delegatecall
If contract A uses delegatecall to contract B, and B has a reentrancy vulnerability, the guard on A won't help.

### 2. Cross-Contract Reentrancy
If contracts A and B share state but only A has a reentrancy guard, B can be exploited.

### 3. Read-Only Reentrancy
Guards don't protect view functions - check for stale state reads.

### 4. Modifier Not Applied
Check that ALL functions modifying shared state have the guard.

## Historical Exploits

| Date | Protocol | Loss | Technique |
|------|----------|------|-----------|
| 2016-06-17 | The DAO | $60M | Classic reentrancy |
| 2021-10-27 | Cream Finance | $130M | Cross-protocol via AMP |
| 2022-04-30 | Fei/Rari | $80M | Flash loan + reentrancy |
| 2023-07-30 | Curve | $70M | Read-only reentrancy (Vyper) |

## Testing for Reentrancy

### Foundry Test Pattern
```solidity
contract Attacker {
    Target target;
    uint256 count;

    constructor(address _target) {
        target = Target(_target);
    }

    function attack() external {
        target.withdraw(1 ether);
    }

    receive() external payable {
        if (count < 10) {
            count++;
            target.withdraw(1 ether);
        }
    }
}
```

### Static Analysis
- Slither: `slither . --detect reentrancy-eth,reentrancy-no-eth`
- Mythril: `myth analyze contract.sol --execution-timeout 300`
