/**
 * Immunefi Platform Client
 *
 * Fetches active bounty programs and submits vulnerability reports.
 * Uses the unofficial Immunefi data from GitHub + web scraping for submission.
 */

import type { PrioritizedBounty, ContractInfo, BountyAsset } from '../types/index.js';

interface ImmunefiProgram {
  id: string;
  project: string;
  slug: string;
  launchDate: string;
  updatedDate: string;
  maxBounty: number;
  programOverview?: string;
  rewardsBody?: string;
  assetsBodyV2?: string;
  ecosystem?: string[];
  productType?: string[];
  programType?: string[];
  language?: string[];
  features?: string[];
  performanceMetrics?: {
    medianResponseTime?: number;
    totalPaidAmount?: number;
  };
  // Source code locations
  githubRepo?: string;
}

interface SubmissionParams {
  program: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  proofOfConcept: string;
}

export class ImmunefiClient {
  private readonly PROGRAMS_URL = 'https://raw.githubusercontent.com/infosec-us-team/Immunefi-Bug-Bounty-Programs-Unofficial/main/immunefi-programs.json';
  private readonly IMMUNEFI_BASE = 'https://immunefi.com';
  private cachedPrograms: ImmunefiProgram[] | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_TTL = 3600000; // 1 hour

  // Fallback list - Mix of HIGH VALUE established + FRESH new programs
  // PRIORITY: Newer programs have less scrutiny = more likely to have bugs
  private readonly FALLBACK_PROGRAMS: ImmunefiProgram[] = [
    // === FRESH PROGRAMS (2025) - HIGH PRIORITY ===
    {
      id: 'usdt0',
      project: 'USDT0',
      slug: 'usdt0',
      launchDate: '2025-01-30',  // VERY FRESH
      updatedDate: '2025-01-30',
      maxBounty: 6000000,  // $6M bounty
      ecosystem: ['Ethereum'],
      assetsBodyV2: '', // Will need to fetch from their docs
      githubRepo: 'https://github.com/usdt0/contracts',
    },
    {
      id: 'capyfi',
      project: 'CapyFi',
      slug: 'capyfi',
      launchDate: '2025-11-19',  // FRESH
      updatedDate: '2025-11-19',
      maxBounty: 1000000,
      ecosystem: ['Ethereum'],
      assetsBodyV2: '',
    },
    {
      id: 'berachain',
      project: 'Berachain',
      slug: 'berachain',
      launchDate: '2025-02-06',  // FRESH
      updatedDate: '2025-02-06',
      maxBounty: 250000,
      ecosystem: ['Berachain'],
      assetsBodyV2: '',
    },
    {
      id: 'parallel',
      project: 'Parallel',
      slug: 'parallel',
      launchDate: '2025-10-02',  // FRESH
      updatedDate: '2025-10-02',
      maxBounty: 250000,
      ecosystem: ['Ethereum'],
      assetsBodyV2: '',
    },
    {
      id: 'zksync-os',
      project: 'ZKsync OS',
      slug: 'zksync-os',
      launchDate: '2025-11-24',  // VERY FRESH
      updatedDate: '2025-11-24',
      maxBounty: 100000,
      ecosystem: ['ZKsync'],
      assetsBodyV2: '',
      githubRepo: 'https://github.com/matter-labs',
    },
    // === HIGH VALUE ESTABLISHED (still worth checking) ===
    {
      id: 'makerdao',
      project: 'MakerDAO',
      slug: 'makerdao',
      launchDate: '2020-01-01',
      updatedDate: '2024-01-01',
      maxBounty: 10000000,
      ecosystem: ['Ethereum'],
      assetsBodyV2: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
    },
    {
      id: 'uniswap',
      project: 'Uniswap',
      slug: 'uniswap',
      launchDate: '2020-09-01',
      updatedDate: '2024-01-01',
      maxBounty: 3000000,
      ecosystem: ['Ethereum'],
      assetsBodyV2: '0x1F98431c8aD98523631AE4a59f267346ea31F984 0xE592427A0AEce92De3Edee1F18E0157C05861564',
    },
    {
      id: 'lido',
      project: 'Lido',
      slug: 'lido',
      launchDate: '2021-01-01',
      updatedDate: '2024-01-01',
      maxBounty: 2000000,
      ecosystem: ['Ethereum'],
      assetsBodyV2: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84 0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32',
    },
    {
      id: 'aave',
      project: 'Aave',
      slug: 'aave',
      launchDate: '2020-06-01',
      updatedDate: '2024-01-01',
      maxBounty: 1000000,
      ecosystem: ['Ethereum', 'Polygon', 'Avalanche'],
      assetsBodyV2: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    },
  ];

  /**
   * Fetch all active bounty programs from Immunefi
   */
  async fetchActiveBounties(): Promise<PrioritizedBounty[]> {
    let programs: ImmunefiProgram[];

    try {
      programs = await this.fetchPrograms();
    } catch (error) {
      console.log('Using fallback bounty list');
      programs = this.FALLBACK_PROGRAMS;
    }

    // Convert to our format and enrich with contract data
    const bounties: PrioritizedBounty[] = [];

    for (const program of programs) {
      try {
        const bounty = await this.enrichProgram(program);
        if (bounty) {
          bounties.push(bounty);
        }
      } catch (error) {
        // Skip programs we can't process
        console.error(`Error processing ${program.project}:`, error);
      }
    }

    return bounties;
  }

  /**
   * Get detailed info for a specific program
   */
  async getProgram(slug: string): Promise<PrioritizedBounty | null> {
    const programs = await this.fetchPrograms();
    const program = programs.find((p) => p.slug === slug || p.id === slug);
    if (!program) return null;
    return this.enrichProgram(program);
  }

  /**
   * Submit a vulnerability report to Immunefi
   * Note: This requires manual browser auth - we prepare the report for submission
   */
  async submitReport(params: SubmissionParams): Promise<{ success: boolean; reportId?: string; manualUrl?: string }> {
    // Generate the formatted report
    const report = this.formatReport(params);

    // For now, we prepare the report and provide the manual submission URL
    // Full automation would require browser automation (Playwright) with auth
    const programSlug = params.program.toLowerCase().replace(/\s+/g, '-');
    const manualUrl = `${this.IMMUNEFI_BASE}/bounty/${programSlug}/submit`;

    console.log('\n' + '='.repeat(80));
    console.log('IMMUNEFI SUBMISSION READY');
    console.log('='.repeat(80));
    console.log(`Program: ${params.program}`);
    console.log(`Severity: ${params.severity.toUpperCase()}`);
    console.log(`Submit at: ${manualUrl}`);
    console.log('='.repeat(80));
    console.log('\nREPORT CONTENT:\n');
    console.log(report);
    console.log('\n' + '='.repeat(80));

    // Save report to file for easy copy-paste
    const reportPath = `./reports/submission-${Date.now()}.md`;
    try {
      const fs = await import('fs/promises');
      await fs.mkdir('./reports', { recursive: true });
      await fs.writeFile(reportPath, report);
      console.log(`Report saved to: ${reportPath}`);
    } catch {
      // Ignore file save errors
    }

    return {
      success: true,
      manualUrl,
    };
  }

  /**
   * Check submission status (would require auth)
   */
  async checkSubmissionStatus(reportId: string): Promise<'pending' | 'reviewing' | 'accepted' | 'rejected' | 'paid'> {
    // This would require authenticated API access
    console.log(`Checking status for report ${reportId} - requires manual check`);
    return 'pending';
  }

  /**
   * Get payout instructions for accepted bounty
   */
  getPayoutInstructions(): string {
    return `
╔═══════════════════════════════════════════════════════════════════════════════╗
║                        BOUNTY PAYOUT INSTRUCTIONS                              ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  When your vulnerability is accepted:                                         ║
║                                                                               ║
║  1. AWAIT CONFIRMATION                                                        ║
║     • Immunefi team will verify the finding                                   ║
║     • Project team will confirm impact and severity                           ║
║     • Typical timeline: 1-4 weeks                                             ║
║                                                                               ║
║  2. BOUNTY NEGOTIATION                                                        ║
║     • Severity may be adjusted based on actual impact                         ║
║     • You can negotiate if you disagree with assessment                       ║
║     • Provide additional PoC if needed to demonstrate impact                  ║
║                                                                               ║
║  3. PAYOUT PROCESS                                                            ║
║     • Immunefi will request your wallet address                               ║
║     • Payments typically in USDC/USDT on Ethereum or preferred chain          ║
║     • Some projects pay in native tokens (may include vesting)                ║
║                                                                               ║
║  4. TAX CONSIDERATIONS                                                        ║
║     • Bug bounty income is taxable in most jurisdictions                      ║
║     • Keep records of all submissions and payments                            ║
║     • Consider consulting a crypto-savvy tax professional                     ║
║                                                                               ║
║  5. IMPORTANT LINKS                                                           ║
║     • Immunefi Dashboard: https://immunefi.com/dashboard                      ║
║     • Payment Status: https://immunefi.com/hackers/payments                   ║
║     • Support: https://immunefi.com/support                                   ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
    `;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async fetchPrograms(): Promise<ImmunefiProgram[]> {
    // Return cached if fresh
    if (this.cachedPrograms && Date.now() - this.cacheTime < this.CACHE_TTL) {
      return this.cachedPrograms;
    }

    try {
      const response = await fetch(this.PROGRAMS_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch programs: ${response.status}`);
      }
      const programs = (await response.json()) as ImmunefiProgram[];
      this.cachedPrograms = programs;
      this.cacheTime = Date.now();
      return programs;
    } catch (error) {
      console.error('Error fetching Immunefi programs:', error);
      // Return cached even if stale
      if (this.cachedPrograms) {
        return this.cachedPrograms;
      }
      throw error;
    }
  }

  private async enrichProgram(program: ImmunefiProgram): Promise<PrioritizedBounty | null> {
    // Parse assets from the program
    const contracts = await this.parseContracts(program);
    if (contracts.length === 0) {
      return null; // Skip programs without smart contract assets
    }

    // Parse reward structure
    const severity = this.parseRewards(program);

    // Calculate estimated difficulty
    const difficulty = this.estimateDifficulty(program, contracts);

    // Parse scope
    const { inScope, outOfScope } = this.parseScope(program);

    return {
      id: program.id,
      platform: 'immunefi',
      name: program.project,
      url: `${this.IMMUNEFI_BASE}/bounty/${program.slug}`,
      maxReward: program.maxBounty,
      assets: contracts.map((c) => ({
        type: 'smart_contract' as const,
        target: c.address,
        description: c.name,
      })),
      inScope,
      outOfScope,
      severity,
      launchDate: new Date(program.launchDate),
      lastUpdated: new Date(program.updatedDate),
      totalPaid: program.performanceMetrics?.totalPaidAmount,
      active: true,
      priorityScore: 0, // Calculated later
      reasons: [],
      estimatedDifficulty: difficulty,
      contracts,
    };
  }

  private async parseContracts(program: ImmunefiProgram): Promise<ContractInfo[]> {
    const contracts: ContractInfo[] = [];

    // Try to parse assetsBodyV2 for contract addresses
    if (program.assetsBodyV2) {
      // Look for Ethereum addresses in the assets body
      const addressRegex = /0x[a-fA-F0-9]{40}/g;
      const addresses = program.assetsBodyV2.match(addressRegex) || [];

      for (const address of [...new Set(addresses)]) {
        // Try to fetch source code from Etherscan
        const sourceCode = await this.fetchContractSource(address);

        // Add contract even without source - we'll fetch later or skip analysis
        contracts.push({
          address,
          name: `${program.project}-${address.slice(0, 8)}`,
          chain: 'ethereum',
          sourceCode: sourceCode || `// Source code not available for ${address}\n// Fetch from Etherscan with API key or check GitHub`,
          verified: !!sourceCode,
          tvl: undefined,
        });
      }
    }

    return contracts;
  }

  private async fetchContractSource(address: string): Promise<string | null> {
    const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || 'YourApiKeyToken';

    // Rate limiting: wait between requests
    await this.rateLimitDelay();

    // Try v1 API first (more reliable for source code)
    const apis = [
      `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_API_KEY}`,
      `https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_API_KEY}`,
    ];

    for (const url of apis) {
      try {
        const response = await fetch(url);
        const data = (await response.json()) as {
          status: string;
          message: string;
          result: Array<{ SourceCode: string; ContractName: string }> | string;
        };

        // Handle rate limiting
        if (data.message === 'NOTOK' && typeof data.result === 'string' && data.result.includes('rate limit')) {
          console.log(`[etherscan] Rate limited, waiting 1s...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        if (data.status === '1' && Array.isArray(data.result) && data.result[0]?.SourceCode) {
          const source = data.result[0].SourceCode;
          // Skip if empty or not verified
          if (source && source.length > 10 && !source.startsWith('0x')) {
            console.log(`[etherscan] Fetched source for ${address}: ${data.result[0].ContractName}`);
            return source;
          }
        }
      } catch (err) {
        // Try next API
        continue;
      }
    }

    // Try Sourcify as fallback
    try {
      const sourcifyUrl = `https://sourcify.dev/server/files/1/${address}`;
      const response = await fetch(sourcifyUrl);
      if (response.ok) {
        const files = await response.json() as Array<{name: string; content: string}>;
        const mainFile = files.find(f => f.name.endsWith('.sol'));
        if (mainFile) {
          console.log(`[sourcify] Fetched source for ${address}`);
          return mainFile.content;
        }
      }
    } catch {
      // Sourcify failed, that's ok
    }

    console.log(`[etherscan] No verified source for ${address}`);
    return null;
  }

  private lastRequestTime = 0;
  private async rateLimitDelay(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minDelay = 250; // 4 requests per second max

    if (timeSinceLastRequest < minDelay) {
      await new Promise(resolve => setTimeout(resolve, minDelay - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();
  }

  private parseRewards(program: ImmunefiProgram): PrioritizedBounty['severity'] {
    // Default reward structure based on max bounty
    const max = program.maxBounty;
    return {
      critical: { min: max * 0.5, max: max },
      high: { min: max * 0.1, max: max * 0.5 },
      medium: { min: max * 0.01, max: max * 0.1 },
      low: { min: 0, max: max * 0.01 },
    };
  }

  private estimateDifficulty(
    program: ImmunefiProgram,
    contracts: ContractInfo[]
  ): 'low' | 'medium' | 'high' | 'extreme' {
    // Factors that increase difficulty:
    // - High total paid (bugs already found)
    // - Large codebase
    // - Old program (already audited many times)
    // - Complex ecosystem (multiple chains, many integrations)

    let difficultyScore = 0;

    // High payout history = already well-audited
    if (program.performanceMetrics?.totalPaidAmount) {
      if (program.performanceMetrics.totalPaidAmount > 1000000) difficultyScore += 3;
      else if (program.performanceMetrics.totalPaidAmount > 100000) difficultyScore += 2;
      else difficultyScore += 1;
    }

    // Old programs are harder
    const ageMonths = (Date.now() - new Date(program.launchDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (ageMonths > 24) difficultyScore += 2;
    else if (ageMonths > 12) difficultyScore += 1;

    // Large codebases are harder
    const totalLines = contracts.reduce((sum, c) => sum + (c.sourceCode?.split('\n').length || 0), 0);
    if (totalLines > 10000) difficultyScore += 2;
    else if (totalLines > 3000) difficultyScore += 1;

    // Multi-chain = harder
    if (program.ecosystem && program.ecosystem.length > 3) difficultyScore += 2;

    if (difficultyScore >= 6) return 'extreme';
    if (difficultyScore >= 4) return 'high';
    if (difficultyScore >= 2) return 'medium';
    return 'low';
  }

  private parseScope(program: ImmunefiProgram): { inScope: string[]; outOfScope: string[] } {
    // Would parse programOverview for scope details
    return {
      inScope: ['Smart Contracts', 'Core Protocol'],
      outOfScope: ['Frontend', 'Already known issues', 'Centralization risks'],
    };
  }

  private formatReport(params: SubmissionParams): string {
    return `# ${params.title}

## Severity
**${params.severity.toUpperCase()}**

## Summary
${params.description}

## Vulnerability Details
${params.description}

## Impact
This vulnerability could result in loss of user funds or protocol insolvency.

## Proof of Concept
\`\`\`solidity
${params.proofOfConcept}
\`\`\`

## Recommended Mitigation
[To be added based on specific vulnerability]

---
*Report generated by The Vulnerability Swarm*
*https://github.com/anthropics/bounty-agents*
`;
  }
}
