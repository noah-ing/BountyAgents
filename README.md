# BountyAgents

Multi-agent AI system for autonomous bug bounty hunting on Immunefi.

## Architecture

```
                         THE VULNERABILITY SWARM

  STAGE 1: RECONNAISSANCE       STAGE 2: PARALLEL ANALYSIS
  +-------------------+         +---------------------------+
  |   SCOUT SWARM     |         |   VULNERABILITY EXPERTS   |
  | - Immunefi Monitor| ------> | - ReentrancyExpert        |
  | - Contract Fetcher|         | - AccessControlExpert     |
  | - Priority Ranker |         | - FlashLoanExpert         |
  +-------------------+         | - OracleExpert            |
                                | - LogicErrorExpert        |
                                | - Protocol-specific...    |
                                +---------------------------+
                                            |
                                            v
  STAGE 3: ADVERSARIAL DEBATE   STAGE 4: SYNTHESIS
  +---------------------------+ +---------------------------+
  |       THE ARENA           | |        THE POPE           |
  | Round 1: Presentations    | |                           |
  | Round 2: Red Team Attack  | | - Validates survivors     |
  | Round 3: Blue Team Defense| | - Finds connections       |
  | Round 4: Devil's Advocate | | - Creates novel insights  |
  +---------------------------+ +---------------------------+
                                            |
                                            v
  STAGE 5: EXPLOIT FORGE        STAGE 6: VERIFICATION
  +---------------------------+ +---------------------------+
  |    EXPLOIT SMITHS         | |   VERIFICATION TRIBUNAL   |
  | - Direct approach         | | - Reproducibility check   |
  | - Flash loan amplified    | | - Novelty verification    |
  | - Chained vulnerabilities | | - Feasibility assessment  |
  +---------------------------+ +---------------------------+
```

## Features

- Dynamic expert spawning based on contract analysis
- Adversarial debate system to eliminate false positives
- Strategic prioritization favoring fresh, less-audited programs
- Real-time dashboard at localhost:3000
- Auto-submission queue for validated findings
- Credit tracking and cost estimation

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Add your ANTHROPIC_API_KEY and ETHERSCAN_API_KEY

# Start the dashboard
npm start

# Open http://localhost:3000 and click "Start Hunting"
```

## Configuration

Create a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...
ETHERSCAN_API_KEY=...
```

## Project Structure

```
src/
  agents/           # Agent definitions and templates
    base-agent.ts   # Base agent class with debate methods
    synthesis/      # Pope synthesis agent
    forge/          # Exploit generation agents
  autonomous/       # Continuous hunting loop
  swarm/            # Orchestrator and pipeline
  platforms/        # Immunefi client
  server/           # Dashboard backend
public/             # Dashboard frontend
contracts/          # Foundry exploit templates
prompts/            # Knowledge base for experts
```

## How It Works

1. **Scout Phase**: Fetches bounties from Immunefi, prioritizes by freshness and reward
2. **Expert Spawning**: Analyzes contract code, spawns relevant domain experts
3. **Parallel Analysis**: Each expert independently searches for vulnerabilities
4. **Adversarial Debate**: Red Team attacks findings, Blue Team defends, Devil's Advocates challenge
5. **Pope Synthesis**: Validates survivors, finds connections, creates novel insights
6. **Exploit Forge**: Generates working PoC for validated vulnerabilities
7. **Verification**: Independent verification before submission

## Prioritization Strategy

The system heavily favors fresh programs:
- Programs < 30 days old: 10x priority
- Programs < 90 days old: 5x priority
- Programs < 6 months old: 2x priority
- Programs > 2 years old: 0.1x priority (already picked over)

## License

MIT
