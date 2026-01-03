/**
 * Knowledge Base
 *
 * Stores and retrieves expert knowledge for dynamic agent creation.
 * Contains vulnerability patterns, protocol specifics, and historical exploits.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface VulnerabilityPattern {
  name: string;
  type: string;
  indicators: string[];
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  examples: string[];
}

export interface ProtocolPattern {
  name: string;
  signatures: string[];
  contracts: string[];
  risks: string[];
}

export interface HistoricalExploit {
  name: string;
  protocol: string;
  date: string;
  lossUsd: number;
  vulnerabilityType: string;
  description: string;
  attackVector: string;
}

// ============================================================================
// Knowledge Base
// ============================================================================

export class KnowledgeBase {
  private basePath: string;
  private cache: Map<string, string> = new Map();

  constructor(basePath?: string) {
    this.basePath = basePath ?? join(process.cwd(), 'prompts', 'knowledge');
  }

  /**
   * Get knowledge from a specific file
   */
  async getKnowledge(relativePath: string): Promise<string | null> {
    // Check cache
    if (this.cache.has(relativePath)) {
      return this.cache.get(relativePath)!;
    }

    const fullPath = join(this.basePath, relativePath);
    if (!existsSync(fullPath)) {
      return null;
    }

    try {
      const content = await readFile(fullPath, 'utf-8');
      this.cache.set(relativePath, content);
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Get vulnerability-specific knowledge
   */
  async getVulnerabilityKnowledge(vulnType: string): Promise<string | null> {
    return this.getKnowledge(`vulnerabilities/${vulnType}.md`);
  }

  /**
   * Get protocol-specific knowledge
   */
  async getProtocolKnowledge(protocol: string): Promise<string | null> {
    return this.getKnowledge(`protocols/${protocol}.md`);
  }

  /**
   * Get all known vulnerability patterns
   */
  async getVulnerabilityPatterns(): Promise<VulnerabilityPattern[]> {
    // Return built-in patterns (can be extended from knowledge files)
    return VULNERABILITY_PATTERNS;
  }

  /**
   * Get all known protocol integration patterns
   */
  async getProtocolPatterns(): Promise<ProtocolPattern[]> {
    return PROTOCOL_PATTERNS;
  }

  /**
   * Get historical exploits for learning
   */
  async getHistoricalExploits(filter?: {
    vulnerabilityType?: string;
    protocol?: string;
    minLossUsd?: number;
  }): Promise<HistoricalExploit[]> {
    let exploits = HISTORICAL_EXPLOITS;

    if (filter?.vulnerabilityType) {
      exploits = exploits.filter((e) =>
        e.vulnerabilityType.toLowerCase().includes(filter.vulnerabilityType!.toLowerCase())
      );
    }

    if (filter?.protocol) {
      exploits = exploits.filter((e) =>
        e.protocol.toLowerCase().includes(filter.protocol!.toLowerCase())
      );
    }

    if (filter?.minLossUsd) {
      exploits = exploits.filter((e) => e.lossUsd >= filter.minLossUsd!);
    }

    return exploits;
  }

  /**
   * Add new knowledge (for learning from successful submissions)
   */
  async addKnowledge(category: string, name: string, content: string): Promise<void> {
    const relativePath = `${category}/${name}.md`;
    this.cache.set(relativePath, content);
    // In production, would also write to disk
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Built-in Vulnerability Patterns
// ============================================================================

const VULNERABILITY_PATTERNS: VulnerabilityPattern[] = [
  {
    name: 'Reentrancy',
    type: 'reentrancy',
    indicators: [
      '.call{value:',
      '.call(',
      '.delegatecall(',
      'transfer(',
      'send(',
      'safeTransfer',
      'onERC721Received',
      'onERC1155Received',
      'tokensReceived', // ERC777
    ],
    severity: 'CRITICAL',
    examples: ['The DAO', 'Cream Finance', 'Curve'],
  },
  {
    name: 'Access Control',
    type: 'access-control',
    indicators: [
      'onlyOwner',
      'onlyAdmin',
      'onlyRole',
      'require(msg.sender',
      'if (msg.sender',
      'initialize(',
      'init(',
      '_setupRole',
      'grantRole',
      'transferOwnership',
    ],
    severity: 'CRITICAL',
    examples: ['Ronin Bridge', 'Wormhole'],
  },
  {
    name: 'Flash Loan Attack',
    type: 'flash-loan',
    indicators: [
      'flashLoan',
      'flash(',
      'executeOperation',
      'receiveFlashLoan',
      'getFlashLoanAmount',
    ],
    severity: 'HIGH',
    examples: ['bZx', 'Harvest Finance'],
  },
  {
    name: 'Oracle Manipulation',
    type: 'oracle',
    indicators: [
      'getPrice',
      'latestRoundData',
      'latestAnswer',
      'getReserves',
      'slot0',
      'observe',
      'consult',
      'TWAP',
    ],
    severity: 'HIGH',
    examples: ['Mango Markets', 'Cream Iron Bank'],
  },
  {
    name: 'Integer Issues',
    type: 'integer',
    indicators: [
      'unchecked',
      'type(uint256).max',
      '/ ',
      '* ',
      '% ',
      '** ',
      '>> ',
      '<< ',
    ],
    severity: 'MEDIUM',
    examples: ['YAM Finance', 'Compound'],
  },
  {
    name: 'Frontrunning/MEV',
    type: 'frontrunning',
    indicators: [
      'slippage',
      'minAmount',
      'deadline',
      'commit-reveal',
      'private',
      'mempool',
    ],
    severity: 'MEDIUM',
    examples: ['Bancor', 'Various DEXes'],
  },
  {
    name: 'Logic Error',
    type: 'logic',
    indicators: [
      '==',
      '!=',
      '<=',
      '>=',
      '<',
      '>',
      '&&',
      '||',
      'require(',
      'assert(',
      'if (',
    ],
    severity: 'HIGH',
    examples: ['Compound', 'Wormhole'],
  },
];

// ============================================================================
// Built-in Protocol Patterns
// ============================================================================

const PROTOCOL_PATTERNS: ProtocolPattern[] = [
  {
    name: 'Uniswap V2',
    signatures: [
      'swapExactTokensForTokens',
      'swapTokensForExactTokens',
      'addLiquidity',
      'removeLiquidity',
      'getReserves',
      'IUniswapV2Pair',
      'IUniswapV2Router',
      'IUniswapV2Factory',
    ],
    contracts: [
      '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Router
      '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // Factory
    ],
    risks: ['Spot price manipulation', 'Flash swap reentrancy', 'Sandwich attacks'],
  },
  {
    name: 'Uniswap V3',
    signatures: [
      'exactInputSingle',
      'exactInput',
      'exactOutputSingle',
      'exactOutput',
      'ISwapRouter',
      'IUniswapV3Pool',
      'slot0',
      'observe',
      'positions',
    ],
    contracts: [
      '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Router
      '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Factory
    ],
    risks: ['TWAP manipulation', 'Tick rounding errors', 'Position NFT vulnerabilities'],
  },
  {
    name: 'Aave V3',
    signatures: [
      'supply',
      'borrow',
      'repay',
      'withdraw',
      'liquidationCall',
      'flashLoan',
      'flashLoanSimple',
      'getUserAccountData',
      'IPool',
      'IAToken',
      'IVariableDebtToken',
    ],
    contracts: [
      '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', // Pool (Mainnet)
    ],
    risks: ['Flash loan callbacks', 'Health factor manipulation', 'Liquidation races'],
  },
  {
    name: 'Chainlink',
    signatures: [
      'latestRoundData',
      'latestAnswer',
      'getRoundData',
      'AggregatorV3Interface',
      'priceFeed',
    ],
    contracts: [],
    risks: ['Stale prices', 'Round completion', 'Decimal mismatches'],
  },
  {
    name: 'Compound',
    signatures: [
      'mint(',
      'redeem(',
      'borrow(',
      'repayBorrow',
      'liquidateBorrow',
      'ICToken',
      'IComptroller',
      'getAccountLiquidity',
    ],
    contracts: [],
    risks: ['Interest rate manipulation', 'Oracle manipulation', 'Liquidation issues'],
  },
  {
    name: 'Curve',
    signatures: [
      'exchange',
      'exchange_underlying',
      'add_liquidity',
      'remove_liquidity',
      'get_virtual_price',
      'ICurvePool',
      'ICurveRegistry',
    ],
    contracts: [],
    risks: ['Read-only reentrancy', 'Virtual price manipulation', 'Imbalanced pools'],
  },
  {
    name: 'Balancer',
    signatures: [
      'swap',
      'batchSwap',
      'joinPool',
      'exitPool',
      'flashLoan',
      'IVault',
      'IBalancerPool',
    ],
    contracts: [
      '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Vault
    ],
    risks: ['Flash loan (zero fee)', 'Pool manipulation', 'Rate provider issues'],
  },
];

// ============================================================================
// Historical Exploits Database
// ============================================================================

const HISTORICAL_EXPLOITS: HistoricalExploit[] = [
  {
    name: 'The DAO',
    protocol: 'The DAO',
    date: '2016-06-17',
    lossUsd: 60_000_000,
    vulnerabilityType: 'reentrancy',
    description: 'Classic reentrancy attack on recursive call in splitDAO function',
    attackVector: 'Call to external contract before state update allowed recursive withdrawal',
  },
  {
    name: 'Ronin Bridge',
    protocol: 'Ronin Network',
    date: '2022-03-23',
    lossUsd: 625_000_000,
    vulnerabilityType: 'access-control',
    description: 'Compromised validator keys allowed unauthorized withdrawals',
    attackVector: 'Attacker gained control of 5/9 validators through social engineering',
  },
  {
    name: 'Wormhole',
    protocol: 'Wormhole',
    date: '2022-02-02',
    lossUsd: 326_000_000,
    vulnerabilityType: 'logic-error',
    description: 'Signature verification bypass allowed minting of unbacked tokens',
    attackVector: 'Deprecated function still accessible, bypassing signature check',
  },
  {
    name: 'Mango Markets',
    protocol: 'Mango Markets',
    date: '2022-10-11',
    lossUsd: 114_000_000,
    vulnerabilityType: 'oracle-manipulation',
    description: 'Price manipulation of low-liquidity token inflated collateral value',
    attackVector: 'Flash loan + spot price manipulation to inflate borrowing power',
  },
  {
    name: 'Cream Finance',
    protocol: 'Cream Finance',
    date: '2021-10-27',
    lossUsd: 130_000_000,
    vulnerabilityType: 'reentrancy',
    description: 'Flash loan reentrancy through price oracle update',
    attackVector: 'Cross-protocol reentrancy via AMP token callbacks',
  },
  {
    name: 'Curve Finance',
    protocol: 'Curve',
    date: '2023-07-30',
    lossUsd: 70_000_000,
    vulnerabilityType: 'reentrancy',
    description: 'Vyper compiler bug enabled read-only reentrancy',
    attackVector: 'Reentrancy guard not applied to view functions in Vyper 0.2.x',
  },
  {
    name: 'Euler Finance',
    protocol: 'Euler',
    date: '2023-03-13',
    lossUsd: 197_000_000,
    vulnerabilityType: 'logic-error',
    description: 'Donation attack through liquidation logic flaw',
    attackVector: 'Self-liquidation with donated reserves to extract value',
  },
  {
    name: 'Beanstalk',
    protocol: 'Beanstalk',
    date: '2022-04-17',
    lossUsd: 182_000_000,
    vulnerabilityType: 'flash-loan',
    description: 'Flash loan used to pass malicious governance proposal instantly',
    attackVector: 'Flash borrowed governance tokens to pass proposal in single block',
  },
];

// ============================================================================
// Exports
// ============================================================================

export function createKnowledgeBase(basePath?: string): KnowledgeBase {
  return new KnowledgeBase(basePath);
}
