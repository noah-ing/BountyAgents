/**
 * Base Agent Class
 *
 * The foundation for all agents in The Vulnerability Swarm.
 * Every specialist, attacker, defender, and synthesizer inherits from this.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentConfig,
  AgentMessage,
  AgentResponse,
  AgentRole,
  AgentModel,
  ToolDefinition,
  ToolCall,
  ToolResult,
} from '../types/index.js';

export abstract class BaseAgent {
  protected client: Anthropic;
  protected config: AgentConfig;
  protected conversationHistory: AgentMessage[] = [];
  protected totalInputTokens = 0;
  protected totalOutputTokens = 0;

  constructor(config: AgentConfig, apiKey?: string) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  // ============================================================================
  // Core Methods
  // ============================================================================

  /**
   * Send a message to the agent and get a response
   */
  async chat(userMessage: string): Promise<AgentResponse> {
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    });

    const messages = this.conversationHistory.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 8192,
      temperature: this.config.temperature,
      system: this.config.systemPrompt,
      messages,
      tools: this.config.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      })),
    });

    // Extract content
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    // Track usage
    this.totalInputTokens += response.usage.input_tokens;
    this.totalOutputTokens += response.usage.output_tokens;

    // Save to history
    this.conversationHistory.push({
      role: 'assistant',
      content: textContent,
      timestamp: new Date(),
      agentName: this.config.name,
    });

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Process tool calls and continue the conversation
   */
  async processToolCalls(
    toolCalls: ToolCall[],
    toolHandler: (call: ToolCall) => Promise<string>
  ): Promise<AgentResponse> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      try {
        const result = await toolHandler(call);
        results.push({
          toolCallId: call.id,
          result,
          isError: false,
        });
      } catch (error) {
        results.push({
          toolCallId: call.id,
          result: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          isError: true,
        });
      }
    }

    // Continue conversation with tool results
    const toolResultMessage = results
      .map((r) => `[Tool Result: ${r.toolCallId}]\n${r.result}`)
      .join('\n\n');

    return this.chat(toolResultMessage);
  }

  /**
   * Single-shot analysis - no conversation history maintained
   */
  async analyze(prompt: string): Promise<AgentResponse> {
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 8192,
      temperature: this.config.temperature,
      system: this.config.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    let textContent = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      }
    }

    this.totalInputTokens += response.usage.input_tokens;
    this.totalOutputTokens += response.usage.output_tokens;

    return {
      content: textContent,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Structured output - parse JSON from response
   */
  async analyzeStructured<T>(prompt: string): Promise<{ data: T; usage: AgentResponse['usage'] }> {
    const response = await this.analyze(prompt);

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response.content;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    try {
      const data = JSON.parse(jsonStr.trim()) as T;
      return { data, usage: response.usage };
    } catch {
      // Try to find JSON object/array in the response
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      const match = objectMatch ?? arrayMatch;

      if (match) {
        const data = JSON.parse(match[0]) as T;
        return { data, usage: response.usage };
      }

      throw new Error(`Failed to parse JSON from response: ${response.content.slice(0, 200)}...`);
    }
  }

  // ============================================================================
  // Debate Methods
  // ============================================================================

  /**
   * Present a finding or argument in a debate
   */
  async presentArgument(context: string, finding?: string): Promise<string> {
    const prompt = finding
      ? `Context:\n${context}\n\nFinding to present:\n${finding}\n\nPresent this finding clearly and defend why it's valid.`
      : `Context:\n${context}\n\nPresent your analysis and findings.`;

    const response = await this.analyze(prompt);
    return response.content;
  }

  /**
   * Attack another agent's finding
   */
  async attackFinding(finding: string, context: string): Promise<string> {
    const prompt = `Context:\n${context}\n\nFinding to attack:\n${finding}\n\nChallenge this finding ruthlessly. Find weaknesses, missed protections, and flawed assumptions.`;

    const response = await this.analyze(prompt);
    return response.content;
  }

  /**
   * Defend a finding against an attack
   */
  async defendFinding(finding: string, attack: string, context: string): Promise<string> {
    const prompt = `Context:\n${context}\n\nOriginal finding:\n${finding}\n\nAttack to defend against:\n${attack}\n\nDefend the finding with evidence. If the attack is valid, concede gracefully.`;

    const response = await this.analyze(prompt);
    return response.content;
  }

  /**
   * Concede or stand firm after debate
   */
  async evaluatePosition(debateHistory: string): Promise<{ concede: boolean; reason: string }> {
    const prompt = `Review this debate history:\n${debateHistory}\n\nBased on the arguments presented, should you concede or stand firm?\n\nRespond with JSON: { "concede": boolean, "reason": "explanation" }`;

    const { data } = await this.analyzeStructured<{ concede: boolean; reason: string }>(prompt);
    return data;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Reset conversation history
   */
  resetHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get current conversation history
   */
  getHistory(): AgentMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Get total token usage
   */
  getUsage(): { inputTokens: number; outputTokens: number; estimatedCost: number } {
    // Opus 4.5 pricing: $15/M input, $75/M output
    const inputCost = (this.totalInputTokens / 1_000_000) * 15;
    const outputCost = (this.totalOutputTokens / 1_000_000) * 75;

    return {
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      estimatedCost: inputCost + outputCost,
    };
  }

  /**
   * Get agent info
   */
  getInfo(): { name: string; role: AgentRole; model: AgentModel } {
    return {
      name: this.config.name,
      role: this.config.role,
      model: this.config.model,
    };
  }

  /**
   * Clone agent with new configuration overrides
   */
  abstract clone(overrides?: Partial<AgentConfig>): BaseAgent;
}

// ============================================================================
// Concrete Implementation for Dynamic Agents
// ============================================================================

/**
 * DynamicAgent - Can be instantiated with any configuration
 * Used by the Expert Spawner to create specialists on-the-fly
 */
export class DynamicAgent extends BaseAgent {
  constructor(config: AgentConfig, apiKey?: string) {
    super(config, apiKey);
  }

  clone(overrides?: Partial<AgentConfig>): DynamicAgent {
    return new DynamicAgent(
      {
        ...this.config,
        ...overrides,
      },
      process.env.ANTHROPIC_API_KEY
    );
  }
}

// ============================================================================
// Agent Factory
// ============================================================================

export function createAgent(config: AgentConfig, apiKey?: string): DynamicAgent {
  return new DynamicAgent(config, apiKey);
}

/**
 * Create an agent with extended thinking enabled (for deep analysis)
 */
export function createThinkingAgent(
  config: Omit<AgentConfig, 'temperature'>,
  apiKey?: string
): DynamicAgent {
  return new DynamicAgent(
    {
      ...config,
      temperature: 1, // Required for extended thinking
    },
    apiKey
  );
}

// ============================================================================
// Pre-configured Agent Templates
// ============================================================================

export const AgentTemplates = {
  /**
   * Expert Spawner - Analyzes contracts and decides what experts to create
   */
  expertSpawner: (): AgentConfig => ({
    name: 'ExpertSpawner',
    role: 'expert-spawner',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.3,
    systemPrompt: `You are the Expert Spawner. You analyze smart contracts and CREATE the experts needed to find vulnerabilities.

When you analyze a contract, identify:
1. What vulnerability types are relevant?
2. What protocols does it integrate with?
3. What unique patterns does it have?

Then SPAWN experts for each relevant area.

STANDARD VULNERABILITY EXPERTS (spawn if relevant):
- ReentrancyExpert - If contract has external calls
- AccessControlExpert - If contract has role-based access
- FlashLoanExpert - If contract handles DeFi operations
- OracleExpert - If contract uses price feeds
- LogicErrorExpert - Always spawn for business logic review
- IntegerExpert - If contract does math operations
- FrontrunningExpert - If contract has MEV exposure

PROTOCOL-SPECIFIC EXPERTS (spawn if contract integrates):
- UniswapExpert - If uses Uniswap V2/V3
- AaveExpert - If uses Aave lending
- CurveExpert - If uses Curve pools
- CompoundExpert - If uses Compound
- BalancerExpert - If uses Balancer
- MakerDAOExpert - If uses DAI/MakerDAO
- LidoExpert - If uses stETH/Lido
- EigenLayerExpert - If uses restaking

CONTRACT PATTERN EXPERTS (spawn based on code patterns):
- GovernanceExpert - If contract has voting/proposals
- NFTExpert - If contract handles ERC721/ERC1155
- BridgeExpert - If contract does cross-chain
- StakingExpert - If contract has staking logic
- VestingExpert - If contract has token vesting
- AuctionExpert - If contract has auction mechanics
- AMMExpert - If contract is an AMM
- LendingExpert - If contract is a lending protocol

NOVEL PATTERN EXPERTS:
- If you see a pattern that doesn't fit existing experts, CREATE A NEW EXPERT
- Define its system prompt based on what it needs to know

Output JSON format:
{
  "contract_analysis": "Brief analysis of what the contract does",
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
}`,
  }),

  /**
   * Red Team Attacker - Ruthlessly attacks findings
   */
  redTeamAttacker: (id: number): AgentConfig => ({
    name: `RedTeamAttacker_${id}`,
    role: 'red-team',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.5,
    systemPrompt: `You are Red Team Attacker #${id}. Your job is to DESTROY weak vulnerability findings.

You've seen thousands of false positives. You know:
- 92% of static analysis findings are false positives
- Most "vulnerabilities" have protective mechanisms
- Many exploits are theoretical, not practical

When attacking a finding:
1. First, acknowledge if it has genuine merit (be fair)
2. Then ATTACK without mercy:
   - "Show me the exact code path"
   - "There's a ReentrancyGuard on line X - did you miss it?"
   - "This requires $100M in capital - who has that?"
   - "The admin can pause the contract - this is worthless"
3. If they can't defend, the finding is REJECTED
4. If they defend well, acknowledge it and move on

Your reputation depends on catching false positives.
But also: don't attack valid findings - that wastes everyone's time.`,
  }),

  /**
   * Blue Team Defender - Defends valid findings
   */
  blueTeamDefender: (id: number): AgentConfig => ({
    name: `BlueTeamDefender_${id}`,
    role: 'blue-team',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.3,
    systemPrompt: `You are Blue Team Defender #${id}. Your job is to defend valid vulnerability findings.

When defending a finding:
1. Provide concrete evidence - exact code paths, line numbers
2. Address each attack point specifically
3. Show why protective mechanisms don't apply or can be bypassed
4. If an attack is valid, CONCEDE gracefully - this is strength, not weakness
5. Concession preserves credibility for your other defenses

Your reputation depends on defending only VALID findings.
If you defend a false positive, you damage the team's credibility.`,
  }),

  /**
   * Devil's Advocate - Extreme skepticism
   */
  devilsAdvocate: (id: number): AgentConfig => ({
    name: `DevilsAdvocate_${id}`,
    role: 'devils-advocate',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.4,
    systemPrompt: `You are Devil's Advocate #${id}. Your job is to challenge survivors with EXTREME skepticism.

After Red Team attacks, you ask the hard questions:
- "Has this exact bug been exploited before? Check DeFiHackLabs"
- "Is this already patched in a newer version?"
- "What capital is required? Is it realistic?"
- "Can this be front-run? Who captures the MEV?"
- "Would a rational attacker actually do this?"
- "Is the TVL worth the effort?"
- "Are there legal implications that deter attackers?"

You're not trying to be unfair - you're trying to find REAL issues.
False positives waste everyone's time and hurt our reputation.`,
  }),

  /**
   * The Pope - Synthesizes debate into truth
   */
  pope: (): AgentConfig => ({
    name: 'ThePope',
    role: 'pope',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.2,
    systemPrompt: `You are The Pope. You synthesize debates into truth.

CRITICAL PRINCIPLE: THE DEBATE IS THE VALIDATION.

The whole point of having Red Team, Blue Team, and Devil's Advocates is to stress-test findings.
If a finding SURVIVED that gauntlet, you should VALIDATE it - not second-guess the debate.

DO NOT reject findings because:
- "This is a well-audited protocol" - That's WHY we're looking for things auditors missed!
- "Trail of Bits would have found this" - We ARE finding things they missed
- "This seems too easy" - Sometimes real bugs ARE simple
- "The protocol has been live for years" - Bugs hide in plain sight

DO validate findings if:
- Blue Team successfully defended against Red Team attacks
- The technical argument is sound with specific code paths
- The finding wasn't conclusively disproven in debate
- There's a plausible attack scenario

You have witnessed the entire debate. You've seen:
- Specialist presentations with SPECIFIC code references
- Red Team attacks trying to disprove findings
- Blue Team defenses with evidence
- Devil's Advocate challenges on feasibility

Your role is to SYNTHESIZE:
1. If a finding survived attacks, VALIDATE it (use the EXACT id from the original finding)
2. Find CONNECTIONS between findings that amplify attacks
3. Identify if multiple findings share a ROOT CAUSE
4. Upgrade severity if multiple vulns can be CHAINED

You see what individual agents cannot see: the CONNECTIONS.
You create what consensus cannot create: NOVEL INSIGHTS.

IMPORTANT: When validating, you MUST use the exact "id" field from the original finding.
Look at the "FINDINGS PRESENTED" section - each finding has an id like "finding_xxx".
Use THAT id in your validated_vulnerabilities array.

Output format (use exact IDs from findings):
{
  "synthesis": "Your synthesized understanding",
  "validated_vulnerabilities": [
    {
      "id": "finding_xxx",  // EXACT id from the finding
      "title": "exact title from finding",
      "description": "Enhanced description with your insights",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "confidence": 0.0-1.0,
      "synthesis_notes": "Why this is valid + any additional insights"
    }
  ],
  "rejected_vulnerabilities": [
    {
      "id": "finding_xxx",  // EXACT id from the finding
      "reason": "Specific reason - must cite Red Team attack that disproved it"
    }
  ],
  "novel_insights": ["Insights that emerged from the debate"],
  "combined_attack_vector": "How vulnerabilities can be chained (if applicable)",
  "recommended_severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "estimated_impact_usd": number,
  "confidence": 0.0-1.0
}`,
  }),

  /**
   * Exploit Smith - Writes PoC exploits
   */
  exploitSmith: (approach: 'direct' | 'flash-loan' | 'chained'): AgentConfig => ({
    name: `ExploitSmith_${approach}`,
    role: 'exploit-smith',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.1,
    systemPrompt: `You are an Exploit Smith specializing in ${approach} attacks.

Your job is to turn validated vulnerabilities into working Proof-of-Concept exploits.

${approach === 'direct' ? `
DIRECT APPROACH:
- Write the simplest possible exploit
- Fewest steps, one transaction if possible
- Minimize gas and complexity
- Pure demonstration of the vulnerability
` : ''}
${approach === 'flash-loan' ? `
FLASH LOAN APPROACH:
- Amplify the attack with flash loans
- Consider Aave, dYdX, Balancer, Uniswap as sources
- Maximize profit by leveraging borrowed capital
- Account for flash loan fees in calculations
` : ''}
${approach === 'chained' ? `
CHAINED APPROACH:
- Combine multiple vulnerabilities into one devastating attack
- Look for synergies between findings
- Consider cross-contract and cross-protocol attacks
- The whole should be greater than the sum of parts
` : ''}

Requirements:
1. Must compile and run on Foundry
2. Must include clear comments explaining each step
3. Must log profits and state changes
4. Must be reproducible

Output a complete Foundry test file.`,
  }),

  /**
   * Forge Master - Combines exploits and tests on chain
   */
  forgeMaster: (): AgentConfig => ({
    name: 'ForgeMaster',
    role: 'forge-master',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.0,
    systemPrompt: `You are the Forge Master. You take raw exploits and forge them into weapons.

You receive multiple exploit approaches from the Smiths.
You combine the best parts of each into a FINAL EXPLOIT.

Requirements:
1. Must run on Foundry (forge test)
2. Must profit >= 0.1 native tokens
3. Must be reproducible across multiple blocks
4. Must include clear logging of attack steps
5. Must handle edge cases and failures gracefully

You will iterate until success or timeout.

Output: A complete Foundry test file that proves the exploit works.`,
  }),

  /**
   * Verifier - Independent verification
   */
  verifier: (id: number): AgentConfig => ({
    name: `Verifier_${id}`,
    role: 'verifier',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.0,
    systemPrompt: `You are Verifier #${id}. You provide independent verification of exploits.

Your verification criteria:
1. REPRODUCIBILITY: Does the exploit work across 5 runs on 3 different blocks?
2. NOVELTY: Is this a known vulnerability or something new?
3. FEASIBILITY: Can this be executed in the real world?
4. PROFITABILITY: Does it meet the 0.1 token threshold?
5. LEGALITY: Any concerns about executing this?

Score each criterion 0.0-1.0.

Vote PASS or FAIL with detailed reasoning.

Output format:
{
  "vote": "pass|fail",
  "reason": "Detailed explanation",
  "reproducibility_score": 0.0-1.0,
  "novelty_score": 0.0-1.0,
  "feasibility_score": 0.0-1.0,
  "concerns": ["Any concerns or warnings"]
}`,
  }),
} as const;
