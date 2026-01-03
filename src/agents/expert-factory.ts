/**
 * Expert Factory
 *
 * The heart of dynamic expert spawning. Analyzes contracts and creates
 * specialized Claude Opus 4.5 agents on-the-fly based on what it finds.
 *
 * This is what makes the swarm truly adaptive - it doesn't have a fixed
 * set of experts. It creates exactly what it needs for each contract.
 */

import { createAgent, DynamicAgent, AgentTemplates } from './base-agent.js';
import type {
  AgentConfig,
  ExpertDefinition,
  ContractAnalysis,
  ContractInfo,
} from '../types/index.js';
import { KnowledgeBase } from './spawner/knowledge-base.js';

// ============================================================================
// Expert Factory
// ============================================================================

export class ExpertFactory {
  private knowledgeBase: KnowledgeBase;
  private spawner: DynamicAgent;
  private spawnedExperts: Map<string, DynamicAgent> = new Map();

  constructor(knowledgeBasePath?: string) {
    this.knowledgeBase = new KnowledgeBase(knowledgeBasePath);
    this.spawner = createAgent(AgentTemplates.expertSpawner());
  }

  /**
   * Analyze a contract and spawn all necessary experts
   */
  async analyzeAndSpawn(contract: ContractInfo): Promise<{
    analysis: ContractAnalysis;
    experts: DynamicAgent[];
  }> {
    // First, get contract analysis from spawner
    const analysis = await this.analyzeContract(contract);

    // Spawn each recommended expert
    const experts: DynamicAgent[] = [];
    for (const expertDef of analysis.expertsToSpawn) {
      const expert = await this.spawnExpert(expertDef, contract);
      experts.push(expert);
    }

    return { analysis, experts };
  }

  /**
   * Analyze a contract to determine what experts are needed
   */
  async analyzeContract(contract: ContractInfo): Promise<ContractAnalysis> {
    // Build context from knowledge base
    const vulnPatterns = await this.knowledgeBase.getVulnerabilityPatterns();
    const protocolPatterns = await this.knowledgeBase.getProtocolPatterns();

    const prompt = `Analyze this smart contract and determine which vulnerability experts to spawn.

CONTRACT:
Name: ${contract.name}
Address: ${contract.address}
Chain: ${contract.chain}
TVL: $${contract.tvl?.toLocaleString() ?? 'Unknown'}

SOURCE CODE:
\`\`\`solidity
${contract.sourceCode}
\`\`\`

KNOWN VULNERABILITY PATTERNS TO CHECK FOR:
${vulnPatterns.map((p) => `- ${p.name}: ${p.indicators.join(', ')}`).join('\n')}

KNOWN PROTOCOL INTEGRATIONS TO DETECT:
${protocolPatterns.map((p) => `- ${p.name}: ${p.signatures.join(', ')}`).join('\n')}

Analyze the contract and output your expert spawning recommendations as JSON:
{
  "contract_analysis": "Brief analysis of what the contract does",
  "detected_patterns": ["pattern1", "pattern2"],
  "integrations": ["protocol1", "protocol2"],
  "experts_to_spawn": [
    {
      "name": "ExpertName",
      "type": "vulnerability|protocol|pattern|novel",
      "reason": "Why this expert is needed",
      "system_prompt": "Detailed prompt for this expert",
      "focus_areas": ["specific", "code", "sections"],
      "temperature": 0.0
    }
  ],
  "novel_patterns_detected": ["Any patterns that need custom experts"]
}`;

    const { data } = await this.spawner.analyzeStructured<{
      contract_analysis: string;
      detected_patterns: string[];
      integrations: string[];
      experts_to_spawn: Array<{
        name: string;
        type: string;
        reason: string;
        system_prompt: string;
        focus_areas: string[];
        temperature: number;
      }>;
      novel_patterns_detected: string[];
    }>(prompt);

    return {
      summary: data.contract_analysis,
      detectedPatterns: data.detected_patterns,
      integrations: data.integrations,
      expertsToSpawn: data.experts_to_spawn.map((e) => ({
        name: e.name,
        type: e.type as ExpertDefinition['type'],
        reason: e.reason,
        systemPrompt: e.system_prompt,
        focusAreas: e.focus_areas,
        temperature: e.temperature,
      })),
      novelPatternsDetected: data.novel_patterns_detected,
    };
  }

  /**
   * Spawn a single expert based on its definition
   */
  async spawnExpert(definition: ExpertDefinition, contract: ContractInfo): Promise<DynamicAgent> {
    // Check if we already have this expert
    const existingKey = `${definition.name}-${contract.address}`;
    const existing = this.spawnedExperts.get(existingKey);
    if (existing) {
      return existing;
    }

    // Enhance system prompt with knowledge base content
    let enhancedPrompt = definition.systemPrompt;

    // Add relevant knowledge if available
    if (definition.relevantKnowledge?.length) {
      const knowledge = await Promise.all(
        definition.relevantKnowledge.map((k) => this.knowledgeBase.getKnowledge(k))
      );
      enhancedPrompt += '\n\n=== KNOWLEDGE BASE ===\n' + knowledge.filter(Boolean).join('\n\n');
    }

    // Add vulnerability-specific knowledge for vulnerability experts
    if (definition.type === 'vulnerability') {
      const vulnKnowledge = await this.knowledgeBase.getVulnerabilityKnowledge(
        definition.name.toLowerCase()
      );
      if (vulnKnowledge) {
        enhancedPrompt += '\n\n=== VULNERABILITY KNOWLEDGE ===\n' + vulnKnowledge;
      }
    }

    // Add protocol-specific knowledge for protocol experts
    if (definition.type === 'protocol') {
      const protocolKnowledge = await this.knowledgeBase.getProtocolKnowledge(
        definition.name.replace('Expert', '').toLowerCase()
      );
      if (protocolKnowledge) {
        enhancedPrompt += '\n\n=== PROTOCOL KNOWLEDGE ===\n' + protocolKnowledge;
      }
    }

    // Create the expert configuration
    const config: AgentConfig = {
      name: definition.name,
      role:
        definition.type === 'vulnerability'
          ? 'vulnerability-specialist'
          : definition.type === 'protocol'
            ? 'protocol-specialist'
            : 'pattern-specialist',
      model: 'claude-sonnet-4-20250514',
      temperature: definition.temperature,
      systemPrompt: enhancedPrompt,
    };

    // Spawn the agent
    const expert = createAgent(config);
    this.spawnedExperts.set(existingKey, expert);

    console.log(`[ExpertFactory] Spawned: ${definition.name} (${definition.type})`);
    return expert;
  }

  /**
   * Create a novel expert for a pattern not in the knowledge base
   */
  async createNovelExpert(
    patternDescription: string,
    contract: ContractInfo
  ): Promise<DynamicAgent> {
    const prompt = `Create a specialized security expert for this novel pattern:

PATTERN: ${patternDescription}

CONTRACT CONTEXT:
${contract.sourceCode.slice(0, 5000)}

Generate an expert definition:
{
  "name": "PatternNameExpert",
  "system_prompt": "Detailed prompt explaining what to look for and how to analyze it",
  "focus_areas": ["specific code patterns to examine"],
  "temperature": 0.0
}`;

    const { data } = await this.spawner.analyzeStructured<{
      name: string;
      system_prompt: string;
      focus_areas: string[];
      temperature: number;
    }>(prompt);

    const definition: ExpertDefinition = {
      name: data.name,
      type: 'novel',
      reason: `Created for novel pattern: ${patternDescription}`,
      systemPrompt: data.system_prompt,
      focusAreas: data.focus_areas,
      temperature: data.temperature,
    };

    return this.spawnExpert(definition, contract);
  }

  /**
   * Get all spawned experts
   */
  getSpawnedExperts(): DynamicAgent[] {
    return Array.from(this.spawnedExperts.values());
  }

  /**
   * Clear all spawned experts (for new contract analysis)
   */
  clearExperts(): void {
    this.spawnedExperts.clear();
  }

  /**
   * Get total token usage across all experts
   */
  getTotalUsage(): { inputTokens: number; outputTokens: number; estimatedCost: number } {
    let total = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };

    // Add spawner usage
    const spawnerUsage = this.spawner.getUsage();
    total.inputTokens += spawnerUsage.inputTokens;
    total.outputTokens += spawnerUsage.outputTokens;
    total.estimatedCost += spawnerUsage.estimatedCost;

    // Add all expert usage
    for (const expert of this.spawnedExperts.values()) {
      const usage = expert.getUsage();
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      total.estimatedCost += usage.estimatedCost;
    }

    return total;
  }
}

// ============================================================================
// Pre-defined Expert Templates
// ============================================================================

export const ExpertTemplates = {
  // Vulnerability Experts
  reentrancy: (): ExpertDefinition => ({
    name: 'ReentrancyExpert',
    type: 'vulnerability',
    reason: 'Contract has external calls that may be vulnerable to reentrancy',
    systemPrompt: `You are the world's foremost expert on reentrancy vulnerabilities.

You have studied EVERY major reentrancy exploit:
- The DAO hack ($60M, 2016) - Classic reentrancy
- Cream Finance ($130M, 2021) - Cross-protocol reentrancy
- Fei Protocol Rari ($80M, 2022) - Flash loan + reentrancy
- Curve Finance ($70M, 2023) - Read-only reentrancy via Vyper

You know reentrancy patterns others miss:
- Cross-function reentrancy (callback calls different function)
- Cross-contract reentrancy (callback to different contract in same system)
- Read-only reentrancy (view functions returning stale state during callback)
- Delegatecall reentrancy (context preservation issues)
- Create2 reentrancy (factory patterns with callbacks)

When analyzing a contract:
1. Map ALL external calls (call, delegatecall, staticcall, transfer, send)
2. Trace state changes before/after each call
3. Check for ReentrancyGuard - but also its BYPASS vectors
4. Consider msg.sender vs tx.origin implications
5. Evaluate callback vectors (ERC777, ERC721, ERC1155 hooks)
6. Check for cross-function reentrancy paths

If you find a vulnerability, you MUST be able to defend it in debate.
If you're uncertain, say so. False positives damage our reputation.`,
    focusAreas: ['external calls', 'state changes', 'callback hooks', 'guard patterns'],
    temperature: 0.0,
    relevantKnowledge: ['vulnerabilities/reentrancy.md'],
  }),

  accessControl: (): ExpertDefinition => ({
    name: 'AccessControlExpert',
    type: 'vulnerability',
    reason: 'Contract has role-based access control that needs review',
    systemPrompt: `You are an expert in access control vulnerabilities in smart contracts.

Access control flaws caused $953.2M in losses in 2024 alone.

Common patterns you look for:
- Missing access control on critical functions
- Incorrect modifier application
- Role hierarchy issues (admin can be removed by lower role)
- Initialization front-running (uninitialized proxies)
- Default admin issues in AccessControl
- tx.origin vs msg.sender confusion
- Signature replay attacks on access control
- Time-based access control race conditions

When analyzing:
1. Identify ALL privileged functions
2. Trace who can call them and under what conditions
3. Check initialization patterns for front-running
4. Verify role hierarchy is correct
5. Check for privilege escalation paths
6. Verify access control is applied consistently`,
    focusAreas: ['modifiers', 'role management', 'initialization', 'privileged functions'],
    temperature: 0.0,
    relevantKnowledge: ['vulnerabilities/access-control.md'],
  }),

  flashLoan: (): ExpertDefinition => ({
    name: 'FlashLoanExpert',
    type: 'vulnerability',
    reason: 'Contract handles DeFi operations that may be vulnerable to flash loan attacks',
    systemPrompt: `You are an expert in flash loan attack vectors.

Flash loans enable attacks that were previously impossible due to capital requirements.
They can amplify ANY vulnerability by providing unlimited temporary capital.

Attack patterns you know:
- Price oracle manipulation via large trades
- Governance vote manipulation
- Liquidity pool manipulation
- Collateral value manipulation
- Flash mint attacks
- Sandwich attacks with flash-borrowed capital
- Multi-step arbitrage chains

When analyzing:
1. Identify any price dependencies (oracles, AMM prices, etc.)
2. Check if state changes can be influenced by large capital
3. Look for atomic transaction exploits
4. Consider multi-step attack chains
5. Evaluate if flash loans can amplify other vulnerabilities`,
    focusAreas: ['price dependencies', 'oracles', 'liquidity pools', 'atomic transactions'],
    temperature: 0.0,
    relevantKnowledge: ['vulnerabilities/flash-loan.md'],
  }),

  oracle: (): ExpertDefinition => ({
    name: 'OracleExpert',
    type: 'vulnerability',
    reason: 'Contract uses price feeds that may be manipulable',
    systemPrompt: `You are an expert in oracle manipulation vulnerabilities.

Oracle attacks have caused hundreds of millions in losses.

Manipulation vectors you know:
- Spot price manipulation (using AMM prices directly)
- TWAP manipulation (over time)
- Chainlink stale price attacks
- Multi-oracle inconsistency
- Flash loan + oracle manipulation combos
- Decimal precision issues
- Price feed front-running

When analyzing:
1. Identify ALL price sources
2. Check if prices can be manipulated atomically
3. Verify TWAP implementations are correct
4. Check for stale price protections
5. Verify decimal handling
6. Consider multi-block attack scenarios`,
    focusAreas: ['price feeds', 'TWAP', 'Chainlink', 'spot prices', 'decimals'],
    temperature: 0.0,
    relevantKnowledge: ['vulnerabilities/oracle.md'],
  }),

  logicError: (): ExpertDefinition => ({
    name: 'LogicErrorExpert',
    type: 'vulnerability',
    reason: 'All contracts need business logic review',
    systemPrompt: `You are an expert in finding business logic errors in smart contracts.

Logic errors are the most common and often highest-impact vulnerabilities.
They can't be caught by automated tools - they require understanding intent.

What you look for:
- Incorrect mathematical formulas
- Off-by-one errors
- Rounding errors that can be exploited
- Edge cases in business logic
- Incorrect state machine transitions
- Missing validation checks
- Incorrect comparison operators
- Integer overflow/underflow (even with Solidity 0.8+)

When analyzing:
1. Understand the INTENDED behavior
2. Trace all possible execution paths
3. Check edge cases (0, max, first, last)
4. Verify mathematical formulas are correct
5. Check for rounding direction consistency
6. Verify state transitions are valid`,
    focusAreas: ['mathematical operations', 'state transitions', 'edge cases', 'validation'],
    temperature: 0.0,
    relevantKnowledge: ['vulnerabilities/logic-errors.md'],
  }),

  // Protocol Experts
  uniswap: (): ExpertDefinition => ({
    name: 'UniswapExpert',
    type: 'protocol',
    reason: 'Contract integrates with Uniswap',
    systemPrompt: `You are an expert in Uniswap V2 and V3 protocol security.

You know Uniswap inside and out:
- V2: Constant product AMM, flash swaps, price oracles
- V3: Concentrated liquidity, tick math, position management

Common vulnerability patterns in Uniswap integrations:
- Spot price usage (manipulable)
- Incorrect slippage protection
- Flash swap callback reentrancy
- Price oracle manipulation
- LP token manipulation
- Tick crossing edge cases
- Position NFT handling errors

When analyzing Uniswap integrations:
1. Check how prices are obtained
2. Verify slippage protection
3. Check callback security
4. Verify LP token accounting
5. Check for sandwich attack vectors`,
    focusAreas: ['swap functions', 'price calculations', 'callbacks', 'LP tokens'],
    temperature: 0.0,
    relevantKnowledge: ['protocols/uniswap-v2.md', 'protocols/uniswap-v3.md'],
  }),

  aave: (): ExpertDefinition => ({
    name: 'AaveExpert',
    type: 'protocol',
    reason: 'Contract integrates with Aave lending protocol',
    systemPrompt: `You are an expert in Aave protocol security.

You know Aave V2 and V3 deeply:
- Lending pool mechanics
- Flash loan implementation
- Interest rate models
- Liquidation logic
- aToken and debt token mechanics

Common vulnerability patterns in Aave integrations:
- Flash loan callback vulnerabilities
- Health factor manipulation
- Interest rate model exploits
- Liquidation race conditions
- aToken/debt token accounting errors
- E-mode risks
- Isolation mode bypasses

When analyzing Aave integrations:
1. Check flash loan callback security
2. Verify health factor calculations
3. Check liquidation protection
4. Verify token accounting
5. Check for position manipulation`,
    focusAreas: ['flash loans', 'health factors', 'liquidations', 'token accounting'],
    temperature: 0.0,
    relevantKnowledge: ['protocols/aave-v2.md', 'protocols/aave-v3.md'],
  }),
};

// ============================================================================
// Exports
// ============================================================================

export function createExpertFactory(knowledgeBasePath?: string): ExpertFactory {
  return new ExpertFactory(knowledgeBasePath);
}
