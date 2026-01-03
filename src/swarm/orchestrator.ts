/**
 * Swarm Orchestrator
 *
 * The central brain of The Vulnerability Swarm.
 * Coordinates all agents through the 5-stage pipeline:
 * 1. Reconnaissance (Scouts)
 * 2. Expert Spawning (Dynamic specialist creation)
 * 3. Parallel Analysis (All specialists analyze independently)
 * 4. Adversarial Debate (Red Team vs Blue Team vs Devil's Advocates)
 * 5. Synthesis + Exploit Forge + Verification (Pope → Smiths → Verifiers)
 */

import pLimit from 'p-limit';
import type {
  SwarmConfig,
  PipelineState,
  PipelineStage,
  PipelineLog,
  PrioritizedBounty,
  ContractInfo,
  ContractAnalysis,
  ExpertDefinition,
  VulnerabilityFinding,
  DebateSession,
  PopeSynthesis,
  ForgedExploit,
  VerificationResult,
  AgentConfig,
} from '../types/index.js';
import { createAgent, AgentTemplates, DynamicAgent } from '../agents/base-agent.js';

export class SwarmOrchestrator {
  private config: SwarmConfig;
  private state: PipelineState | null = null;
  private agents: Map<string, DynamicAgent> = new Map();
  private concurrencyLimit: ReturnType<typeof pLimit>;

  constructor(config: SwarmConfig) {
    this.config = config;
    this.concurrencyLimit = pLimit(config.maxConcurrentAgents);
  }

  // ============================================================================
  // Main Pipeline
  // ============================================================================

  /**
   * Execute the full vulnerability hunting pipeline
   */
  async hunt(bounty: PrioritizedBounty): Promise<PipelineState> {
    this.state = this.initializeState(bounty);
    this.log('reconnaissance', 'Pipeline started', `Hunting ${bounty.name}`);

    try {
      // Stage 1: Reconnaissance (already done by scouts before this)
      await this.executeStage('reconnaissance', () => this.reconnaissance());

      // Stage 2: Expert Spawning
      await this.executeStage('expert-spawning', () => this.spawnExperts());

      // Stage 3: Parallel Analysis
      await this.executeStage('parallel-analysis', () => this.parallelAnalysis());

      // Stage 4: Adversarial Debate
      await this.executeStage('adversarial-debate', () => this.adversarialDebate());

      // Stage 5: Synthesis
      await this.executeStage('synthesis', () => this.synthesize());

      // Stage 6: Exploit Forge (if we have validated findings)
      if (this.state.synthesis?.validatedVulnerabilities.length) {
        await this.executeStage('exploit-forge', () => this.forgeExploits());

        // Stage 7: Verification
        await this.executeStage('verification', () => this.verify());
      }

      this.log('submission', 'Pipeline completed', this.generateSummary());
      return this.state;
    } catch (error) {
      this.log(
        this.state.currentStage,
        'Pipeline failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ============================================================================
  // Stage 1: Reconnaissance
  // ============================================================================

  private async reconnaissance(): Promise<void> {
    // Contracts should already be fetched by scouts
    // This stage validates we have what we need
    if (!this.state) throw new Error('State not initialized');

    this.log('reconnaissance', 'Validating contracts', `${this.state.contracts.length} contracts`);

    for (const contract of this.state.contracts) {
      if (!contract.sourceCode) {
        this.log(
          'reconnaissance',
          'Missing source',
          `Contract ${contract.address} has no source code`
        );
      }
    }
  }

  // ============================================================================
  // Stage 2: Expert Spawning
  // ============================================================================

  private async spawnExperts(): Promise<void> {
    if (!this.state) throw new Error('State not initialized');

    const spawner = createAgent(AgentTemplates.expertSpawner());
    this.agents.set('ExpertSpawner', spawner);

    // Analyze each contract and spawn appropriate experts
    for (const contract of this.state.contracts) {
      this.log('expert-spawning', 'Analyzing contract', contract.name);

      const prompt = `Analyze this smart contract and determine which experts to spawn:

Contract Name: ${contract.name}
Address: ${contract.address}
Chain: ${contract.chain}
TVL: $${contract.tvl?.toLocaleString() ?? 'Unknown'}

Source Code:
\`\`\`solidity
${contract.sourceCode}
\`\`\`

Analyze the contract and output your expert spawning recommendations as JSON.`;

      let analysis: ContractAnalysis;
      try {
        const result = await spawner.analyzeStructured<{
          contract_analysis?: string;
          experts_to_spawn?: Array<{
            name: string;
            type: string;
            reason: string;
            system_prompt: string;
            focus_areas: string[];
            temperature: number;
          }>;
          novel_patterns_detected?: string[];
        }>(prompt);

        analysis = {
          summary: result.data.contract_analysis ?? 'Analysis complete',
          detectedPatterns: [],
          integrations: [],
          expertsToSpawn: (result.data.experts_to_spawn ?? []).map(e => ({
            name: e.name,
            type: e.type as ExpertDefinition['type'],
            reason: e.reason,
            systemPrompt: e.system_prompt,
            focusAreas: e.focus_areas ?? [],
            temperature: e.temperature ?? 0,
          })),
          novelPatternsDetected: result.data.novel_patterns_detected ?? [],
        };
      } catch (parseError) {
        this.log('expert-spawning', 'Parse error, using default experts', String(parseError));
        analysis = {
          summary: 'Using default expert configuration',
          detectedPatterns: [],
          integrations: [],
          expertsToSpawn: [
            { name: 'ReentrancyExpert', type: 'vulnerability', reason: 'Standard check', systemPrompt: 'Analyze for reentrancy vulnerabilities.', focusAreas: ['external calls'], temperature: 0 },
            { name: 'AccessControlExpert', type: 'vulnerability', reason: 'Standard check', systemPrompt: 'Analyze for access control issues.', focusAreas: ['modifiers', 'roles'], temperature: 0 },
            { name: 'LogicErrorExpert', type: 'vulnerability', reason: 'Standard check', systemPrompt: 'Analyze for business logic errors.', focusAreas: ['calculations', 'state changes'], temperature: 0 },
          ],
          novelPatternsDetected: [],
        };
      }

      this.log(
        'expert-spawning',
        'Analysis complete',
        `${analysis.expertsToSpawn?.length ?? 0} experts needed`
      );

      // Create each expert
      for (const expertDef of analysis.expertsToSpawn ?? []) {
        const expertConfig: AgentConfig = {
          name: expertDef.name,
          role:
            expertDef.type === 'vulnerability'
              ? 'vulnerability-specialist'
              : expertDef.type === 'protocol'
                ? 'protocol-specialist'
                : 'pattern-specialist',
          model: 'claude-sonnet-4-20250514',
          temperature: expertDef.temperature,
          systemPrompt: expertDef.systemPrompt,
        };

        const expert = createAgent(expertConfig);
        this.agents.set(expertDef.name, expert);
        this.state.spawnedExperts.push(expertDef);

        this.log('expert-spawning', 'Expert spawned', expertDef.name);
      }
    }

    this.log(
      'expert-spawning',
      'Spawning complete',
      `${this.state.spawnedExperts.length} total experts`
    );
  }

  // ============================================================================
  // Stage 3: Parallel Analysis
  // ============================================================================

  private async parallelAnalysis(): Promise<void> {
    if (!this.state) throw new Error('State not initialized');

    const experts = this.state.spawnedExperts;
    const contracts = this.state.contracts;

    this.log('parallel-analysis', 'Starting analysis', `${experts.length} experts analyzing`);

    // Run all experts in parallel (with concurrency limit)
    const analysisPromises = experts.map((expertDef) =>
      this.concurrencyLimit(async () => {
        const expert = this.agents.get(expertDef.name);
        if (!expert) return [];

        const findings: VulnerabilityFinding[] = [];

        for (const contract of contracts) {
          this.log('parallel-analysis', `${expertDef.name} analyzing`, contract.name);

          const prompt = `Analyze this smart contract for vulnerabilities in your area of expertise.

Focus Areas: ${expertDef.focusAreas.join(', ')}

Contract Name: ${contract.name}
Address: ${contract.address}
Chain: ${contract.chain}
TVL: $${contract.tvl?.toLocaleString() ?? 'Unknown'}

Source Code:
\`\`\`solidity
${contract.sourceCode}
\`\`\`

If you find vulnerabilities, output them as JSON array:
[
  {
    "type": "vulnerability_type",
    "title": "Brief title",
    "description": "Detailed description",
    "severity": "CRITICAL|HIGH|MEDIUM|LOW",
    "confidence": 0.0-1.0,
    "affected_functions": ["function1", "function2"],
    "affected_lines": [{"file": "Contract.sol", "start": 10, "end": 20}],
    "exploit_scenario": "Step by step exploit",
    "proof_of_concept": "Optional code snippet",
    "estimated_impact_usd": 0
  }
]

If no vulnerabilities found, output: []`;

          try {
            const { data: rawFindings } = await expert.analyzeStructured<
              Array<{
                type: string;
                title: string;
                description: string;
                severity: string;
                confidence: number;
                affected_functions: string[];
                affected_lines: { file: string; start: number; end: number }[];
                exploit_scenario: string;
                proof_of_concept?: string;
                estimated_impact_usd?: number;
              }>
            >(prompt);

            for (const raw of rawFindings) {
              findings.push({
                id: `${expertDef.name}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                type: raw.type as VulnerabilityFinding['type'],
                title: raw.title,
                description: raw.description,
                severity: raw.severity as VulnerabilityFinding['severity'],
                confidence: raw.confidence,
                affectedFunctions: raw.affected_functions,
                affectedLines: raw.affected_lines,
                exploitScenario: raw.exploit_scenario,
                proofOfConcept: raw.proof_of_concept,
                estimatedImpactUsd: raw.estimated_impact_usd,
                discoveredBy: expertDef.name,
                timestamp: new Date(),
                status: 'proposed',
              });
            }
          } catch (error) {
            this.log(
              'parallel-analysis',
              `${expertDef.name} error`,
              error instanceof Error ? error.message : 'Unknown error'
            );
          }
        }

        return findings;
      })
    );

    const allFindings = await Promise.all(analysisPromises);
    this.state.findings = allFindings.flat();

    this.log(
      'parallel-analysis',
      'Analysis complete',
      `${this.state.findings.length} findings discovered`
    );
  }

  // ============================================================================
  // Stage 4: Adversarial Debate (Optimized)
  // ============================================================================

  private async adversarialDebate(): Promise<void> {
    if (!this.state) throw new Error('State not initialized');
    if (this.state.findings.length === 0) {
      this.log('adversarial-debate', 'No findings to debate', 'Skipping debate stage');
      return;
    }

    // OPTIMIZATION: Prioritize and limit findings for debate
    const MAX_FINDINGS_TO_DEBATE = 15;
    const severityWeight = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFORMATIONAL: 0 };

    // Sort by priority: severity × confidence
    const prioritizedFindings = [...this.state.findings]
      .sort((a, b) => {
        const scoreA = (severityWeight[a.severity] || 0) * a.confidence;
        const scoreB = (severityWeight[b.severity] || 0) * b.confidence;
        return scoreB - scoreA;
      })
      .slice(0, MAX_FINDINGS_TO_DEBATE);

    this.log(
      'adversarial-debate',
      'Prioritizing findings',
      `Selected top ${prioritizedFindings.length} of ${this.state.findings.length} findings for debate`
    );

    // Create debate agents
    const redTeam = [1, 2, 3].map((id) => {
      const agent = createAgent(AgentTemplates.redTeamAttacker(id));
      this.agents.set(`RedTeamAttacker_${id}`, agent);
      return agent;
    });

    const blueTeam = [1, 2].map((id) => {
      const agent = createAgent(AgentTemplates.blueTeamDefender(id));
      this.agents.set(`BlueTeamDefender_${id}`, agent);
      return agent;
    });

    const devilsAdvocates = [1, 2].map((id) => {
      const agent = createAgent(AgentTemplates.devilsAdvocate(id));
      this.agents.set(`DevilsAdvocate_${id}`, agent);
      return agent;
    });

    const session: DebateSession = {
      id: `debate-${Date.now()}`,
      contractAddress: this.state.contracts[0]?.address ?? 'unknown',
      findings: prioritizedFindings,
      rounds: [],
      participants: [
        ...this.state.spawnedExperts.map((e) => e.name),
        ...redTeam.map((_, i) => `RedTeamAttacker_${i + 1}`),
        ...blueTeam.map((_, i) => `BlueTeamDefender_${i + 1}`),
        ...devilsAdvocates.map((_, i) => `DevilsAdvocate_${i + 1}`),
      ],
      startTime: new Date(),
    };

    const contractContext = this.state.contracts.map((c) => c.sourceCode).join('\n\n---\n\n');

    // OPTIMIZATION: Batch debate - process findings in parallel batches
    const BATCH_SIZE = 5;

    // Round 1: Presentations (parallel batches)
    this.log('adversarial-debate', 'Round 1', 'Specialists presenting findings');
    for (let i = 0; i < prioritizedFindings.length; i += BATCH_SIZE) {
      const batch = prioritizedFindings.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (finding) => {
          const expert = this.agents.get(finding.discoveredBy);
          if (expert) {
            const presentation = await expert.presentArgument(contractContext, JSON.stringify(finding));
            session.rounds.push({
              roundNumber: 1,
              type: 'PRESENTATION',
              entries: [{
                round: 1,
                speaker: finding.discoveredBy,
                role: 'proposer',
                content: presentation,
                action: 'present',
                timestamp: new Date(),
                targetFinding: finding.id,
              }],
              outcome: 'CONTINUES',
            });
            finding.status = 'debating';
          }
        })
      );
    }

    // Round 2: Red Team Attacks (parallel batches)
    this.log('adversarial-debate', 'Round 2', 'Red Team attacking');
    const debatingFindings = prioritizedFindings.filter((f) => f.status === 'debating');
    for (let i = 0; i < debatingFindings.length; i += BATCH_SIZE) {
      const batch = debatingFindings.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (finding, idx) => {
          const attacker = redTeam[idx % redTeam.length];
          const attack = await attacker.attackFinding(JSON.stringify(finding), contractContext);
          session.rounds.push({
            roundNumber: 2,
            type: 'ATTACK',
            entries: [{
              round: 2,
              speaker: attacker.getInfo().name,
              role: 'red-team',
              content: attack,
              action: 'attack',
              timestamp: new Date(),
              targetFinding: finding.id,
            }],
            outcome: 'CONTINUES',
          });
          finding.debateHistory = finding.debateHistory ?? [];
          finding.debateHistory.push({
            round: 2,
            speaker: attacker.getInfo().name,
            role: 'red-team',
            content: attack,
            action: 'attack',
            timestamp: new Date(),
            targetFinding: finding.id,
          });
        })
      );
    }

    // Round 3: Blue Team Defense (parallel batches)
    this.log('adversarial-debate', 'Round 3', 'Blue Team defending');
    for (let i = 0; i < debatingFindings.length; i += BATCH_SIZE) {
      const batch = debatingFindings.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (finding, idx) => {
          const defender = blueTeam[idx % blueTeam.length];
          const lastAttack = finding.debateHistory?.filter((e) => e.action === 'attack').pop()?.content ?? '';
          const defense = await defender.defendFinding(JSON.stringify(finding), lastAttack, contractContext);
          session.rounds.push({
            roundNumber: 3,
            type: 'DEFENSE',
            entries: [{
              round: 3,
              speaker: defender.getInfo().name,
              role: 'blue-team',
              content: defense,
              action: 'defend',
              timestamp: new Date(),
              targetFinding: finding.id,
            }],
            outcome: 'CONTINUES',
          });
          finding.debateHistory?.push({
            round: 3,
            speaker: defender.getInfo().name,
            role: 'blue-team',
            content: defense,
            action: 'defend',
            timestamp: new Date(),
            targetFinding: finding.id,
          });
        })
      );
    }

    // Round 4: Devil's Advocates Challenge (parallel batches)
    this.log('adversarial-debate', 'Round 4', "Devil's Advocates challenging");
    for (let i = 0; i < debatingFindings.length; i += BATCH_SIZE) {
      const batch = debatingFindings.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (finding, idx) => {
          const advocate = devilsAdvocates[idx % devilsAdvocates.length];
          const debateHistory = finding.debateHistory?.map((e) => `[${e.speaker}]: ${e.content}`).join('\n\n') ?? '';
          const challenge = await advocate.attackFinding(
            `Finding:\n${JSON.stringify(finding)}\n\nDebate History:\n${debateHistory}`,
            contractContext
          );
          session.rounds.push({
            roundNumber: 4,
            type: 'DEVILS_ADVOCATE',
            entries: [{
              round: 4,
              speaker: advocate.getInfo().name,
              role: 'devils-advocate',
              content: challenge,
              action: 'challenge',
              timestamp: new Date(),
              targetFinding: finding.id,
            }],
            outcome: 'CONTINUES',
          });
          finding.debateHistory?.push({
            round: 4,
            speaker: advocate.getInfo().name,
            role: 'devils-advocate',
            content: challenge,
            action: 'challenge',
            timestamp: new Date(),
            targetFinding: finding.id,
          });
        })
      );
    }

    session.endTime = new Date();
    this.state.debates.push(session);

    // Mark low-priority findings that weren't debated
    for (const finding of this.state.findings) {
      if (!prioritizedFindings.includes(finding)) {
        finding.status = 'proposed'; // Stays proposed, not debated
      }
    }

    this.log(
      'adversarial-debate',
      'Debate complete',
      `${session.rounds.length} rounds, ${prioritizedFindings.length} high-priority findings debated`
    );
  }

  // ============================================================================
  // Stage 5: Synthesis (The Pope)
  // ============================================================================

  private async synthesize(): Promise<void> {
    if (!this.state) throw new Error('State not initialized');

    const pope = createAgent(AgentTemplates.pope());
    this.agents.set('ThePope', pope);

    this.log('synthesis', 'Pope synthesizing', 'Analyzing all debate transcripts');

    // Compile full debate transcript
    const transcript = this.state.debates
      .map((session) => {
        return session.rounds
          .map((round) => {
            return `=== Round ${round.roundNumber}: ${round.type} ===\n${round.entries.map((e) => `[${e.speaker}] (${e.action}): ${e.content}`).join('\n')}`;
          })
          .join('\n\n');
      })
      .join('\n\n---\n\n');

    // Include finding IDs so Pope can reference them
    const findingsSummary = this.state.findings
      .map((f) => `- [id: ${f.id}] ${f.title} (${f.severity}, ${f.confidence * 100}% confidence) by ${f.discoveredBy}`)
      .join('\n');

    const prompt = `You have witnessed the entire debate. Here is the transcript:

${transcript}

Findings proposed:
${findingsSummary}

Contract context:
${this.state.contracts.map((c) => c.sourceCode).join('\n\n---\n\n')}

Synthesize the debate into truth. Output your synthesis as JSON.`;

    const { data: synthesis } = await pope.analyzeStructured<{
      synthesis: string;
      validated_vulnerabilities: Array<{
        id: string;
        title: string;
        description: string;
        severity: string;
        confidence: number;
      }>;
      rejected_vulnerabilities: Array<{ id: string; reason: string }>;
      novel_insights: string[];
      combined_attack_vector?: string;
      recommended_severity: string;
      estimated_impact_usd: number;
      confidence: number;
    }>(prompt);

    // Debug: Log what Pope returned
    console.log(`[Pope] Raw synthesis response:`);
    console.log(`  - validated_vulnerabilities: ${synthesis.validated_vulnerabilities?.length || 0}`);
    console.log(`  - rejected_vulnerabilities: ${synthesis.rejected_vulnerabilities?.length || 0}`);
    console.log(`  - novel_insights: ${synthesis.novel_insights?.length || 0}`);
    if (synthesis.validated_vulnerabilities?.length > 0) {
      console.log(`  - First validated: ${JSON.stringify(synthesis.validated_vulnerabilities[0])}`);
    }
    if (synthesis.synthesis) {
      console.log(`  - Summary: ${synthesis.synthesis.slice(0, 200)}...`);
    }

    // Update finding statuses based on Pope's synthesis
    for (const finding of this.state.findings) {
      const validated = synthesis.validated_vulnerabilities.find(
        (v) => v.id === finding.id || v.title === finding.title
      );
      const rejected = synthesis.rejected_vulnerabilities.find(
        (r) => r.id === finding.id
      );

      if (validated) {
        finding.status = 'validated';
        finding.severity = validated.severity as VulnerabilityFinding['severity'];
        finding.confidence = validated.confidence;
      } else if (rejected) {
        finding.status = 'rejected';
      }
    }

    this.state.synthesis = {
      summary: synthesis.synthesis,
      validatedVulnerabilities: this.state.findings.filter((f) => f.status === 'validated'),
      rejectedVulnerabilities: this.state.findings
        .filter((f) => f.status === 'rejected')
        .map((f) => ({
          finding: f,
          reason:
            synthesis.rejected_vulnerabilities.find((r) => r.id === f.id)?.reason ?? 'Unknown',
        })),
      novelInsights: synthesis.novel_insights,
      combinedAttackVector: synthesis.combined_attack_vector,
      recommendedSeverity: synthesis.recommended_severity as PopeSynthesis['recommendedSeverity'],
      estimatedImpactUsd: synthesis.estimated_impact_usd,
      confidence: synthesis.confidence,
    };

    this.log(
      'synthesis',
      'Synthesis complete',
      `${this.state.synthesis.validatedVulnerabilities.length} validated, ${this.state.synthesis.rejectedVulnerabilities.length} rejected`
    );
  }

  // ============================================================================
  // Stage 6: Exploit Forge
  // ============================================================================

  private async forgeExploits(): Promise<void> {
    if (!this.state || !this.state.synthesis) throw new Error('State not initialized');

    const validatedFindings = this.state.synthesis.validatedVulnerabilities;
    if (validatedFindings.length === 0) {
      this.log('exploit-forge', 'No validated findings', 'Skipping exploit forge');
      return;
    }

    // Create exploit smiths
    const smiths = {
      direct: createAgent(AgentTemplates.exploitSmith('direct')),
      flashLoan: createAgent(AgentTemplates.exploitSmith('flash-loan')),
      chained: createAgent(AgentTemplates.exploitSmith('chained')),
    };

    const forgeMaster = createAgent(AgentTemplates.forgeMaster());
    this.agents.set('ForgeMaster', forgeMaster);

    for (const finding of validatedFindings) {
      this.log('exploit-forge', 'Forging exploit', finding.title);

      const exploitContext = `Vulnerability:
${JSON.stringify(finding, null, 2)}

Contract:
${this.state.contracts.map((c) => c.sourceCode).join('\n\n---\n\n')}

Combined Attack Vector:
${this.state.synthesis?.combinedAttackVector ?? 'N/A'}

Write a Foundry test that exploits this vulnerability.`;

      // Run all three approaches in parallel
      const approaches = await Promise.all([
        this.concurrencyLimit(async () => {
          const response = await smiths.direct.analyze(exploitContext);
          return { name: 'direct', code: response.content };
        }),
        this.concurrencyLimit(async () => {
          const response = await smiths.flashLoan.analyze(exploitContext);
          return { name: 'flash-loan', code: response.content };
        }),
        this.concurrencyLimit(async () => {
          const response = await smiths.chained.analyze(exploitContext);
          return { name: 'chained', code: response.content };
        }),
      ]);

      // Forge Master combines them
      const combinePrompt = `You have 3 exploit approaches:

DIRECT APPROACH:
${approaches[0].code}

FLASH LOAN APPROACH:
${approaches[1].code}

CHAINED APPROACH:
${approaches[2].code}

Combine the best elements into a final, working exploit.
Output only the Foundry test code.`;

      const finalExploit = await forgeMaster.analyze(combinePrompt);

      this.state.exploits.push({
        id: `exploit-${finding.id}`,
        vulnerability: finding,
        approaches: approaches.map((a) => ({
          name: a.name,
          strategy: a.name as 'direct' | 'flash-loan' | 'chained',
          description: `${a.name} approach`,
          code: a.code,
          estimatedProfit: 0,
          capitalRequired: 0,
          successProbability: 0,
        })),
        finalExploit: finalExploit.content,
        testResults: [],
        verified: false,
        profitAchieved: 0,
      });

      finding.status = 'exploited';
    }

    this.log('exploit-forge', 'Forging complete', `${this.state.exploits.length} exploits created`);
  }

  // ============================================================================
  // Stage 7: Verification
  // ============================================================================

  private async verify(): Promise<void> {
    if (!this.state) throw new Error('State not initialized');

    const verifiers = [1, 2, 3].map((id) => {
      const agent = createAgent(AgentTemplates.verifier(id));
      this.agents.set(`Verifier_${id}`, agent);
      return agent;
    });

    for (const exploit of this.state.exploits) {
      this.log('verification', 'Verifying exploit', exploit.vulnerability.title);

      const verificationPrompt = `Verify this exploit:

Vulnerability:
${JSON.stringify(exploit.vulnerability, null, 2)}

Final Exploit Code:
${exploit.finalExploit}

Evaluate and output your verification as JSON.`;

      // Run all verifiers in parallel
      const votes = await Promise.all(
        verifiers.map((verifier) =>
          this.concurrencyLimit(async () => {
            const { data } = await verifier.analyzeStructured<{
              vote: 'pass' | 'fail';
              reason: string;
              reproducibility_score: number;
              novelty_score: number;
              feasibility_score: number;
              concerns: string[];
            }>(verificationPrompt);

            return {
              verifierId: verifier.getInfo().name,
              vote: data.vote,
              reason: data.reason,
              reproducibilityScore: data.reproducibility_score,
              noveltyScore: data.novelty_score,
              feasibilityScore: data.feasibility_score,
            };
          })
        )
      );

      const passCount = votes.filter((v) => v.vote === 'pass').length;
      const result: VerificationResult = {
        findingId: exploit.vulnerability.id,
        votes,
        consensus: passCount >= 2 ? 'PASS' : passCount === 0 ? 'FAIL' : 'SPLIT',
        confidenceScore: votes.reduce((sum, v) => sum + (v.reproducibilityScore + v.noveltyScore + v.feasibilityScore) / 3, 0) / votes.length,
        autoSubmit: passCount === 3,
      };

      this.state.verificationResults.push(result);
      exploit.verified = result.consensus === 'PASS';

      this.log(
        'verification',
        `Verification ${result.consensus}`,
        `${passCount}/3 verifiers passed`
      );
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private initializeState(bounty: PrioritizedBounty): PipelineState {
    return {
      currentStage: 'reconnaissance',
      bounty,
      contracts: bounty.contracts ?? [],
      spawnedExperts: [],
      findings: [],
      debates: [],
      exploits: [],
      verificationResults: [],
      startTime: new Date(),
      logs: [],
    };
  }

  private async executeStage<T>(stage: PipelineStage, fn: () => Promise<T>): Promise<T> {
    if (!this.state) throw new Error('State not initialized');
    this.state.currentStage = stage;
    this.log(stage, 'Stage started');

    const result = await fn();

    this.log(stage, 'Stage completed');
    return result;
  }

  private log(stage: PipelineStage, action: string, details?: string): void {
    const log: PipelineLog = {
      timestamp: new Date(),
      stage,
      action,
      details,
    };

    this.state?.logs.push(log);
    console.log(`[${stage}] ${action}${details ? `: ${details}` : ''}`);
  }

  private generateSummary(): string {
    if (!this.state) return 'No state';

    const validated = this.state.synthesis?.validatedVulnerabilities.length ?? 0;
    const verified = this.state.verificationResults.filter((r) => r.consensus === 'PASS').length;
    const autoSubmit = this.state.verificationResults.filter((r) => r.autoSubmit).length;

    return `Findings: ${this.state.findings.length}, Validated: ${validated}, Verified: ${verified}, Auto-submit: ${autoSubmit}`;
  }

  /**
   * Get total cost across all agents
   */
  getTotalCost(): number {
    let total = 0;
    for (const agent of this.agents.values()) {
      total += agent.getUsage().estimatedCost;
    }
    return total;
  }

  /**
   * Get current pipeline state
   */
  getState(): PipelineState | null {
    return this.state;
  }
}

/**
 * Create and configure a swarm orchestrator
 */
export function createSwarm(config?: Partial<SwarmConfig>): SwarmOrchestrator {
  const defaultConfig: SwarmConfig = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    maxConcurrentAgents: 5,
    maxDebateRounds: 5,
    minConfidenceToSubmit: 0.8,
    exploitProfitThreshold: 0.1,
    timeoutMs: 3600000, // 1 hour
    sandbox: {
      enabled: true,
      dockerImage: 'bounty-agents-sandbox:latest',
    },
    platforms: {
      immunefi: {
        enabled: true,
      },
    },
    logging: {
      level: 'info',
      saveTranscripts: true,
      transcriptDir: './transcripts',
    },
  };

  return new SwarmOrchestrator({ ...defaultConfig, ...config });
}
