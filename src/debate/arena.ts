/**
 * Debate Arena
 *
 * Where vulnerability findings are attacked, defended, and refined.
 * This is where weak findings die and strong findings get stronger.
 *
 * The adversarial debate process:
 * 1. PRESENTATION: Specialists present their findings
 * 2. ATTACK: Red Team attacks each finding ruthlessly
 * 3. DEFENSE: Blue Team + Original finder defend
 * 4. DEVIL'S ADVOCATE: Extreme skepticism challenges survivors
 * 5. FINAL: Closing arguments before Pope synthesis
 */

import { createAgent, DynamicAgent, AgentTemplates } from '../agents/base-agent.js';
import type {
  VulnerabilityFinding,
  DebateSession,
  DebateRound,
  DebateEntry,
  ContractInfo,
} from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface DebateConfig {
  maxRounds: number;
  redTeamSize: number;
  blueTeamSize: number;
  devilsAdvocateSize: number;
  concessionThreshold: number; // Confidence below which defender should concede
}

export interface DebateResult {
  session: DebateSession;
  survivors: VulnerabilityFinding[];
  rejected: { finding: VulnerabilityFinding; reason: string }[];
  strengthened: { finding: VulnerabilityFinding; improvements: string[] }[];
}

// ============================================================================
// Debate Arena
// ============================================================================

export class DebateArena {
  private config: DebateConfig;
  private redTeam: DynamicAgent[] = [];
  private blueTeam: DynamicAgent[] = [];
  private devilsAdvocates: DynamicAgent[] = [];
  private sessions: DebateSession[] = [];

  constructor(config?: Partial<DebateConfig>) {
    this.config = {
      maxRounds: config?.maxRounds ?? 5,
      redTeamSize: config?.redTeamSize ?? 3,
      blueTeamSize: config?.blueTeamSize ?? 2,
      devilsAdvocateSize: config?.devilsAdvocateSize ?? 2,
      concessionThreshold: config?.concessionThreshold ?? 0.3,
    };

    this.initializeAgents();
  }

  /**
   * Initialize all debate agents
   */
  private initializeAgents(): void {
    // Spawn Red Team
    for (let i = 1; i <= this.config.redTeamSize; i++) {
      this.redTeam.push(createAgent(AgentTemplates.redTeamAttacker(i)));
    }

    // Spawn Blue Team
    for (let i = 1; i <= this.config.blueTeamSize; i++) {
      this.blueTeam.push(createAgent(AgentTemplates.blueTeamDefender(i)));
    }

    // Spawn Devil's Advocates
    for (let i = 1; i <= this.config.devilsAdvocateSize; i++) {
      this.devilsAdvocates.push(createAgent(AgentTemplates.devilsAdvocate(i)));
    }

    console.log(`[Arena] Initialized: ${this.config.redTeamSize} Red, ${this.config.blueTeamSize} Blue, ${this.config.devilsAdvocateSize} Devil's Advocates`);
  }

  /**
   * Run a full debate on a set of findings
   */
  async debate(
    findings: VulnerabilityFinding[],
    contracts: ContractInfo[],
    specialists: Map<string, DynamicAgent>
  ): Promise<DebateResult> {
    console.log(`[Arena] Starting debate on ${findings.length} findings`);

    // Create session
    const session: DebateSession = {
      id: `debate-${Date.now()}`,
      contractAddress: contracts[0]?.address ?? 'unknown',
      findings: findings.map((f) => ({ ...f, status: 'debating' as const })),
      rounds: [],
      participants: [
        ...Array.from(specialists.keys()),
        ...this.redTeam.map((a) => a.getInfo().name),
        ...this.blueTeam.map((a) => a.getInfo().name),
        ...this.devilsAdvocates.map((a) => a.getInfo().name),
      ],
      startTime: new Date(),
    };

    // Build contract context for all agents
    const contractContext = this.buildContractContext(contracts);

    // Track finding status
    const findingStatus = new Map<string, 'alive' | 'rejected'>();
    findings.forEach((f) => findingStatus.set(f.id, 'alive'));

    // Round 1: PRESENTATION
    console.log('[Arena] Round 1: Presentations');
    const presentationRound = await this.runPresentationRound(
      session.findings,
      specialists,
      contractContext
    );
    session.rounds.push(presentationRound);

    // Round 2: ATTACK
    console.log('[Arena] Round 2: Red Team Attack');
    const attackRound = await this.runAttackRound(
      session.findings.filter((f) => findingStatus.get(f.id) === 'alive'),
      contractContext
    );
    session.rounds.push(attackRound);

    // Round 3: DEFENSE
    console.log('[Arena] Round 3: Blue Team Defense');
    const defenseRound = await this.runDefenseRound(
      session.findings.filter((f) => findingStatus.get(f.id) === 'alive'),
      attackRound,
      specialists,
      contractContext
    );
    session.rounds.push(defenseRound);

    // Check for concessions after defense
    await this.processConcessions(session.findings, defenseRound, findingStatus);

    // Round 4: DEVIL'S ADVOCATE
    console.log("[Arena] Round 4: Devil's Advocate Challenge");
    const daRound = await this.runDevilsAdvocateRound(
      session.findings.filter((f) => findingStatus.get(f.id) === 'alive'),
      session.rounds,
      contractContext
    );
    session.rounds.push(daRound);

    // Round 5: FINAL (if needed)
    const survivors = session.findings.filter((f) => findingStatus.get(f.id) === 'alive');
    if (survivors.length > 0 && session.rounds.length < this.config.maxRounds) {
      console.log('[Arena] Round 5: Final Arguments');
      const finalRound = await this.runFinalRound(survivors, session.rounds, contractContext);
      session.rounds.push(finalRound);
    }

    // Complete session
    session.endTime = new Date();
    this.sessions.push(session);

    // Compile results
    const result = this.compileResults(session, findingStatus);

    console.log(
      `[Arena] Debate complete: ${result.survivors.length} survivors, ${result.rejected.length} rejected`
    );

    return result;
  }

  // ============================================================================
  // Round Implementations
  // ============================================================================

  /**
   * Round 1: Specialists present their findings
   */
  private async runPresentationRound(
    findings: VulnerabilityFinding[],
    specialists: Map<string, DynamicAgent>,
    context: string
  ): Promise<DebateRound> {
    const entries: DebateEntry[] = [];

    for (const finding of findings) {
      const specialist = specialists.get(finding.discoveredBy);
      if (!specialist) continue;

      const prompt = `Present your vulnerability finding to the debate panel.

CONTRACT CONTEXT:
${context}

YOUR FINDING:
${JSON.stringify(finding, null, 2)}

Present clearly and confidently:
1. What is the vulnerability?
2. Where is it in the code (specific lines)?
3. How can it be exploited?
4. What is the impact?

Be prepared to defend this finding against aggressive attacks.`;

      const response = await specialist.analyze(prompt);

      entries.push({
        round: 1,
        speaker: finding.discoveredBy,
        role: 'proposer',
        content: response.content,
        action: 'present',
        timestamp: new Date(),
        targetFinding: finding.id,
      });

      finding.debateHistory = finding.debateHistory ?? [];
      finding.debateHistory.push(entries[entries.length - 1]);
    }

    return {
      roundNumber: 1,
      type: 'PRESENTATION',
      entries,
      outcome: 'CONTINUES',
    };
  }

  /**
   * Round 2: Red Team attacks each finding
   */
  private async runAttackRound(
    findings: VulnerabilityFinding[],
    context: string
  ): Promise<DebateRound> {
    const entries: DebateEntry[] = [];

    for (const finding of findings) {
      // Assign a random attacker
      const attacker = this.redTeam[Math.floor(Math.random() * this.redTeam.length)];
      const presentation = finding.debateHistory?.find((e) => e.action === 'present')?.content ?? '';

      const prompt = `You are attacking this vulnerability finding. Be ruthless but fair.

CONTRACT CONTEXT:
${context}

FINDING:
${JSON.stringify(finding, null, 2)}

SPECIALIST'S PRESENTATION:
${presentation}

Attack vectors to consider:
1. Are there protective mechanisms they missed? (Guards, modifiers, checks)
2. Is the exploit actually feasible? (Capital requirements, timing, permissions)
3. Are their assumptions correct?
4. Is this a real vulnerability or a false positive?
5. Would a real attacker bother with this?

If the finding has merit, acknowledge it. If it's weak, destroy it.`;

      const response = await attacker.analyze(prompt);

      entries.push({
        round: 2,
        speaker: attacker.getInfo().name,
        role: 'red-team',
        content: response.content,
        action: 'attack',
        timestamp: new Date(),
        targetFinding: finding.id,
      });

      finding.debateHistory?.push(entries[entries.length - 1]);
    }

    return {
      roundNumber: 2,
      type: 'ATTACK',
      entries,
      outcome: 'CONTINUES',
    };
  }

  /**
   * Round 3: Blue Team defends (along with original specialists)
   */
  private async runDefenseRound(
    findings: VulnerabilityFinding[],
    attackRound: DebateRound,
    specialists: Map<string, DynamicAgent>,
    context: string
  ): Promise<DebateRound> {
    const entries: DebateEntry[] = [];

    for (const finding of findings) {
      // Get the attack on this finding
      const attack = attackRound.entries.find((e) => e.targetFinding === finding.id);
      if (!attack) continue;

      // Choose defender (blue team or original specialist)
      const defender =
        Math.random() > 0.5
          ? this.blueTeam[Math.floor(Math.random() * this.blueTeam.length)]
          : specialists.get(finding.discoveredBy);

      if (!defender) continue;

      const prompt = `Defend this vulnerability finding against the Red Team attack.

CONTRACT CONTEXT:
${context}

FINDING:
${JSON.stringify(finding, null, 2)}

RED TEAM ATTACK:
${attack.content}

Your defense should:
1. Address each attack point specifically
2. Provide evidence (code paths, line numbers)
3. Show why protective mechanisms don't work or can be bypassed
4. If an attack point is valid, CONCEDE it gracefully - this is strength, not weakness

If you cannot defend the finding, say so. False defenses hurt our credibility.`;

      const response = await defender.analyze(prompt);

      // Check for concession
      const concedesPattern = /\b(concede|accept|valid point|they're right|cannot defend|unable to defend)\b/i;
      const action: DebateEntry['action'] = concedesPattern.test(response.content) ? 'concede' : 'defend';

      entries.push({
        round: 3,
        speaker: defender.getInfo().name,
        role: 'blue-team',
        content: response.content,
        action,
        timestamp: new Date(),
        targetFinding: finding.id,
      });

      finding.debateHistory?.push(entries[entries.length - 1]);
    }

    return {
      roundNumber: 3,
      type: 'DEFENSE',
      entries,
      outcome: 'CONTINUES',
    };
  }

  /**
   * Round 4: Devil's Advocates challenge survivors
   */
  private async runDevilsAdvocateRound(
    findings: VulnerabilityFinding[],
    previousRounds: DebateRound[],
    context: string
  ): Promise<DebateRound> {
    const entries: DebateEntry[] = [];

    for (const finding of findings) {
      const advocate = this.devilsAdvocates[Math.floor(Math.random() * this.devilsAdvocates.length)];

      // Compile debate history for this finding
      const history = previousRounds
        .flatMap((r) => r.entries)
        .filter((e) => e.targetFinding === finding.id)
        .map((e) => `[${e.speaker}] (${e.action}): ${e.content}`)
        .join('\n\n');

      const prompt = `Challenge this surviving finding with EXTREME skepticism.

CONTRACT CONTEXT:
${context}

FINDING:
${JSON.stringify(finding, null, 2)}

DEBATE HISTORY:
${history}

Ask the hardest questions:
1. Has this exact vulnerability been exploited before? In what context?
2. Is this already patched or known?
3. What capital is required to exploit? Is it realistic?
4. Can the exploit be front-run? Who captures the MEV?
5. Would a rational attacker actually do this given gas costs, risks?
6. Are there legal/reputation risks that deter attackers?
7. What's the REALISTIC maximum impact, not the theoretical maximum?

Your skepticism should be extreme but fair. We want REAL vulnerabilities, not theoretical ones.`;

      const response = await advocate.analyze(prompt);

      entries.push({
        round: 4,
        speaker: advocate.getInfo().name,
        role: 'devils-advocate',
        content: response.content,
        action: 'challenge',
        timestamp: new Date(),
        targetFinding: finding.id,
      });

      finding.debateHistory?.push(entries[entries.length - 1]);
    }

    return {
      roundNumber: 4,
      type: 'DEVILS_ADVOCATE',
      entries,
      outcome: 'CONTINUES',
    };
  }

  /**
   * Round 5: Final arguments
   */
  private async runFinalRound(
    findings: VulnerabilityFinding[],
    previousRounds: DebateRound[],
    context: string
  ): Promise<DebateRound> {
    const entries: DebateEntry[] = [];

    // Final summary from blue team
    for (const finding of findings) {
      const defender = this.blueTeam[0];

      const history = previousRounds
        .flatMap((r) => r.entries)
        .filter((e) => e.targetFinding === finding.id)
        .map((e) => `[${e.speaker}] (${e.action}): ${e.content}`)
        .join('\n\n');

      const prompt = `Provide final arguments for this finding.

FINDING:
${JSON.stringify(finding, null, 2)}

FULL DEBATE:
${history}

Summarize:
1. Why this finding is valid (or why it should be rejected if attacks were compelling)
2. What the realistic impact is
3. Recommended severity
4. Key evidence supporting the finding`;

      const response = await defender.analyze(prompt);

      entries.push({
        round: 5,
        speaker: defender.getInfo().name,
        role: 'blue-team',
        content: response.content,
        action: 'defend',
        timestamp: new Date(),
        targetFinding: finding.id,
      });

      finding.debateHistory?.push(entries[entries.length - 1]);
    }

    return {
      roundNumber: 5,
      type: 'FINAL',
      entries,
      outcome: 'CONSENSUS',
    };
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Build contract context string
   */
  private buildContractContext(contracts: ContractInfo[]): string {
    return contracts
      .map((c) => `// ${c.name} (${c.address})\n${c.sourceCode}`)
      .join('\n\n// ---\n\n');
  }

  /**
   * Process concessions and update finding status
   */
  private async processConcessions(
    findings: VulnerabilityFinding[],
    defenseRound: DebateRound,
    status: Map<string, 'alive' | 'rejected'>
  ): Promise<void> {
    for (const entry of defenseRound.entries) {
      if (entry.action === 'concede' && entry.targetFinding) {
        status.set(entry.targetFinding, 'rejected');
        const finding = findings.find((f) => f.id === entry.targetFinding);
        if (finding) {
          finding.status = 'rejected';
        }
      }
    }
  }

  /**
   * Compile final debate results
   */
  private compileResults(
    session: DebateSession,
    status: Map<string, 'alive' | 'rejected'>
  ): DebateResult {
    const survivors: VulnerabilityFinding[] = [];
    const rejected: { finding: VulnerabilityFinding; reason: string }[] = [];
    const strengthened: { finding: VulnerabilityFinding; improvements: string[] }[] = [];

    for (const finding of session.findings) {
      if (status.get(finding.id) === 'rejected') {
        // Find the concession or attack that killed it
        const reason =
          finding.debateHistory?.find((e) => e.action === 'concede')?.content ??
          finding.debateHistory?.find((e) => e.action === 'attack')?.content ??
          'Rejected during debate';
        rejected.push({ finding, reason });
        finding.status = 'rejected';
      } else {
        survivors.push(finding);
        finding.status = 'validated';

        // Extract improvements from the debate
        const improvements =
          finding.debateHistory
            ?.filter((e) => e.role === 'devils-advocate' || e.role === 'red-team')
            .flatMap((e) => {
              // Extract actionable feedback
              const feedback = e.content.match(/(?:should|could|need to|must)[^.!?]+[.!?]/gi) ?? [];
              return feedback;
            }) ?? [];

        if (improvements.length > 0) {
          strengthened.push({ finding, improvements });
        }
      }
    }

    return { session, survivors, rejected, strengthened };
  }

  /**
   * Get all debate sessions
   */
  getSessions(): DebateSession[] {
    return this.sessions;
  }

  /**
   * Get total usage across all debate agents
   */
  getTotalUsage(): { inputTokens: number; outputTokens: number; estimatedCost: number } {
    const allAgents = [...this.redTeam, ...this.blueTeam, ...this.devilsAdvocates];
    return allAgents.reduce(
      (acc, agent) => {
        const usage = agent.getUsage();
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

export function createDebateArena(config?: Partial<DebateConfig>): DebateArena {
  return new DebateArena(config);
}
