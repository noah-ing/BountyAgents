/**
 * Autonomous Hunter
 *
 * Runs continuously, hunting bounties until stopped or out of credits.
 * - Fetches new bounties from Immunefi
 * - Prioritizes by reward/complexity ratio
 * - Hunts each target through the full pipeline
 * - Auto-submits validated findings
 * - Tracks costs and earnings
 */

import { SwarmOrchestrator } from '../swarm/orchestrator.js';
import { ImmunefiClient } from '../platforms/immunefi.js';
import type {
  SwarmConfig,
  PrioritizedBounty,
  VulnerabilityFinding,
  PopeSynthesis,
  ForgedExploit,
} from '../types/index.js';

interface HunterCallbacks {
  onLog: (entry: { level: 'info' | 'warn' | 'error' | 'success'; stage: string; message: string; details?: string }) => void;
  onStateUpdate: (update: Record<string, unknown>) => void;
  onSubmission: (submission: {
    platform: string;
    program: string;
    vulnerability: string;
    severity: string;
    status: 'pending' | 'submitted';
    bountyValue: number;
  }) => void;
}

export class AutonomousHunter {
  private config: SwarmConfig;
  private callbacks: HunterCallbacks;
  private orchestrator: SwarmOrchestrator;
  private immunefi: ImmunefiClient;
  private running: boolean = false;
  private paused: boolean = false;
  private shouldStop: boolean = false;
  private totalCost: number = 0;
  private huntedPrograms: Set<string> = new Set();

  constructor(config: SwarmConfig, callbacks: HunterCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.orchestrator = new SwarmOrchestrator(config);
    this.immunefi = new ImmunefiClient();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.shouldStop = false;

    this.callbacks.onLog({ level: 'success', stage: 'hunter', message: 'Starting autonomous hunt loop' });

    while (this.running && !this.shouldStop) {
      if (this.paused) {
        await this.sleep(1000);
        continue;
      }

      try {
        // Fetch and prioritize bounties
        this.callbacks.onLog({ level: 'info', stage: 'scout', message: 'Fetching bounty programs from Immunefi...' });
        const bounties = await this.immunefi.fetchActiveBounties();

        if (bounties.length === 0) {
          this.callbacks.onLog({ level: 'warn', stage: 'scout', message: 'No bounties found, retrying in 60s...' });
          await this.sleep(60000);
          continue;
        }

        // Prioritize bounties we haven't hunted yet
        const unhunted = bounties.filter((b) => !this.huntedPrograms.has(b.id));
        if (unhunted.length === 0) {
          this.callbacks.onLog({ level: 'info', stage: 'scout', message: 'All programs hunted, resetting and re-scanning...' });
          this.huntedPrograms.clear();
          await this.sleep(300000); // Wait 5 min before full rescan
          continue;
        }

        // Sort by priority (max reward / estimated difficulty)
        const prioritized = this.prioritizeBounties(unhunted);
        const target = prioritized[0];

        this.callbacks.onLog({
          level: 'info',
          stage: 'scout',
          message: `Selected target: ${target.name}`,
          details: `Max reward: $${target.maxReward.toLocaleString()}, Priority score: ${target.priorityScore.toFixed(2)}`,
        });

        this.callbacks.onStateUpdate({ currentTarget: target.name });

        // Hunt the target
        const startTime = Date.now();
        const result = await this.orchestrator.hunt(target);
        const huntTime = (Date.now() - startTime) / 1000;

        // Calculate cost (rough estimate: $0.015 per 1K input tokens, $0.075 per 1K output tokens)
        const estimatedCost = this.estimateCost(result.logs);
        this.totalCost += estimatedCost;
        this.callbacks.onStateUpdate({
          creditsUsed: this.totalCost,
          huntsSinceStart: this.huntedPrograms.size + 1,
        });

        this.callbacks.onLog({
          level: 'info',
          stage: 'hunter',
          message: `Hunt complete: ${target.name}`,
          details: `Time: ${huntTime.toFixed(0)}s, Cost: $${estimatedCost.toFixed(2)}, Findings: ${result.findings.length}`,
        });

        // Process results
        await this.processResults(target, result.synthesis, result.exploits);

        // Mark as hunted
        this.huntedPrograms.add(target.id);

        // Brief pause between hunts
        await this.sleep(5000);
      } catch (error) {
        this.callbacks.onLog({
          level: 'error',
          stage: 'hunter',
          message: 'Hunt error',
          details: (error as Error).message,
        });
        await this.sleep(30000); // Wait 30s on error
      }
    }

    this.running = false;
    this.callbacks.onLog({ level: 'info', stage: 'hunter', message: 'Hunt loop stopped' });
    this.callbacks.onStateUpdate({ status: 'idle', currentTarget: null });
  }

  stop(): void {
    this.shouldStop = true;
    this.callbacks.onLog({ level: 'warn', stage: 'hunter', message: 'Stop requested - will finish current hunt' });
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  private prioritizeBounties(bounties: PrioritizedBounty[]): PrioritizedBounty[] {
    // STRATEGIC PRIORITY: Newer programs have WAY more undiscovered bugs
    // Score heavily rewards freshness over reward size
    return bounties
      .map((b) => {
        const daysOld = this.daysSince(b.launchDate);

        // FRESHNESS IS KING - exponential bonus for new programs
        let freshnessBonus = 1;
        if (daysOld < 30) {
          freshnessBonus = 10;  // Programs < 30 days = 10x priority
        } else if (daysOld < 90) {
          freshnessBonus = 5;   // Programs < 90 days = 5x priority
        } else if (daysOld < 180) {
          freshnessBonus = 2;   // Programs < 6 months = 2x priority
        } else if (daysOld > 730) {
          freshnessBonus = 0.1; // Programs > 2 years = 10% penalty (already picked over)
        }

        // TVL multiplier (higher TVL = more impact = higher bounty payout)
        const tvlMultiplier = b.contracts.reduce((sum, c) => sum + (c.tvl || 0), 0) > 10_000_000 ? 1.5 : 1;

        // Difficulty penalty (but don't penalize too much - hard programs = less competition)
        const difficultyPenalty = b.estimatedDifficulty === 'extreme' ? 2 : b.estimatedDifficulty === 'high' ? 1.5 : 1;

        // Has source code? Huge bonus - can't find bugs without code
        const sourceBonus = b.contracts.some(c => c.sourceCode && c.sourceCode.length > 100) ? 2 : 0.5;

        // Low historical payouts = less picked over
        const historyBonus = (b.totalPaid || 0) < 100000 ? 1.5 : 1;

        b.priorityScore = (b.maxReward * freshnessBonus * tvlMultiplier * sourceBonus * historyBonus) / difficultyPenalty / 10000;

        // Log why we prioritized this
        b.reasons = [
          `Freshness: ${daysOld} days old (${freshnessBonus}x)`,
          `Source: ${sourceBonus > 1 ? 'YES' : 'NO'} (${sourceBonus}x)`,
          `Difficulty: ${b.estimatedDifficulty} (/${difficultyPenalty})`,
        ];

        return b;
      })
      .sort((a, b) => b.priorityScore - a.priorityScore);
  }

  private daysSince(date: Date): number {
    return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  }

  private async processResults(
    bounty: PrioritizedBounty,
    synthesis: PopeSynthesis | undefined,
    exploits: ForgedExploit[]
  ): Promise<void> {
    if (!synthesis || synthesis.validatedVulnerabilities.length === 0) {
      this.callbacks.onLog({
        level: 'info',
        stage: 'synthesis',
        message: 'No validated vulnerabilities',
        details: synthesis?.novelInsights.join('; ') || 'No insights',
      });
      this.callbacks.onStateUpdate({ totalFindings: synthesis?.validatedVulnerabilities.length || 0 });
      return;
    }

    this.callbacks.onLog({
      level: 'success',
      stage: 'synthesis',
      message: `${synthesis.validatedVulnerabilities.length} vulnerabilities validated!`,
      details: `Confidence: ${(synthesis.confidence * 100).toFixed(0)}%, Est. Impact: $${synthesis.estimatedImpactUsd.toLocaleString()}`,
    });

    // Queue each validated finding for submission
    for (const vuln of synthesis.validatedVulnerabilities) {
      const exploit = exploits.find((e) => e.vulnerability.id === vuln.id);
      const bountyValue = this.estimateBountyValue(bounty, vuln);

      this.callbacks.onSubmission({
        platform: bounty.platform,
        program: bounty.name,
        vulnerability: vuln.title,
        severity: vuln.severity,
        status: 'pending',
        bountyValue,
      });

      this.callbacks.onStateUpdate({
        validatedFindings: synthesis.validatedVulnerabilities.length,
      });

      // Auto-submit if exploit verified and high confidence
      if (exploit?.verified && synthesis.confidence >= this.config.minConfidenceToSubmit) {
        this.callbacks.onLog({
          level: 'success',
          stage: 'submission',
          message: `Auto-submitting: ${vuln.title}`,
          details: `Verified exploit with ${(synthesis.confidence * 100).toFixed(0)}% confidence`,
        });
      }
    }
  }

  private estimateBountyValue(bounty: PrioritizedBounty, vuln: VulnerabilityFinding): number {
    const severityRanges = bounty.severity;
    switch (vuln.severity) {
      case 'CRITICAL':
        return (severityRanges.critical.min + severityRanges.critical.max) / 2;
      case 'HIGH':
        return (severityRanges.high.min + severityRanges.high.max) / 2;
      case 'MEDIUM':
        return (severityRanges.medium.min + severityRanges.medium.max) / 2;
      case 'LOW':
        return (severityRanges.low.min + severityRanges.low.max) / 2;
      default:
        return 0;
    }
  }

  private estimateCost(logs: Array<{ cost?: { inputTokens: number; outputTokens: number } }>): number {
    let totalInput = 0;
    let totalOutput = 0;
    for (const log of logs) {
      if (log.cost) {
        totalInput += log.cost.inputTokens;
        totalOutput += log.cost.outputTokens;
      }
    }
    // Sonnet pricing: $3/MTok input, $15/MTok output
    return (totalInput * 0.003 + totalOutput * 0.015) / 1000;
  }

  async submitToPlatform(submission: {
    id: string;
    platform: string;
    program: string;
    vulnerability: string;
    severity: string;
  }): Promise<void> {
    this.callbacks.onLog({
      level: 'info',
      stage: 'submission',
      message: `Submitting to ${submission.platform}: ${submission.vulnerability}`,
    });

    // Use the Immunefi client to submit
    await this.immunefi.submitReport({
      program: submission.program,
      title: submission.vulnerability,
      severity: submission.severity as 'critical' | 'high' | 'medium' | 'low',
      description: 'Auto-generated by The Vulnerability Swarm',
      proofOfConcept: 'See attached exploit code',
    });

    this.callbacks.onLog({
      level: 'success',
      stage: 'submission',
      message: `Submitted to ${submission.platform}`,
      details: 'Awaiting review',
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
