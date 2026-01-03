/**
 * The Pope
 *
 * The ultimate synthesizer. After all debates are complete, The Pope
 * sees what individual agents cannot see: the CONNECTIONS.
 *
 * Not consensus. SYNTHESIS.
 * The Pope creates something NEW from the debate.
 */

import { createAgent, DynamicAgent, AgentTemplates } from '../base-agent.js';
import type {
  VulnerabilityFinding,
  DebateSession,
  PopeSynthesis,
  ContractInfo,
  Severity,
} from '../../types/index.js';

// ============================================================================
// The Pope
// ============================================================================

export class ThePope {
  private agent: DynamicAgent;

  constructor() {
    this.agent = createAgent(AgentTemplates.pope());
  }

  /**
   * Synthesize all debate findings into ultimate truth
   */
  async synthesize(
    debates: DebateSession[],
    contracts: ContractInfo[]
  ): Promise<PopeSynthesis> {
    console.log('[Pope] Beginning synthesis...');

    // Compile the full debate transcript
    const transcript = this.compileTranscript(debates);

    // Get all findings from debates
    const allFindings = debates.flatMap((d) => d.findings);

    // Build contract context
    const contractContext = contracts
      .map((c) => `// ${c.name} (${c.address})\n${c.sourceCode.slice(0, 10000)}`)
      .join('\n\n');

    const prompt = `You have witnessed the entire vulnerability debate. Now synthesize the truth.

=== CONTRACT CONTEXT ===
${contractContext}

=== DEBATE TRANSCRIPT ===
${transcript}

=== FINDINGS PRESENTED ===
${allFindings.map((f) => `- ${f.title} (${f.severity}) by ${f.discoveredBy} [Status: ${f.status}]`).join('\n')}

=== YOUR TASK ===
As The Pope, you must:
1. Identify which findings are TRULY valid after debate
2. Reject findings that were successfully attacked
3. Find CONNECTIONS between findings that no one else saw
4. Identify if multiple findings are actually the SAME root cause
5. Determine if findings can be COMBINED into a more devastating attack
6. Provide a NOVEL INSIGHT that emerges from seeing the full picture

Remember: You are not picking winners. You are SYNTHESIZING something new.

Output your synthesis as JSON:
{
  "synthesis": "Your overall synthesis - what is the true state of this contract's security?",
  "validated_vulnerabilities": [
    {
      "id": "finding_id",
      "title": "title",
      "description": "Updated description with synthesis insights",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "confidence": 0.0-1.0,
      "synthesis_notes": "Why this survived and any additional insights"
    }
  ],
  "rejected_vulnerabilities": [
    {
      "id": "finding_id",
      "reason": "Why it was rejected"
    }
  ],
  "novel_insights": [
    "Insights that emerged from seeing the full debate"
  ],
  "combined_attack_vector": "If vulnerabilities can be chained, describe the combined attack",
  "root_cause_analysis": "Underlying issues that caused multiple vulnerabilities",
  "recommended_severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "estimated_impact_usd": number,
  "confidence": 0.0-1.0
}`;

    const { data } = await this.agent.analyzeStructured<{
      synthesis: string;
      validated_vulnerabilities: Array<{
        id: string;
        title: string;
        description: string;
        severity: string;
        confidence: number;
        synthesis_notes: string;
      }>;
      rejected_vulnerabilities: Array<{
        id: string;
        reason: string;
      }>;
      novel_insights: string[];
      combined_attack_vector?: string;
      root_cause_analysis?: string;
      recommended_severity: string;
      estimated_impact_usd: number;
      confidence: number;
    }>(prompt);

    // Map validated findings back to full finding objects
    const validatedFindings: VulnerabilityFinding[] = [];
    for (const v of data.validated_vulnerabilities) {
      const original = allFindings.find((f) => f.id === v.id || f.title === v.title);
      if (original) {
        validatedFindings.push({
          ...original,
          description: v.description,
          severity: v.severity as Severity,
          confidence: v.confidence,
          status: 'validated',
        });
      }
    }

    // Map rejected findings
    const rejectedFindings = data.rejected_vulnerabilities.map((r) => {
      const original = allFindings.find((f) => f.id === r.id);
      return {
        finding: original ?? ({
          id: r.id,
          title: 'Unknown',
          status: 'rejected',
        } as VulnerabilityFinding),
        reason: r.reason,
      };
    });

    console.log(
      `[Pope] Synthesis complete: ${validatedFindings.length} validated, ${rejectedFindings.length} rejected`
    );
    console.log(`[Pope] Novel insights: ${data.novel_insights.length}`);

    return {
      summary: data.synthesis,
      validatedVulnerabilities: validatedFindings,
      rejectedVulnerabilities: rejectedFindings,
      novelInsights: data.novel_insights,
      combinedAttackVector: data.combined_attack_vector,
      recommendedSeverity: data.recommended_severity as Severity,
      estimatedImpactUsd: data.estimated_impact_usd,
      confidence: data.confidence,
    };
  }

  /**
   * Compile all debate sessions into a readable transcript
   */
  private compileTranscript(debates: DebateSession[]): string {
    const parts: string[] = [];

    for (const debate of debates) {
      parts.push(`=== DEBATE SESSION: ${debate.id} ===`);

      for (const round of debate.rounds) {
        parts.push(`\n--- Round ${round.roundNumber}: ${round.type} ---`);

        for (const entry of round.entries) {
          const findingRef = entry.targetFinding ? `[Re: ${entry.targetFinding}]` : '';
          parts.push(`\n[${entry.speaker}] (${entry.role}/${entry.action}) ${findingRef}`);
          parts.push(entry.content);
        }

        parts.push(`\nRound Outcome: ${round.outcome}`);
      }

      parts.push('\n');
    }

    return parts.join('\n');
  }

  /**
   * Get agent usage
   */
  getUsage(): { inputTokens: number; outputTokens: number; estimatedCost: number } {
    return this.agent.getUsage();
  }
}

// ============================================================================
// Exports
// ============================================================================

export function createPope(): ThePope {
  return new ThePope();
}
