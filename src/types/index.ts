/**
 * Core types for The Vulnerability Swarm
 */

// ============================================================================
// Agent Types
// ============================================================================

export type AgentModel = 'claude-sonnet-4-20250514' | 'claude-opus-4-20250514';

export type AgentRole =
  | 'scout'
  | 'expert-spawner'
  | 'vulnerability-specialist'
  | 'protocol-specialist'
  | 'pattern-specialist'
  | 'red-team'
  | 'blue-team'
  | 'devils-advocate'
  | 'pope'
  | 'exploit-smith'
  | 'forge-master'
  | 'verifier';

export interface AgentConfig {
  name: string;
  role: AgentRole;
  model: AgentModel;
  temperature: number;
  systemPrompt: string;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  agentName?: string;
}

export interface AgentResponse {
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  result: string;
  isError?: boolean;
}

// ============================================================================
// Vulnerability Types
// ============================================================================

export type VulnerabilityType =
  | 'reentrancy'
  | 'access-control'
  | 'flash-loan'
  | 'oracle-manipulation'
  | 'logic-error'
  | 'integer-overflow'
  | 'frontrunning'
  | 'cross-function-reentrancy'
  | 'cross-contract-reentrancy'
  | 'read-only-reentrancy'
  | 'price-manipulation'
  | 'governance-attack'
  | 'sandwich-attack'
  | 'donation-attack'
  | 'inflation-attack'
  | 'other';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFORMATIONAL';

export interface VulnerabilityFinding {
  id: string;
  type: VulnerabilityType;
  title: string;
  description: string;
  severity: Severity;
  confidence: number; // 0.0 - 1.0
  affectedFunctions: string[];
  affectedLines: { file: string; start: number; end: number }[];
  exploitScenario: string;
  proofOfConcept?: string;
  estimatedImpactUsd?: number;
  discoveredBy: string; // agent name
  timestamp: Date;
  status: 'proposed' | 'debating' | 'validated' | 'rejected' | 'exploited' | 'submitted';
  debateHistory?: DebateEntry[];
}

// ============================================================================
// Contract Types
// ============================================================================

export interface ContractInfo {
  address: string;
  name: string;
  chain: string;
  sourceCode: string;
  abi?: unknown[];
  compiler?: string;
  optimizationEnabled?: boolean;
  verified: boolean;
  tvl?: number; // Total Value Locked in USD
}

export interface BountyProgram {
  id: string;
  platform: 'immunefi' | 'code4rena' | 'sherlock';
  name: string;
  url: string;
  maxReward: number;
  assets: BountyAsset[];
  inScope: string[];
  outOfScope: string[];
  severity: {
    critical: { min: number; max: number };
    high: { min: number; max: number };
    medium: { min: number; max: number };
    low: { min: number; max: number };
  };
  launchDate: Date;
  lastUpdated: Date;
  totalPaid?: number;
  active: boolean;
}

export interface BountyAsset {
  type: 'smart_contract' | 'websites_and_applications' | 'blockchain_dlt';
  target: string;
  description?: string;
}

export interface PrioritizedBounty extends BountyProgram {
  priorityScore: number;
  reasons: string[];
  estimatedDifficulty: 'low' | 'medium' | 'high' | 'extreme';
  contracts: ContractInfo[];
}

// ============================================================================
// Debate Types
// ============================================================================

export interface DebateEntry {
  round: number;
  speaker: string;
  role: 'proposer' | 'red-team' | 'blue-team' | 'devils-advocate' | 'pope';
  content: string;
  action: 'present' | 'attack' | 'defend' | 'challenge' | 'concede' | 'synthesize';
  timestamp: Date;
  targetFinding?: string; // ID of finding being discussed
}

export interface DebateRound {
  roundNumber: number;
  type: 'PRESENTATION' | 'ATTACK' | 'DEFENSE' | 'DEVILS_ADVOCATE' | 'FINAL';
  entries: DebateEntry[];
  outcome: 'CONTINUES' | 'CONSENSUS' | 'REJECTED';
}

export interface DebateSession {
  id: string;
  contractAddress: string;
  findings: VulnerabilityFinding[];
  rounds: DebateRound[];
  participants: string[];
  startTime: Date;
  endTime?: Date;
  synthesis?: PopeSynthesis;
}

export interface PopeSynthesis {
  summary: string;
  validatedVulnerabilities: VulnerabilityFinding[];
  rejectedVulnerabilities: { finding: VulnerabilityFinding; reason: string }[];
  novelInsights: string[];
  combinedAttackVector?: string;
  recommendedSeverity: Severity;
  estimatedImpactUsd: number;
  confidence: number;
}

// ============================================================================
// Expert Spawning Types
// ============================================================================

export interface ExpertDefinition {
  name: string;
  type: 'vulnerability' | 'protocol' | 'pattern' | 'novel';
  reason: string;
  systemPrompt: string;
  focusAreas: string[];
  temperature: number;
  relevantKnowledge?: string[]; // paths to knowledge files
}

export interface ContractAnalysis {
  summary: string;
  detectedPatterns: string[];
  integrations: string[];
  expertsToSpawn: ExpertDefinition[];
  novelPatternsDetected: string[];
}

// ============================================================================
// Exploit Types
// ============================================================================

export interface ExploitApproach {
  name: string;
  strategy: 'direct' | 'flash-loan' | 'chained';
  description: string;
  code: string;
  estimatedProfit: number;
  capitalRequired: number;
  successProbability: number;
}

export interface ForgedExploit {
  id: string;
  vulnerability: VulnerabilityFinding;
  approaches: ExploitApproach[];
  finalExploit: string; // Solidity code
  testResults: ExploitTestResult[];
  verified: boolean;
  profitAchieved: number;
}

export interface ExploitTestResult {
  blockNumber: number;
  chain: string;
  profit: number;
  gasUsed: number;
  success: boolean;
  logs: string[];
  timestamp: Date;
}

// ============================================================================
// Verification Types
// ============================================================================

export interface VerificationVote {
  verifierId: string;
  vote: 'pass' | 'fail';
  reason: string;
  reproducibilityScore: number;
  noveltyScore: number;
  feasibilityScore: number;
}

export interface VerificationResult {
  findingId: string;
  votes: VerificationVote[];
  consensus: 'PASS' | 'FAIL' | 'SPLIT';
  confidenceScore: number;
  autoSubmit: boolean;
}

// ============================================================================
// Pipeline Types
// ============================================================================

export type PipelineStage =
  | 'reconnaissance'
  | 'expert-spawning'
  | 'parallel-analysis'
  | 'adversarial-debate'
  | 'synthesis'
  | 'exploit-forge'
  | 'verification'
  | 'submission';

export interface PipelineState {
  currentStage: PipelineStage;
  bounty: PrioritizedBounty;
  contracts: ContractInfo[];
  spawnedExperts: ExpertDefinition[];
  findings: VulnerabilityFinding[];
  debates: DebateSession[];
  synthesis?: PopeSynthesis;
  exploits: ForgedExploit[];
  verificationResults: VerificationResult[];
  startTime: Date;
  logs: PipelineLog[];
}

export interface PipelineLog {
  timestamp: Date;
  stage: PipelineStage;
  agent?: string;
  action: string;
  details?: string;
  cost?: { inputTokens: number; outputTokens: number };
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface SwarmConfig {
  anthropicApiKey: string;
  maxConcurrentAgents: number;
  maxDebateRounds: number;
  minConfidenceToSubmit: number;
  exploitProfitThreshold: number; // In native tokens (0.1 default)
  timeoutMs: number;
  sandbox: {
    enabled: boolean;
    dockerImage: string;
  };
  platforms: {
    immunefi: {
      enabled: boolean;
    };
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    saveTranscripts: boolean;
    transcriptDir: string;
  };
}
