/**
 * Verification Tribunal
 *
 * Three independent verifiers evaluate each exploit.
 * 2/3 PASS = Submit with review
 * 3/3 PASS = High confidence auto-submit
 */

import { createAgent, DynamicAgent, AgentTemplates } from '../base-agent.js';
import type {
  ForgedExploit,
  VerificationResult,
  VerificationVote,
} from '../../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface TribunalConfig {
  verifierCount: number;
  passThreshold: number; // Minimum votes to pass (default: 2)
  autoSubmitThreshold: number; // All must pass for auto-submit (default: 3)
}

// ============================================================================
// Verification Tribunal
// ============================================================================

export class VerificationTribunal {
  private config: TribunalConfig;
  private verifiers: DynamicAgent[] = [];

  constructor(config?: Partial<TribunalConfig>) {
    this.config = {
      verifierCount: config?.verifierCount ?? 3,
      passThreshold: config?.passThreshold ?? 2,
      autoSubmitThreshold: config?.autoSubmitThreshold ?? 3,
    };

    // Create verifiers
    for (let i = 1; i <= this.config.verifierCount; i++) {
      this.verifiers.push(createAgent(AgentTemplates.verifier(i)));
    }

    console.log(`[Tribunal] Initialized with ${this.config.verifierCount} verifiers`);
  }

  /**
   * Verify a single exploit
   */
  async verify(exploit: ForgedExploit): Promise<VerificationResult> {
    console.log(`[Tribunal] Verifying: ${exploit.vulnerability.title}`);

    // Run all verifiers in parallel
    const votes = await Promise.all(
      this.verifiers.map((verifier) => this.runVerifier(verifier, exploit))
    );

    // Count passes
    const passCount = votes.filter((v) => v.vote === 'pass').length;

    // Calculate average confidence
    const avgConfidence =
      votes.reduce(
        (sum, v) => sum + (v.reproducibilityScore + v.noveltyScore + v.feasibilityScore) / 3,
        0
      ) / votes.length;

    const result: VerificationResult = {
      findingId: exploit.vulnerability.id,
      votes,
      consensus:
        passCount >= this.config.autoSubmitThreshold
          ? 'PASS'
          : passCount >= this.config.passThreshold
            ? 'PASS'
            : passCount > 0
              ? 'SPLIT'
              : 'FAIL',
      confidenceScore: avgConfidence,
      autoSubmit: passCount >= this.config.autoSubmitThreshold,
    };

    console.log(
      `[Tribunal] Result: ${result.consensus} (${passCount}/${this.config.verifierCount}) - ${result.autoSubmit ? 'AUTO-SUBMIT' : 'REVIEW REQUIRED'}`
    );

    return result;
  }

  /**
   * Run a single verifier
   */
  private async runVerifier(
    verifier: DynamicAgent,
    exploit: ForgedExploit
  ): Promise<VerificationVote> {
    const prompt = `Verify this exploit as an independent security researcher.

=== VULNERABILITY ===
${JSON.stringify(exploit.vulnerability, null, 2)}

=== EXPLOIT CODE ===
${exploit.finalExploit}

=== TEST RESULTS (if available) ===
${exploit.testResults.length > 0 ? JSON.stringify(exploit.testResults, null, 2) : 'Not yet tested on forked chain'}

=== YOUR VERIFICATION CRITERIA ===

1. REPRODUCIBILITY (0.0-1.0):
   - Can this exploit be reliably reproduced?
   - Would it work across multiple blocks?
   - Are there timing dependencies that could fail?

2. NOVELTY (0.0-1.0):
   - Is this a known vulnerability or something new?
   - Has this exact issue been exploited before?
   - Would this be accepted as a valid bug bounty submission?

3. FEASIBILITY (0.0-1.0):
   - Can this be executed in the real world?
   - What capital is required?
   - Are there barriers (gas costs, timing, front-running)?

4. VOTE:
   - PASS: This is a valid, exploitable vulnerability
   - FAIL: This exploit is not valid or not feasible

Output your verification as JSON:
{
  "vote": "pass|fail",
  "reason": "Detailed explanation of your decision",
  "reproducibility_score": 0.0-1.0,
  "novelty_score": 0.0-1.0,
  "feasibility_score": 0.0-1.0,
  "concerns": ["List any concerns or warnings"],
  "suggestions": ["Suggestions to improve the exploit if applicable"]
}`;

    const { data } = await verifier.analyzeStructured<{
      vote: 'pass' | 'fail';
      reason: string;
      reproducibility_score: number;
      novelty_score: number;
      feasibility_score: number;
      concerns: string[];
      suggestions?: string[];
    }>(prompt);

    return {
      verifierId: verifier.getInfo().name,
      vote: data.vote,
      reason: data.reason,
      reproducibilityScore: data.reproducibility_score,
      noveltyScore: data.novelty_score,
      feasibilityScore: data.feasibility_score,
    };
  }

  /**
   * Verify multiple exploits
   */
  async verifyAll(exploits: ForgedExploit[]): Promise<VerificationResult[]> {
    console.log(`[Tribunal] Verifying ${exploits.length} exploits`);

    const results: VerificationResult[] = [];

    for (const exploit of exploits) {
      const result = await this.verify(exploit);
      results.push(result);

      // Update exploit verification status
      exploit.verified = result.consensus === 'PASS';
    }

    // Summary
    const passed = results.filter((r) => r.consensus === 'PASS').length;
    const autoSubmit = results.filter((r) => r.autoSubmit).length;
    console.log(`[Tribunal] Complete: ${passed}/${exploits.length} passed, ${autoSubmit} auto-submit`);

    return results;
  }

  /**
   * Generate submission report
   */
  generateSubmissionReport(
    exploit: ForgedExploit,
    verification: VerificationResult
  ): string {
    const votes = verification.votes
      .map((v) => `- ${v.verifierId}: ${v.vote.toUpperCase()} (${((v.reproducibilityScore + v.noveltyScore + v.feasibilityScore) / 3 * 100).toFixed(1)}%)`)
      .join('\n');

    return `# Bug Bounty Submission Report

## Vulnerability Summary
**Title:** ${exploit.vulnerability.title}
**Severity:** ${exploit.vulnerability.severity}
**Confidence:** ${(exploit.vulnerability.confidence * 100).toFixed(1)}%

## Description
${exploit.vulnerability.description}

## Affected Code
${exploit.vulnerability.affectedFunctions.map((f) => `- \`${f}\``).join('\n')}

## Exploit Scenario
${exploit.vulnerability.exploitScenario}

## Proof of Concept
\`\`\`solidity
${exploit.finalExploit}
\`\`\`

## Verification Results
**Status:** ${verification.consensus}
**Auto-Submit:** ${verification.autoSubmit ? 'Yes' : 'No'}
**Confidence Score:** ${(verification.confidenceScore * 100).toFixed(1)}%

### Verifier Votes
${votes}

## Estimated Impact
$${exploit.vulnerability.estimatedImpactUsd?.toLocaleString() ?? 'Unknown'}

---
*Generated by The Vulnerability Swarm*
*Claude Opus 4.5 Multi-Agent System*
`;
  }

  /**
   * Get total usage across all verifiers
   */
  getTotalUsage(): { inputTokens: number; outputTokens: number; estimatedCost: number } {
    return this.verifiers.reduce(
      (acc, verifier) => {
        const usage = verifier.getUsage();
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
// Exports
// ============================================================================

export function createVerificationTribunal(config?: Partial<TribunalConfig>): VerificationTribunal {
  return new VerificationTribunal(config);
}
