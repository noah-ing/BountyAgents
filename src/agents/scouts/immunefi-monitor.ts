/**
 * Immunefi Monitor Scout
 *
 * Stage 1 of The Vulnerability Swarm.
 * Monitors Immunefi for bounties, fetches contract data, and prioritizes targets.
 */

import { createAgent, AgentTemplates, DynamicAgent } from '../base-agent.js';
import type {
  BountyProgram,
  BountyAsset,
  PrioritizedBounty,
  ContractInfo,
  AgentConfig,
} from '../../types/index.js';

// ============================================================================
// Scout Agent Configuration
// ============================================================================

const IMMUNEFI_SCOUT_CONFIG: AgentConfig = {
  name: 'ImmunefiScout',
  role: 'scout',
  model: 'claude-sonnet-4-20250514', // Sonnet for speed on scout tasks
  temperature: 0.2,
  systemPrompt: `You are an Immunefi Scout. Your job is to identify the most promising bug bounties.

When analyzing bounties, consider:
1. REWARD SIZE: Higher max rewards = higher priority
2. TVL: More value locked = more impact = higher severity payouts
3. CONTRACT COMPLEXITY: More complex = more likely to have bugs
4. FRESHNESS: Newer programs less audited
5. SCOPE: More contracts in scope = more attack surface
6. COMPETITION: Less popular programs = less competition

You prioritize bounties that maximize:
- Expected Value = P(finding bug) * P(valid) * Expected Payout
- Lower competition increases P(finding bug)
- Verified, well-scoped contracts increase P(valid)
- High max bounty increases Expected Payout

Output format for prioritization:
{
  "priority_score": 0.0-1.0,
  "reasons": ["reason1", "reason2"],
  "estimated_difficulty": "low|medium|high|extreme",
  "recommended_approach": "Brief strategy"
}`,
};

const CONTRACT_FETCHER_CONFIG: AgentConfig = {
  name: 'ContractFetcher',
  role: 'scout',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.1,
  systemPrompt: `You are a Contract Fetcher. You help identify and analyze smart contract source code.

When given contract addresses or repository URLs:
1. Identify all relevant contract files
2. Note the compiler version and optimization settings
3. Identify external dependencies (OpenZeppelin, Uniswap, etc.)
4. Note any proxy patterns that affect analysis

Your goal is to prepare contracts for analysis by the vulnerability specialists.`,
};

const PRIORITY_RANKER_CONFIG: AgentConfig = {
  name: 'PriorityRanker',
  role: 'scout',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.3,
  systemPrompt: `You are a Priority Ranker. You analyze a list of bug bounties and rank them.

Ranking criteria (in order of importance):
1. Expected Value = Reward * P(finding) * P(valid)
2. Time to analyze (prefer contracts we can analyze quickly)
3. Competition level (prefer less competitive programs)
4. Our expertise match (prefer DeFi, lending, AMM - our strength)

Output a ranked list with scores and reasoning.`,
};

// ============================================================================
// Scout Swarm
// ============================================================================

export class ScoutSwarm {
  private immunefiScout: DynamicAgent;
  private contractFetcher: DynamicAgent;
  private priorityRanker: DynamicAgent;

  constructor() {
    this.immunefiScout = createAgent(IMMUNEFI_SCOUT_CONFIG);
    this.contractFetcher = createAgent(CONTRACT_FETCHER_CONFIG);
    this.priorityRanker = createAgent(PRIORITY_RANKER_CONFIG);
  }

  /**
   * Fetch and prioritize bounties from Immunefi
   */
  async discoverBounties(rawBounties: BountyProgram[]): Promise<PrioritizedBounty[]> {
    console.log(`[Scout] Analyzing ${rawBounties.length} bounties...`);

    // Filter to active smart contract bounties
    const smartContractBounties = rawBounties.filter(
      (b) => b.active && b.assets.some((a) => a.type === 'smart_contract')
    );

    console.log(`[Scout] ${smartContractBounties.length} active smart contract programs`);

    // Analyze and prioritize each bounty
    const prioritized: PrioritizedBounty[] = [];

    for (const bounty of smartContractBounties) {
      try {
        const analysis = await this.analyzeBounty(bounty);
        prioritized.push({
          ...bounty,
          ...analysis,
          contracts: [], // Will be populated by contract fetcher
        });
      } catch (error) {
        console.error(`[Scout] Error analyzing ${bounty.name}:`, error);
      }
    }

    // Sort by priority score
    prioritized.sort((a, b) => b.priorityScore - a.priorityScore);

    return prioritized;
  }

  /**
   * Analyze a single bounty for prioritization
   */
  private async analyzeBounty(
    bounty: BountyProgram
  ): Promise<{ priorityScore: number; reasons: string[]; estimatedDifficulty: PrioritizedBounty['estimatedDifficulty'] }> {
    const prompt = `Analyze this Immunefi bounty for priority:

Name: ${bounty.name}
Max Reward: $${bounty.maxReward.toLocaleString()}
Platform: ${bounty.platform}
Launch Date: ${bounty.launchDate.toISOString().split('T')[0]}

Assets in Scope:
${bounty.assets.map((a) => `- ${a.type}: ${a.target}`).join('\n')}

In Scope:
${bounty.inScope.join('\n')}

Out of Scope:
${bounty.outOfScope.join('\n')}

Severity Rewards:
- Critical: $${bounty.severity.critical.min.toLocaleString()} - $${bounty.severity.critical.max.toLocaleString()}
- High: $${bounty.severity.high.min.toLocaleString()} - $${bounty.severity.high.max.toLocaleString()}
- Medium: $${bounty.severity.medium.min.toLocaleString()} - $${bounty.severity.medium.max.toLocaleString()}
- Low: $${bounty.severity.low.min.toLocaleString()} - $${bounty.severity.low.max.toLocaleString()}

Provide your prioritization analysis as JSON.`;

    const { data } = await this.immunefiScout.analyzeStructured<{
      priority_score: number;
      reasons: string[];
      estimated_difficulty: string;
      recommended_approach: string;
    }>(prompt);

    return {
      priorityScore: data.priority_score,
      reasons: data.reasons,
      estimatedDifficulty: data.estimated_difficulty as PrioritizedBounty['estimatedDifficulty'],
    };
  }

  /**
   * Fetch contract source code for a bounty
   */
  async fetchContracts(bounty: PrioritizedBounty): Promise<ContractInfo[]> {
    console.log(`[Scout] Fetching contracts for ${bounty.name}...`);

    const contracts: ContractInfo[] = [];

    for (const asset of bounty.assets.filter((a) => a.type === 'smart_contract')) {
      // Asset target could be an address or a repo URL
      const isAddress = /^0x[a-fA-F0-9]{40}$/.test(asset.target);

      if (isAddress) {
        // This will be handled by the Etherscan MCP server
        contracts.push({
          address: asset.target,
          name: asset.description ?? 'Unknown',
          chain: this.detectChain(asset.target, bounty),
          sourceCode: '', // To be fetched by MCP server
          verified: false,
        });
      } else {
        // GitHub repo - will need to clone and analyze
        console.log(`[Scout] GitHub repo detected: ${asset.target}`);
        // For now, mark as needing repo fetch
        contracts.push({
          address: 'repo:' + asset.target,
          name: asset.description ?? asset.target.split('/').pop() ?? 'Unknown',
          chain: 'multiple',
          sourceCode: '', // To be fetched from repo
          verified: true,
        });
      }
    }

    return contracts;
  }

  /**
   * Detect which chain a contract is on
   */
  private detectChain(address: string, bounty: BountyProgram): string {
    // Check bounty scope for chain hints
    const scopeText = [...bounty.inScope, ...bounty.assets.map((a) => a.description ?? '')].join(' ').toLowerCase();

    if (scopeText.includes('arbitrum')) return 'arbitrum';
    if (scopeText.includes('optimism')) return 'optimism';
    if (scopeText.includes('polygon')) return 'polygon';
    if (scopeText.includes('bsc') || scopeText.includes('binance')) return 'bsc';
    if (scopeText.includes('avalanche') || scopeText.includes('avax')) return 'avalanche';
    if (scopeText.includes('base')) return 'base';

    // Default to mainnet
    return 'ethereum';
  }

  /**
   * Rank a list of prioritized bounties for final selection
   */
  async rankBounties(bounties: PrioritizedBounty[], topN: number = 10): Promise<PrioritizedBounty[]> {
    console.log(`[Scout] Ranking ${bounties.length} bounties...`);

    const summaries = bounties.slice(0, 50).map((b, i) =>
      `${i + 1}. ${b.name} - Max: $${b.maxReward.toLocaleString()}, Score: ${b.priorityScore.toFixed(2)}, Difficulty: ${b.estimatedDifficulty}`
    );

    const prompt = `Rank these bounties for our vulnerability swarm to attack:

${summaries.join('\n')}

Our strengths:
- DeFi protocols (lending, AMM, staking)
- Reentrancy and flash loan attacks
- Oracle manipulation
- Access control issues

Rank the top ${topN} bounties we should focus on.

Output as JSON:
{
  "rankings": [
    { "index": 1, "name": "...", "score": 0.95, "reason": "Why this is a good target" }
  ]
}`;

    const { data } = await this.priorityRanker.analyzeStructured<{
      rankings: Array<{ index: number; name: string; score: number; reason: string }>;
    }>(prompt);

    // Reorder bounties based on ranking
    const ranked: PrioritizedBounty[] = [];
    for (const rank of data.rankings) {
      const bounty = bounties.find((b) => b.name === rank.name) ?? bounties[rank.index - 1];
      if (bounty) {
        bounty.priorityScore = rank.score;
        bounty.reasons = [rank.reason, ...bounty.reasons];
        ranked.push(bounty);
      }
    }

    return ranked.slice(0, topN);
  }

  /**
   * Get total usage across all scouts
   */
  getTotalUsage(): { inputTokens: number; outputTokens: number; estimatedCost: number } {
    const scouts = [this.immunefiScout, this.contractFetcher, this.priorityRanker];
    return scouts.reduce(
      (acc, scout) => {
        const usage = scout.getUsage();
        return {
          inputTokens: acc.inputTokens + usage.inputTokens,
          outputTokens: acc.outputTokens + usage.outputTokens,
          estimatedCost: acc.estimatedCost + usage.estimatedCost,
        };
      },
      { inputTokens: 0, outputTokens: 0, estimatedCost: 0 }
    );
  }
}

// ============================================================================
// Immunefi Data Parsing
// ============================================================================

/**
 * Parse raw Immunefi bounty data from ibb CLI or API
 */
export function parseImmunefiData(rawData: ImmunefiRawProgram[]): BountyProgram[] {
  return rawData.map((raw) => ({
    id: raw.id ?? raw.project ?? '',
    platform: 'immunefi' as const,
    name: raw.project ?? raw.name ?? 'Unknown',
    url: raw.url ?? `https://immunefi.com/bounty/${raw.project}`,
    maxReward: parseReward(raw.maximum_reward ?? raw.maxBounty ?? '0'),
    assets: parseAssets(raw.assets ?? []),
    inScope: raw.in_scope ?? [],
    outOfScope: raw.out_of_scope ?? [],
    severity: {
      critical: { min: parseReward(raw.critical_min ?? '0'), max: parseReward(raw.critical_max ?? raw.maximum_reward ?? '0') },
      high: { min: parseReward(raw.high_min ?? '0'), max: parseReward(raw.high_max ?? '0') },
      medium: { min: parseReward(raw.medium_min ?? '0'), max: parseReward(raw.medium_max ?? '0') },
      low: { min: parseReward(raw.low_min ?? '0'), max: parseReward(raw.low_max ?? '0') },
    },
    launchDate: new Date(raw.launch_date ?? raw.launchedAt ?? Date.now()),
    lastUpdated: new Date(raw.updated_at ?? raw.updatedAt ?? Date.now()),
    totalPaid: parseReward(raw.total_paid ?? '0'),
    active: raw.status === 'active' || raw.active !== false,
  }));
}

interface ImmunefiRawProgram {
  id?: string;
  project?: string;
  name?: string;
  url?: string;
  maximum_reward?: string;
  maxBounty?: string;
  assets?: Array<{ type?: string; target?: string; description?: string }>;
  in_scope?: string[];
  out_of_scope?: string[];
  critical_min?: string;
  critical_max?: string;
  high_min?: string;
  high_max?: string;
  medium_min?: string;
  medium_max?: string;
  low_min?: string;
  low_max?: string;
  launch_date?: string;
  launchedAt?: string;
  updated_at?: string;
  updatedAt?: string;
  total_paid?: string;
  status?: string;
  active?: boolean;
}

function parseReward(reward: string | number): number {
  if (typeof reward === 'number') return reward;
  // Remove currency symbols, commas, and parse
  const cleaned = reward.replace(/[$,]/g, '').trim();
  const match = cleaned.match(/[\d.]+/);
  if (!match) return 0;

  let value = parseFloat(match[0]);

  // Handle K, M suffixes
  if (cleaned.toLowerCase().includes('k')) value *= 1000;
  if (cleaned.toLowerCase().includes('m')) value *= 1000000;

  return value;
}

function parseAssets(assets: Array<{ type?: string; target?: string; description?: string }>): BountyAsset[] {
  return assets.map((a) => ({
    type: (a.type?.toLowerCase().includes('smart') ? 'smart_contract' : a.type?.toLowerCase().includes('web') ? 'websites_and_applications' : 'blockchain_dlt') as BountyAsset['type'],
    target: a.target ?? '',
    description: a.description,
  }));
}

// ============================================================================
// Exports
// ============================================================================

export function createScoutSwarm(): ScoutSwarm {
  return new ScoutSwarm();
}
