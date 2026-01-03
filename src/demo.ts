#!/usr/bin/env node
/**
 * Demo Mode - Showcases The Vulnerability Swarm Dashboard
 *
 * Runs a simulated vulnerability hunt to demonstrate the system.
 */

import dotenv from 'dotenv';
import chalk from 'chalk';
import { createAgent, AgentTemplates } from './agents/base-agent.js';
import { SimpleDashboard } from './dashboard/index.js';

dotenv.config();

// Sample vulnerable contract for demo
const DEMO_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VulnerableVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // VULNERABLE: State update after external call
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // External call BEFORE state update - REENTRANCY!
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        balances[msg.sender] -= amount;
    }

    // VULNERABLE: No access control
    function emergencyWithdraw() external {
        // Anyone can call this!
        payable(msg.sender).transfer(address(this).balance);
    }
}`;

async function runDemo() {
  const dashboard = new SimpleDashboard();

  console.clear();
  console.log(chalk.cyan.bold('\n  🐝 THE VULNERABILITY SWARM - DEMO MODE 🐝\n'));
  console.log(chalk.gray('  This demo shows the swarm analyzing a vulnerable contract.\n'));
  console.log(chalk.yellow('  Target: VulnerableVault.sol (demo contract with known vulnerabilities)\n'));

  await sleep(1000);

  // Stage 1: Reconnaissance
  dashboard.updateStage('RECONNAISSANCE');
  dashboard.log('Starting reconnaissance...');
  await sleep(500);
  dashboard.log('Contract source loaded: VulnerableVault.sol');
  dashboard.log('Detected: 2 external functions, 1 state variable');
  await sleep(500);

  // Stage 2: Expert Spawning
  dashboard.updateStage('EXPERT SPAWNING');
  dashboard.log('Analyzing contract for expert requirements...');
  await sleep(500);

  const spawner = createAgent(AgentTemplates.expertSpawner());
  dashboard.log('Expert Spawner analyzing contract...');

  const spawnPrompt = `Analyze this contract and determine what vulnerability experts to spawn:

\`\`\`solidity
${DEMO_CONTRACT}
\`\`\`

Output as JSON with experts_to_spawn array.`;

  try {
    const { data: spawnResult } = await spawner.analyzeStructured<{
      contract_analysis: string;
      experts_to_spawn: Array<{ name: string; type: string; reason: string }>;
    }>(spawnPrompt);

    dashboard.updateCosts(spawner.getUsage().inputTokens, spawner.getUsage().outputTokens);

    console.log(chalk.cyan('\n  📊 Expert Spawner Analysis:'));
    console.log(chalk.gray(`  ${spawnResult.contract_analysis}\n`));

    for (const expert of spawnResult.experts_to_spawn) {
      dashboard.addAgent(expert.name);
      dashboard.log(`Spawned: ${expert.name} - ${expert.reason}`);
      await sleep(300);
    }
  } catch (error) {
    dashboard.log(`Expert spawning: ${error instanceof Error ? error.message : 'Error'}`);
  }

  await sleep(500);

  // Stage 3: Parallel Analysis
  dashboard.updateStage('ANALYSIS');
  dashboard.log('Running parallel vulnerability analysis...');
  await sleep(500);

  // Create a reentrancy expert
  const reentrancyExpert = createAgent({
    name: 'ReentrancyExpert',
    role: 'vulnerability-specialist',
    model: 'claude-sonnet-4-20250514',
    temperature: 0,
    systemPrompt: `You are a reentrancy vulnerability expert. Analyze contracts for reentrancy issues.
Output findings as JSON array with: type, title, description, severity, affected_functions, exploit_scenario.`,
  });

  dashboard.log('ReentrancyExpert analyzing...');

  try {
    const { data: findings } = await reentrancyExpert.analyzeStructured<
      Array<{
        type: string;
        title: string;
        description: string;
        severity: string;
        affected_functions: string[];
        exploit_scenario: string;
      }>
    >(`Analyze this contract for reentrancy vulnerabilities:

\`\`\`solidity
${DEMO_CONTRACT}
\`\`\`

Output as JSON array of findings.`);

    const usage = reentrancyExpert.getUsage();
    dashboard.updateCosts(
      spawner.getUsage().inputTokens + usage.inputTokens,
      spawner.getUsage().outputTokens + usage.outputTokens
    );

    for (const finding of findings) {
      dashboard.addFinding(finding.title, finding.severity, 'proposed');
      console.log(chalk.green(`\n  ✓ Finding: ${finding.title}`));
      console.log(chalk.gray(`    Severity: ${finding.severity}`));
      console.log(chalk.gray(`    ${finding.description.slice(0, 100)}...`));
      await sleep(300);
    }
  } catch (error) {
    dashboard.log(`Analysis error: ${error instanceof Error ? error.message : 'Error'}`);
  }

  await sleep(500);

  // Stage 4: Adversarial Debate (simulated)
  dashboard.updateStage('DEBATE');
  dashboard.log('Starting adversarial debate...');
  await sleep(500);

  const redTeam = createAgent(AgentTemplates.redTeamAttacker(1));
  dashboard.addAgent('RedTeamAttacker_1');

  console.log(chalk.red('\n  🔴 Red Team Attack:'));
  try {
    const attack = await redTeam.analyze(`Attack this reentrancy finding:

The withdraw() function in VulnerableVault.sol performs an external call before updating state,
allowing reentrancy attacks.

Challenge this finding - is it really exploitable? What protections might exist?
Be concise (2-3 sentences).`);

    console.log(chalk.gray(`  ${attack.content.slice(0, 200)}...`));

    const usage = redTeam.getUsage();
    dashboard.updateCosts(
      spawner.getUsage().inputTokens + usage.inputTokens,
      spawner.getUsage().outputTokens + usage.outputTokens
    );
  } catch (error) {
    console.log(chalk.gray(`  Attack: ${error instanceof Error ? error.message : 'Error'}`));
  }

  await sleep(500);

  const blueTeam = createAgent(AgentTemplates.blueTeamDefender(1));
  dashboard.addAgent('BlueTeamDefender_1');

  console.log(chalk.blue('\n  🔵 Blue Team Defense:'));
  try {
    const defense = await blueTeam.analyze(`Defend this reentrancy finding against the attack:

The attack claims the reentrancy might not be exploitable.
But looking at the code: withdraw() calls msg.sender BEFORE subtracting from balances[].
This is classic reentrancy. Defend the finding. Be concise (2-3 sentences).`);

    console.log(chalk.gray(`  ${defense.content.slice(0, 200)}...`));
  } catch (error) {
    console.log(chalk.gray(`  Defense: ${error instanceof Error ? error.message : 'Error'}`));
  }

  await sleep(500);

  // Stage 5: Synthesis
  dashboard.updateStage('SYNTHESIS');
  dashboard.log('Pope synthesizing debate...');
  dashboard.addAgent('ThePope');

  const pope = createAgent(AgentTemplates.pope());

  console.log(chalk.magenta('\n  👑 Pope Synthesis:'));
  try {
    const synthesis = await pope.analyze(`Synthesize this debate about VulnerableVault.sol:

FINDING: Reentrancy in withdraw() - external call before state update
RED TEAM: Questioned exploitability
BLUE TEAM: Confirmed classic reentrancy pattern

Is this valid? What severity? Be concise (3-4 sentences). Include "VALIDATED" or "REJECTED".`);

    console.log(chalk.gray(`  ${synthesis.content.slice(0, 300)}...`));

    // Update finding status based on synthesis
    if (synthesis.content.toLowerCase().includes('validated')) {
      dashboard.addFinding('Reentrancy in withdraw()', 'CRITICAL', 'validated');
    }
  } catch (error) {
    console.log(chalk.gray(`  Synthesis: ${error instanceof Error ? error.message : 'Error'}`));
  }

  await sleep(500);

  // Final Summary
  dashboard.updateStage('COMPLETE');
  console.log(chalk.cyan.bold('\n\n  ═══════════════════════════════════════════════════════════'));
  console.log(chalk.cyan.bold('                      HUNT COMPLETE'));
  console.log(chalk.cyan.bold('  ═══════════════════════════════════════════════════════════\n'));

  dashboard.printStatus();

  console.log(chalk.gray('\n\n  Demo complete! In a real run, the swarm would:'));
  console.log(chalk.gray('  • Fetch real contracts from Immunefi bounties'));
  console.log(chalk.gray('  • Spawn 10+ specialized experts per contract'));
  console.log(chalk.gray('  • Run 5 rounds of adversarial debate'));
  console.log(chalk.gray('  • Generate working Foundry exploit PoCs'));
  console.log(chalk.gray('  • Verify with 3 independent verifiers'));
  console.log(chalk.gray('  • Auto-submit on 3/3 verification pass\n'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run demo
runDemo().catch(console.error);
