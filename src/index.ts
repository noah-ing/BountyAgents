#!/usr/bin/env node
/**
 * The Vulnerability Swarm CLI
 *
 * An army of Claude Opus 4.5 agents that debate, argue, challenge,
 * and synthesize their way to finding vulnerabilities worth MILLIONS.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
import { createSwarm } from './swarm/orchestrator.js';
import { createScoutSwarm, parseImmunefiData } from './agents/scouts/immunefi-monitor.js';
import { createImmunefiMCP } from './mcp/servers/immunefi.js';
import type { PrioritizedBounty } from './types/index.js';

// Load environment variables
dotenv.config();

const VERSION = '0.1.0';

// ============================================================================
// CLI Setup
// ============================================================================

const program = new Command();

program
  .name('bounty-hunt')
  .description(chalk.bold('🔍 The Vulnerability Swarm') + '\nAn army of Claude Opus 4.5 agents hunting for bugs')
  .version(VERSION);

// ============================================================================
// Hunt Command - Main Pipeline
// ============================================================================

program
  .command('hunt')
  .description('Start the vulnerability hunting pipeline')
  .option('-t, --target <program>', 'Target a specific bounty program')
  .option('-n, --top <number>', 'Hunt the top N bounties', '5')
  .option('--min-reward <usd>', 'Minimum reward threshold', '10000')
  .option('--dry-run', 'Analyze without running exploits')
  .option('--no-debate', 'Skip adversarial debate (faster but less accurate)')
  .action(async (options) => {
    console.log(chalk.cyan.bold('\n🐝 THE VULNERABILITY SWARM'));
    console.log(chalk.gray('An army of Claude Opus 4.5 agents hunting for bugs\n'));

    // Verify API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(chalk.red('Error: ANTHROPIC_API_KEY not set'));
      console.log(chalk.gray('Set it in .env or export ANTHROPIC_API_KEY=your-key'));
      process.exit(1);
    }

    const spinner = ora('Initializing swarm...').start();

    try {
      // Initialize components
      const scoutSwarm = createScoutSwarm();
      const immunefiMCP = createImmunefiMCP();
      const swarm = createSwarm({
        maxConcurrentAgents: 5,
        maxDebateRounds: options.debate ? 5 : 0,
      });

      // Step 1: Discover bounties
      spinner.text = 'Scouting Immunefi bounties...';
      const rawPrograms = await immunefiMCP.listPrograms({
        minReward: parseInt(options.minReward),
        type: 'smart_contract',
      });

      spinner.text = `Analyzing ${rawPrograms.length} bounty programs...`;
      const prioritized = await scoutSwarm.discoverBounties(rawPrograms);

      // Step 2: Select targets
      let targets: PrioritizedBounty[];

      if (options.target) {
        const found = prioritized.find(
          (p) => p.name.toLowerCase() === options.target.toLowerCase() || p.id === options.target
        );
        if (!found) {
          spinner.fail(`Target program not found: ${options.target}`);
          process.exit(1);
        }
        targets = [found];
      } else {
        spinner.text = 'Ranking bounties...';
        targets = await scoutSwarm.rankBounties(prioritized, parseInt(options.top));
      }

      spinner.succeed(`Selected ${targets.length} target(s)`);

      // Display targets
      console.log(chalk.cyan('\n📋 Target Bounties:\n'));
      for (const target of targets) {
        console.log(chalk.white(`  ${chalk.bold(target.name)}`));
        console.log(chalk.gray(`     Max Reward: ${chalk.green('$' + target.maxReward.toLocaleString())}`));
        console.log(chalk.gray(`     Priority: ${chalk.yellow(target.priorityScore.toFixed(2))}`));
        console.log(chalk.gray(`     Difficulty: ${target.estimatedDifficulty}`));
        console.log(chalk.gray(`     Reasons: ${target.reasons.slice(0, 2).join(', ')}`));
        console.log();
      }

      // Step 3: Fetch contracts
      spinner.start('Fetching contract source code...');
      for (const target of targets) {
        target.contracts = await scoutSwarm.fetchContracts(target);
      }
      spinner.succeed('Contracts fetched');

      // Step 4: Run the swarm on each target
      for (const target of targets) {
        console.log(chalk.cyan(`\n🎯 Hunting: ${chalk.bold(target.name)}\n`));

        if (target.contracts.length === 0) {
          console.log(chalk.yellow('  ⚠ No contracts found in scope, skipping...'));
          continue;
        }

        if (target.contracts.some((c) => !c.sourceCode || c.sourceCode === '')) {
          console.log(chalk.yellow('  ⚠ Contract source code not available yet'));
          console.log(chalk.gray('    Use etherscan MCP to fetch: bounty-hunt analyze --address <address>'));
          continue;
        }

        if (options.dryRun) {
          console.log(chalk.gray('  [DRY RUN] Would analyze contracts...'));
          continue;
        }

        spinner.start('Spawning expert agents...');
        const state = await swarm.hunt(target);

        // Report results
        spinner.stop();
        console.log(chalk.cyan('\n📊 Results:\n'));
        console.log(chalk.gray(`  Experts spawned: ${state.spawnedExperts.length}`));
        console.log(chalk.gray(`  Findings: ${state.findings.length}`));

        if (state.synthesis) {
          console.log(chalk.gray(`  Validated: ${state.synthesis.validatedVulnerabilities.length}`));
          console.log(chalk.gray(`  Rejected: ${state.synthesis.rejectedVulnerabilities.length}`));

          if (state.synthesis.validatedVulnerabilities.length > 0) {
            console.log(chalk.green('\n  ✓ Validated Vulnerabilities:'));
            for (const vuln of state.synthesis.validatedVulnerabilities) {
              console.log(chalk.white(`    - ${vuln.title} (${vuln.severity})`));
            }
          }

          if (state.synthesis.novelInsights.length > 0) {
            console.log(chalk.magenta('\n  💡 Novel Insights:'));
            for (const insight of state.synthesis.novelInsights) {
              console.log(chalk.gray(`    - ${insight}`));
            }
          }
        }

        if (state.verificationResults.length > 0) {
          const passed = state.verificationResults.filter((r) => r.consensus === 'PASS');
          console.log(chalk.gray(`\n  Exploits verified: ${passed.length}/${state.verificationResults.length}`));

          const autoSubmit = state.verificationResults.filter((r) => r.autoSubmit);
          if (autoSubmit.length > 0) {
            console.log(chalk.green.bold(`\n  🚀 ${autoSubmit.length} finding(s) ready for auto-submission!`));
          }
        }

        // Cost report
        const cost = swarm.getTotalCost();
        console.log(chalk.gray(`\n  Estimated cost: $${cost.toFixed(4)}`));
      }

      // Final summary
      console.log(chalk.cyan.bold('\n✅ Hunt complete!\n'));

    } catch (error) {
      spinner.fail('Hunt failed');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// ============================================================================
// Scout Command - List/Search Bounties
// ============================================================================

program
  .command('scout')
  .description('Scout for bug bounties without attacking')
  .option('-s, --search <query>', 'Search for specific programs')
  .option('-n, --limit <number>', 'Number of results', '20')
  .option('--min-reward <usd>', 'Minimum reward threshold', '0')
  .action(async (options) => {
    const spinner = ora('Scouting bounties...').start();

    try {
      const immunefiMCP = createImmunefiMCP();
      let programs;

      if (options.search) {
        programs = await immunefiMCP.searchPrograms(options.search);
      } else {
        programs = await immunefiMCP.listPrograms({
          minReward: parseInt(options.minReward),
          limit: parseInt(options.limit),
          type: 'smart_contract',
        });
      }

      spinner.succeed(`Found ${programs.length} bounty programs`);

      console.log(chalk.cyan('\n📋 Immunefi Bounties:\n'));

      for (const prog of programs.slice(0, parseInt(options.limit))) {
        const reward = chalk.green('$' + prog.maxReward.toLocaleString());
        const contracts = prog.assets.filter((a) => a.type === 'smart_contract').length;
        console.log(
          `  ${chalk.bold(prog.name.padEnd(30))} Max: ${reward.padEnd(20)} Contracts: ${contracts}`
        );
      }

      console.log(chalk.gray(`\nShowing ${Math.min(programs.length, parseInt(options.limit))} of ${programs.length} programs`));
      console.log(chalk.gray('Use --limit to see more, or --search to filter\n'));

    } catch (error) {
      spinner.fail('Scout failed');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// ============================================================================
// Analyze Command - Analyze Specific Contract
// ============================================================================

program
  .command('analyze')
  .description('Analyze a specific contract or program')
  .option('-a, --address <address>', 'Contract address to analyze')
  .option('-p, --program <name>', 'Bounty program name')
  .option('-c, --chain <chain>', 'Blockchain (ethereum, arbitrum, etc.)', 'ethereum')
  .option('--no-exploit', 'Skip exploit generation')
  .action(async (options) => {
    if (!options.address && !options.program) {
      console.error(chalk.red('Error: Must specify --address or --program'));
      process.exit(1);
    }

    console.log(chalk.cyan.bold('\n🔬 Contract Analysis\n'));

    const spinner = ora('Preparing analysis...').start();

    try {
      // TODO: Implement single contract analysis
      spinner.info('Single contract analysis coming soon...');
      console.log(chalk.gray('\nFor now, use: bounty-hunt hunt --target <program>'));

    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// ============================================================================
// Status Command - Check System Status
// ============================================================================

program
  .command('status')
  .description('Check system status and dependencies')
  .action(async () => {
    console.log(chalk.cyan.bold('\n🔧 System Status\n'));

    const checks = [
      { name: 'ANTHROPIC_API_KEY', check: () => !!process.env.ANTHROPIC_API_KEY },
      { name: 'Node.js', check: () => process.version },
      {
        name: 'ibb CLI',
        check: async () => {
          try {
            const { spawn } = await import('child_process');
            return new Promise((resolve) => {
              const proc = spawn('ibb', ['--version']);
              proc.on('close', (code) => resolve(code === 0 ? 'installed' : false));
              proc.on('error', () => resolve(false));
            });
          } catch {
            return false;
          }
        },
      },
      {
        name: 'Foundry (forge)',
        check: async () => {
          try {
            const { spawn } = await import('child_process');
            return new Promise((resolve) => {
              const proc = spawn('forge', ['--version']);
              let output = '';
              proc.stdout.on('data', (d) => (output += d));
              proc.on('close', (code) => resolve(code === 0 ? output.trim().split('\n')[0] : false));
              proc.on('error', () => resolve(false));
            });
          } catch {
            return false;
          }
        },
      },
      {
        name: 'Slither',
        check: async () => {
          try {
            const { spawn } = await import('child_process');
            return new Promise((resolve) => {
              const proc = spawn('slither', ['--version']);
              let output = '';
              proc.stdout.on('data', (d) => (output += d));
              proc.on('close', (code) => resolve(code === 0 ? output.trim() : false));
              proc.on('error', () => resolve(false));
            });
          } catch {
            return false;
          }
        },
      },
      {
        name: 'Docker',
        check: async () => {
          try {
            const { spawn } = await import('child_process');
            return new Promise((resolve) => {
              const proc = spawn('docker', ['--version']);
              let output = '';
              proc.stdout.on('data', (d) => (output += d));
              proc.on('close', (code) => resolve(code === 0 ? 'installed' : false));
              proc.on('error', () => resolve(false));
            });
          } catch {
            return false;
          }
        },
      },
    ];

    for (const { name, check } of checks) {
      const result = await check();
      const status = result
        ? chalk.green('✓') + ' ' + chalk.white(name) + chalk.gray(` (${result})`)
        : chalk.red('✗') + ' ' + chalk.gray(name);
      console.log('  ' + status);
    }

    console.log();
  });

// ============================================================================
// Parse and Execute
// ============================================================================

program.parse();

// Show help if no command
if (!process.argv.slice(2).length) {
  console.log(chalk.cyan.bold('\n🐝 THE VULNERABILITY SWARM'));
  console.log(chalk.gray('An army of Claude Opus 4.5 agents hunting for bugs\n'));
  program.help();
}
