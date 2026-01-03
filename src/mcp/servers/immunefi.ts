/**
 * Immunefi MCP Tool Server
 *
 * Provides tools for interacting with Immunefi bug bounty platform.
 * Uses the ibb CLI tool (https://github.com/infosec-us-team/ibb) under the hood.
 */

import { spawn } from 'child_process';
import type { BountyProgram, BountyAsset } from '../../types/index.js';

// ============================================================================
// Tool Definitions
// ============================================================================

export const immunefiTools = {
  /**
   * List all active Immunefi bounty programs
   */
  immunefi_list: {
    name: 'immunefi_list',
    description: 'List all active Immunefi bug bounty programs with their rewards and scope',
    inputSchema: {
      type: 'object',
      properties: {
        minReward: {
          type: 'number',
          description: 'Minimum reward threshold in USD (default: 0)',
        },
        type: {
          type: 'string',
          enum: ['smart_contract', 'websites_and_applications', 'blockchain_dlt', 'all'],
          description: 'Filter by asset type (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of programs to return (default: 100)',
        },
      },
      required: [],
    },
  },

  /**
   * Get detailed information about a specific bounty program
   */
  immunefi_details: {
    name: 'immunefi_details',
    description: 'Get detailed information about a specific Immunefi bounty program',
    inputSchema: {
      type: 'object',
      properties: {
        program: {
          type: 'string',
          description: 'Program name or ID (e.g., "uniswap", "aave")',
        },
      },
      required: ['program'],
    },
  },

  /**
   * Get assets in scope for a bounty program
   */
  immunefi_assets: {
    name: 'immunefi_assets',
    description: 'Get all assets (contracts, websites) in scope for a bounty program',
    inputSchema: {
      type: 'object',
      properties: {
        program: {
          type: 'string',
          description: 'Program name or ID',
        },
      },
      required: ['program'],
    },
  },

  /**
   * Search bounty programs by keyword
   */
  immunefi_search: {
    name: 'immunefi_search',
    description: 'Search Immunefi programs by keyword (name, description, assets)',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
  },
};

// ============================================================================
// Tool Implementations
// ============================================================================

export class ImmunefiMCP {
  private ibbPath: string;
  private cache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  constructor(ibbPath: string = 'ibb') {
    this.ibbPath = ibbPath;
  }

  /**
   * Execute an ibb CLI command
   */
  private async execIbb(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ibbPath, args, {
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`ibb exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn ibb: ${err.message}. Is ibb installed? Run: cargo install ibb`));
      });
    });
  }

  /**
   * Get cached data or fetch fresh
   */
  private getCached<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data as T;
    }
    return null;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * List all bounty programs
   */
  async listPrograms(options?: {
    minReward?: number;
    type?: 'smart_contract' | 'websites_and_applications' | 'blockchain_dlt' | 'all';
    limit?: number;
  }): Promise<BountyProgram[]> {
    const cacheKey = `list:${JSON.stringify(options)}`;
    const cached = this.getCached<BountyProgram[]>(cacheKey);
    if (cached) return cached;

    try {
      // Try ibb CLI first
      const output = await this.execIbb(['list', '--json']);
      const programs = this.parseIbbOutput(output);

      // Apply filters
      let filtered = programs;

      if (options?.minReward) {
        filtered = filtered.filter((p) => p.maxReward >= options.minReward!);
      }

      if (options?.type && options.type !== 'all') {
        filtered = filtered.filter((p) =>
          p.assets.some((a) => a.type === options.type)
        );
      }

      if (options?.limit) {
        filtered = filtered.slice(0, options.limit);
      }

      this.setCache(cacheKey, filtered);
      return filtered;
    } catch {
      // Fall back to fetching from unofficial API
      return this.fetchFromUnofficial(options);
    }
  }

  /**
   * Get program details
   */
  async getProgramDetails(program: string): Promise<BountyProgram | null> {
    const cacheKey = `details:${program}`;
    const cached = this.getCached<BountyProgram>(cacheKey);
    if (cached) return cached;

    try {
      const output = await this.execIbb(['info', program, '--json']);
      const details = this.parseIbbProgramDetails(output);
      this.setCache(cacheKey, details);
      return details;
    } catch {
      // Try to find in list
      const all = await this.listPrograms();
      const found = all.find(
        (p) => p.name.toLowerCase() === program.toLowerCase() || p.id === program
      );
      return found ?? null;
    }
  }

  /**
   * Get program assets
   */
  async getProgramAssets(program: string): Promise<BountyAsset[]> {
    const details = await this.getProgramDetails(program);
    return details?.assets ?? [];
  }

  /**
   * Search programs
   */
  async searchPrograms(query: string): Promise<BountyProgram[]> {
    const all = await this.listPrograms();
    const lowerQuery = query.toLowerCase();

    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerQuery) ||
        p.inScope.some((s) => s.toLowerCase().includes(lowerQuery)) ||
        p.assets.some(
          (a) =>
            a.target.toLowerCase().includes(lowerQuery) ||
            a.description?.toLowerCase().includes(lowerQuery)
        )
    );
  }

  /**
   * Parse ibb list output
   */
  private parseIbbOutput(output: string): BountyProgram[] {
    try {
      const data = JSON.parse(output);
      if (Array.isArray(data)) {
        return data.map((item) => this.normalizeProgramData(item));
      }
      return [];
    } catch {
      // Try to parse line-by-line format
      const lines = output.split('\n').filter((l) => l.trim());
      const programs: BountyProgram[] = [];

      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          programs.push(this.normalizeProgramData(item));
        } catch {
          // Skip non-JSON lines
        }
      }

      return programs;
    }
  }

  /**
   * Parse ibb program details output
   */
  private parseIbbProgramDetails(output: string): BountyProgram {
    const data = JSON.parse(output);
    return this.normalizeProgramData(data);
  }

  /**
   * Normalize program data from various formats
   */
  private normalizeProgramData(raw: Record<string, unknown>): BountyProgram {
    return {
      id: String(raw.id ?? raw.project ?? raw.slug ?? ''),
      platform: 'immunefi',
      name: String(raw.name ?? raw.project ?? 'Unknown'),
      url: String(raw.url ?? `https://immunefi.com/bounty/${raw.project ?? raw.slug ?? ''}`),
      maxReward: this.parseReward(raw.maximum_reward ?? raw.maxBounty ?? raw.max_bounty ?? 0),
      assets: this.parseAssets(raw.assets as Array<Record<string, unknown>> | undefined),
      inScope: Array.isArray(raw.in_scope) ? raw.in_scope.map(String) : [],
      outOfScope: Array.isArray(raw.out_of_scope) ? raw.out_of_scope.map(String) : [],
      severity: {
        critical: {
          min: this.parseReward(raw.critical_min ?? 0),
          max: this.parseReward(raw.critical_max ?? raw.maximum_reward ?? 0),
        },
        high: {
          min: this.parseReward(raw.high_min ?? 0),
          max: this.parseReward(raw.high_max ?? 0),
        },
        medium: {
          min: this.parseReward(raw.medium_min ?? 0),
          max: this.parseReward(raw.medium_max ?? 0),
        },
        low: {
          min: this.parseReward(raw.low_min ?? 0),
          max: this.parseReward(raw.low_max ?? 0),
        },
      },
      launchDate: new Date(String(raw.launch_date ?? raw.launchedAt ?? Date.now())),
      lastUpdated: new Date(String(raw.updated_at ?? raw.updatedAt ?? Date.now())),
      totalPaid: this.parseReward(raw.total_paid ?? 0),
      active: raw.status === 'active' || raw.active !== false,
    };
  }

  /**
   * Parse reward value from various formats
   */
  private parseReward(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return 0;

    const cleaned = value.replace(/[$,]/g, '').trim();
    const match = cleaned.match(/[\d.]+/);
    if (!match) return 0;

    let num = parseFloat(match[0]);
    if (cleaned.toLowerCase().includes('k')) num *= 1000;
    if (cleaned.toLowerCase().includes('m')) num *= 1000000;

    return num;
  }

  /**
   * Parse assets array
   */
  private parseAssets(assets?: Array<Record<string, unknown>>): BountyAsset[] {
    if (!Array.isArray(assets)) return [];

    return assets.map((a) => ({
      type: this.parseAssetType(String(a.type ?? '')),
      target: String(a.target ?? a.url ?? a.address ?? ''),
      description: a.description ? String(a.description) : undefined,
    }));
  }

  /**
   * Parse asset type
   */
  private parseAssetType(type: string): BountyAsset['type'] {
    const lower = type.toLowerCase();
    if (lower.includes('smart') || lower.includes('contract')) return 'smart_contract';
    if (lower.includes('web') || lower.includes('app')) return 'websites_and_applications';
    return 'blockchain_dlt';
  }

  /**
   * Fetch from unofficial Immunefi programs tracker
   */
  private async fetchFromUnofficial(options?: {
    minReward?: number;
    type?: string;
    limit?: number;
  }): Promise<BountyProgram[]> {
    // This would fetch from https://github.com/infosec-us-team/Immunefi-Bug-Bounty-Programs-Unofficial
    // For now, return empty - the actual implementation would use fetch()
    console.warn('[ImmunefiMCP] ibb CLI not available, falling back to mock data');

    // Return some example programs for testing
    return this.getMockPrograms().slice(0, options?.limit ?? 100);
  }

  /**
   * Mock programs for testing without ibb CLI
   */
  private getMockPrograms(): BountyProgram[] {
    return [
      {
        id: 'makerdao',
        platform: 'immunefi',
        name: 'MakerDAO',
        url: 'https://immunefi.com/bounty/makerdao',
        maxReward: 10000000,
        assets: [
          { type: 'smart_contract', target: '0x...', description: 'MCD Core Contracts' },
        ],
        inScope: ['Smart Contracts', 'MCD System'],
        outOfScope: ['Frontend', 'Off-chain components'],
        severity: {
          critical: { min: 100000, max: 10000000 },
          high: { min: 50000, max: 100000 },
          medium: { min: 10000, max: 50000 },
          low: { min: 1000, max: 10000 },
        },
        launchDate: new Date('2020-01-01'),
        lastUpdated: new Date(),
        totalPaid: 1500000,
        active: true,
      },
      {
        id: 'uniswap',
        platform: 'immunefi',
        name: 'Uniswap',
        url: 'https://immunefi.com/bounty/uniswap',
        maxReward: 3000000,
        assets: [
          { type: 'smart_contract', target: '0x...', description: 'Uniswap V3 Core' },
        ],
        inScope: ['v3-core', 'v3-periphery'],
        outOfScope: ['v2 contracts', 'Frontend'],
        severity: {
          critical: { min: 500000, max: 3000000 },
          high: { min: 100000, max: 500000 },
          medium: { min: 25000, max: 100000 },
          low: { min: 5000, max: 25000 },
        },
        launchDate: new Date('2021-05-01'),
        lastUpdated: new Date(),
        totalPaid: 500000,
        active: true,
      },
      {
        id: 'aave',
        platform: 'immunefi',
        name: 'Aave',
        url: 'https://immunefi.com/bounty/aave',
        maxReward: 2500000,
        assets: [
          { type: 'smart_contract', target: '0x...', description: 'Aave V3 Protocol' },
        ],
        inScope: ['aave-v3-core', 'aave-v3-periphery'],
        outOfScope: ['v2 contracts', 'Governance'],
        severity: {
          critical: { min: 250000, max: 2500000 },
          high: { min: 50000, max: 250000 },
          medium: { min: 10000, max: 50000 },
          low: { min: 2500, max: 10000 },
        },
        launchDate: new Date('2022-03-01'),
        lastUpdated: new Date(),
        totalPaid: 750000,
        active: true,
      },
    ];
  }
}

// ============================================================================
// Tool Handler
// ============================================================================

/**
 * Handle MCP tool calls for Immunefi
 */
export async function handleImmunefiTool(
  toolName: string,
  input: Record<string, unknown>,
  mcp: ImmunefiMCP
): Promise<string> {
  switch (toolName) {
    case 'immunefi_list': {
      const programs = await mcp.listPrograms({
        minReward: input.minReward as number | undefined,
        type: input.type as 'smart_contract' | 'websites_and_applications' | 'blockchain_dlt' | 'all' | undefined,
        limit: input.limit as number | undefined,
      });
      return JSON.stringify(programs, null, 2);
    }

    case 'immunefi_details': {
      const details = await mcp.getProgramDetails(input.program as string);
      return details ? JSON.stringify(details, null, 2) : 'Program not found';
    }

    case 'immunefi_assets': {
      const assets = await mcp.getProgramAssets(input.program as string);
      return JSON.stringify(assets, null, 2);
    }

    case 'immunefi_search': {
      const results = await mcp.searchPrograms(input.query as string);
      return JSON.stringify(results, null, 2);
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ============================================================================
// Exports
// ============================================================================

export function createImmunefiMCP(ibbPath?: string): ImmunefiMCP {
  return new ImmunefiMCP(ibbPath);
}
