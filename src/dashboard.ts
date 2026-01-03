#!/usr/bin/env node
/**
 * Dashboard Entry Point
 *
 * Starts the web dashboard for The Vulnerability Swarm.
 * Open http://localhost:3000 in your browser to control the swarm.
 */

import 'dotenv/config';
import { DashboardServer } from './server/index.js';
import type { SwarmConfig } from './types/index.js';

const config: SwarmConfig = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  maxConcurrentAgents: 10,
  maxDebateRounds: 5,
  minConfidenceToSubmit: 0.8,
  exploitProfitThreshold: 0.1,
  timeoutMs: 300000,
  sandbox: {
    enabled: true,
    dockerImage: 'ghcr.io/foundry-rs/foundry:latest',
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

// Validate API key
if (!config.anthropicApiKey) {
  console.error(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  ERROR: ANTHROPIC_API_KEY not set                                             ║
║                                                                               ║
║  Set your API key in .env file:                                               ║
║  ANTHROPIC_API_KEY=sk-ant-...                                                 ║
║                                                                               ║
║  Or set it as an environment variable:                                        ║
║  export ANTHROPIC_API_KEY=sk-ant-...                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
  `);
  process.exit(1);
}

// Parse credit limit from args or env
const creditLimit = parseFloat(process.env.CREDIT_LIMIT || '100');

// Start dashboard
const port = parseInt(process.env.PORT || '3000', 10);
const dashboard = new DashboardServer(config, creditLimit);
dashboard.start(port);

console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║   🐝 THE VULNERABILITY SWARM                                                  ║
║                                                                               ║
║   Dashboard: http://localhost:${port}                                           ║
║   Credit Limit: $${creditLimit.toFixed(2)}                                              ║
║                                                                               ║
║   Controls:                                                                   ║
║   • Click "Start Hunting" to begin autonomous bounty hunting                  ║
║   • Click "Pause" to temporarily halt                                         ║
║   • Click "Stop" to finish current hunt and stop                              ║
║                                                                               ║
║   The swarm will:                                                             ║
║   1. Fetch bounties from Immunefi                                             ║
║   2. Prioritize by reward/difficulty                                          ║
║   3. Spawn specialized experts                                                ║
║   4. Analyze contracts in parallel                                            ║
║   5. Debate findings (Red Team vs Blue Team)                                  ║
║   6. Synthesize validated vulnerabilities                                     ║
║   7. Forge and verify exploits                                                ║
║   8. Queue submissions for your approval                                      ║
║                                                                               ║
║   Press Ctrl+C to shutdown                                                    ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
