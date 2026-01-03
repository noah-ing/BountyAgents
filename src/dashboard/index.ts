/**
 * The Vulnerability Swarm Dashboard
 *
 * Real-time terminal dashboard showing swarm activity.
 */

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import type {
  PipelineState,
  VulnerabilityFinding,
  ExpertDefinition,
  PipelineLog,
} from '../types/index.js';

// ============================================================================
// Dashboard Class
// ============================================================================

export class SwarmDashboard {
  private screen: blessed.Widgets.Screen;
  private grid: any;
  private widgets: {
    header: blessed.Widgets.BoxElement;
    stage: any;
    agents: any;
    findings: any;
    logs: any;
    costs: any;
    debate: any;
  };

  private state: {
    stage: string;
    agents: { name: string; status: string; role: string }[];
    findings: VulnerabilityFinding[];
    logs: string[];
    costs: { input: number; output: number; total: number };
    debateLog: string[];
  };

  constructor() {
    this.state = {
      stage: 'Initializing...',
      agents: [],
      findings: [],
      logs: [],
      costs: { input: 0, output: 0, total: 0 },
      debateLog: [],
    };

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'The Vulnerability Swarm',
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    this.widgets = this.createWidgets();
    this.setupKeyHandlers();
    this.render();
  }

  private createWidgets() {
    // Header banner (row 0, full width)
    const header = this.grid.set(0, 0, 1, 12, blessed.box, {
      content: this.getHeaderContent(),
      tags: true,
      style: {
        fg: 'cyan',
        bold: true,
      },
    });

    // Stage indicator (row 1, left side)
    const stage = this.grid.set(1, 0, 2, 4, contrib.lcd, {
      label: ' Current Stage ',
      segmentWidth: 0.06,
      segmentInterval: 0.11,
      strokeWidth: 0.1,
      elements: 8,
      display: 'INIT',
      elementSpacing: 4,
      elementPadding: 2,
      color: 'cyan',
    });

    // Active Agents (row 1, middle)
    const agents = this.grid.set(1, 4, 4, 4, contrib.table, {
      label: ' Active Agents ',
      keys: true,
      interactive: false,
      columnSpacing: 2,
      columnWidth: [20, 12, 15],
      style: {
        header: { fg: 'cyan', bold: true },
        cell: { fg: 'white' },
      },
    });

    // Findings (row 1, right side)
    const findings = this.grid.set(1, 8, 4, 4, contrib.table, {
      label: ' Findings ',
      keys: true,
      interactive: false,
      columnSpacing: 2,
      columnWidth: [25, 10, 8],
      style: {
        header: { fg: 'green', bold: true },
        cell: { fg: 'white' },
      },
    });

    // Costs (row 3, left side)
    const costs = this.grid.set(3, 0, 2, 4, contrib.donut, {
      label: ' API Costs ',
      radius: 8,
      arcWidth: 3,
      remainColor: 'black',
      yPadding: 2,
      data: [
        { percent: 0, label: 'Input', color: 'cyan' },
        { percent: 0, label: 'Output', color: 'magenta' },
      ],
    });

    // Debate Log (row 5, full width left)
    const debate = this.grid.set(5, 0, 4, 8, contrib.log, {
      label: ' Debate Arena ',
      tags: true,
      style: {
        fg: 'white',
        border: { fg: 'yellow' },
      },
    });

    // Activity Logs (row 5, right side + row 9 full)
    const logs = this.grid.set(5, 8, 7, 4, contrib.log, {
      label: ' Activity Log ',
      tags: true,
      style: {
        fg: 'white',
        border: { fg: 'cyan' },
      },
    });

    return { header, stage, agents, findings, logs, costs, debate };
  }

  private getHeaderContent(): string {
    return `{center}{bold}🐝 THE VULNERABILITY SWARM 🐝{/bold}{/center}
{center}{cyan-fg}An Army of Claude Opus 4.5 Agents Hunting for Bugs{/cyan-fg}{/center}`;
  }

  private setupKeyHandlers(): void {
    this.screen.key(['escape', 'q', 'C-c'], () => {
      return process.exit(0);
    });

    this.screen.key(['r'], () => {
      this.render();
    });
  }

  // ============================================================================
  // Update Methods
  // ============================================================================

  updateStage(stage: string): void {
    this.state.stage = stage;
    const shortStage = stage.slice(0, 8).toUpperCase().padEnd(8);
    this.widgets.stage.setDisplay(shortStage);
    this.log(`Stage: ${stage}`);
    this.render();
  }

  addAgent(agent: { name: string; role: string; status?: string }): void {
    this.state.agents.push({
      name: agent.name,
      role: agent.role,
      status: agent.status ?? 'active',
    });
    this.updateAgentsTable();
    this.log(`Agent spawned: ${agent.name}`);
  }

  updateAgent(name: string, status: string): void {
    const agent = this.state.agents.find((a) => a.name === name);
    if (agent) {
      agent.status = status;
      this.updateAgentsTable();
    }
  }

  removeAgent(name: string): void {
    this.state.agents = this.state.agents.filter((a) => a.name !== name);
    this.updateAgentsTable();
  }

  private updateAgentsTable(): void {
    const data = this.state.agents.map((a) => [a.name, a.role, a.status]);
    this.widgets.agents.setData({
      headers: ['Agent', 'Role', 'Status'],
      data: data.slice(-10), // Show last 10
    });
    this.render();
  }

  addFinding(finding: VulnerabilityFinding): void {
    this.state.findings.push(finding);
    this.updateFindingsTable();
    this.log(`Finding: ${finding.title} (${finding.severity})`);
  }

  updateFinding(id: string, status: string): void {
    const finding = this.state.findings.find((f) => f.id === id);
    if (finding) {
      finding.status = status as VulnerabilityFinding['status'];
      this.updateFindingsTable();
    }
  }

  private updateFindingsTable(): void {
    const data = this.state.findings.map((f) => [
      f.title.slice(0, 24),
      f.severity,
      f.status,
    ]);
    this.widgets.findings.setData({
      headers: ['Finding', 'Severity', 'Status'],
      data: data.slice(-10),
    });
    this.render();
  }

  updateCosts(input: number, output: number): void {
    this.state.costs.input = input;
    this.state.costs.output = output;
    // Opus pricing: $15/M input, $75/M output
    const inputCost = (input / 1_000_000) * 15;
    const outputCost = (output / 1_000_000) * 75;
    this.state.costs.total = inputCost + outputCost;

    const total = input + output;
    const inputPercent = total > 0 ? Math.round((input / total) * 100) : 50;
    const outputPercent = total > 0 ? Math.round((output / total) * 100) : 50;

    this.widgets.costs.setData([
      { percent: inputPercent, label: `In: ${(input / 1000).toFixed(1)}k`, color: 'cyan' },
      { percent: outputPercent, label: `Out: ${(output / 1000).toFixed(1)}k`, color: 'magenta' },
    ]);
    this.render();
  }

  addDebateEntry(speaker: string, action: string, content: string): void {
    const color =
      action === 'attack'
        ? 'red'
        : action === 'defend'
          ? 'blue'
          : action === 'challenge'
            ? 'yellow'
            : action === 'synthesize'
              ? 'magenta'
              : 'white';

    const truncatedContent = content.slice(0, 100).replace(/\n/g, ' ');
    const entry = `{${color}-fg}[${speaker}]{/${color}-fg} ${truncatedContent}...`;

    this.state.debateLog.push(entry);
    this.widgets.debate.log(entry);
    this.render();
  }

  log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `{gray-fg}${timestamp}{/gray-fg} ${message}`;
    this.state.logs.push(entry);
    this.widgets.logs.log(entry);
    this.render();
  }

  logSuccess(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `{gray-fg}${timestamp}{/gray-fg} {green-fg}✓{/green-fg} ${message}`;
    this.widgets.logs.log(entry);
    this.render();
  }

  logError(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `{gray-fg}${timestamp}{/gray-fg} {red-fg}✗{/red-fg} ${message}`;
    this.widgets.logs.log(entry);
    this.render();
  }

  // ============================================================================
  // Render
  // ============================================================================

  render(): void {
    this.screen.render();
  }

  destroy(): void {
    this.screen.destroy();
  }

  // ============================================================================
  // Full State Update
  // ============================================================================

  updateFromPipelineState(state: PipelineState): void {
    this.updateStage(state.currentStage);

    // Update agents
    this.state.agents = state.spawnedExperts.map((e) => ({
      name: e.name,
      role: e.type,
      status: 'active',
    }));
    this.updateAgentsTable();

    // Update findings
    this.state.findings = state.findings;
    this.updateFindingsTable();

    // Update logs
    for (const log of state.logs.slice(-20)) {
      this.log(`[${log.stage}] ${log.action}: ${log.details ?? ''}`);
    }

    this.render();
  }
}

// ============================================================================
// Simple Dashboard (non-blessed fallback)
// ============================================================================

export class SimpleDashboard {
  private startTime: Date;
  private state: {
    stage: string;
    agents: string[];
    findings: { title: string; severity: string; status: string }[];
    costs: { input: number; output: number };
  };

  constructor() {
    this.startTime = new Date();
    this.state = {
      stage: 'Initializing',
      agents: [],
      findings: [],
      costs: { input: 0, output: 0 },
    };
  }

  clear(): void {
    console.clear();
    this.printHeader();
  }

  private printHeader(): void {
    console.log('\n');
    console.log('  ╔═══════════════════════════════════════════════════════════════╗');
    console.log('  ║          🐝 THE VULNERABILITY SWARM 🐝                         ║');
    console.log('  ║     An Army of Claude Opus 4.5 Agents Hunting for Bugs        ║');
    console.log('  ╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
  }

  printStatus(): void {
    const elapsed = Math.round((Date.now() - this.startTime.getTime()) / 1000);
    const inputCost = (this.state.costs.input / 1_000_000) * 15;
    const outputCost = (this.state.costs.output / 1_000_000) * 75;
    const totalCost = inputCost + outputCost;

    console.log(`  ┌─ Stage ──────────────────────────────────────────────────────┐`);
    console.log(`  │  ${this.state.stage.padEnd(60)} │`);
    console.log(`  └──────────────────────────────────────────────────────────────┘`);
    console.log('');

    console.log(`  ┌─ Stats ──────────────────────────────────────────────────────┐`);
    console.log(`  │  Elapsed: ${elapsed}s | Agents: ${this.state.agents.length} | Findings: ${this.state.findings.length} | Cost: $${totalCost.toFixed(4)} │`);
    console.log(`  └──────────────────────────────────────────────────────────────┘`);
    console.log('');

    if (this.state.agents.length > 0) {
      console.log(`  ┌─ Active Agents ─────────────────────────────────────────────┐`);
      for (const agent of this.state.agents.slice(-5)) {
        console.log(`  │  • ${agent.padEnd(58)} │`);
      }
      console.log(`  └──────────────────────────────────────────────────────────────┘`);
      console.log('');
    }

    if (this.state.findings.length > 0) {
      console.log(`  ┌─ Findings ─────────────────────────────────────────────────────┐`);
      for (const f of this.state.findings.slice(-5)) {
        const line = `${f.title.slice(0, 35).padEnd(35)} [${f.severity}] ${f.status}`;
        console.log(`  │  ${line.padEnd(60)} │`);
      }
      console.log(`  └──────────────────────────────────────────────────────────────┘`);
    }
  }

  updateStage(stage: string): void {
    this.state.stage = stage;
  }

  addAgent(name: string): void {
    this.state.agents.push(name);
  }

  addFinding(title: string, severity: string, status: string): void {
    this.state.findings.push({ title, severity, status });
  }

  updateCosts(input: number, output: number): void {
    this.state.costs = { input, output };
  }

  log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`  [${timestamp}] ${message}`);
  }
}

// ============================================================================
// Exports
// ============================================================================

export function createDashboard(simple = false): SwarmDashboard | SimpleDashboard {
  if (simple || process.env.SIMPLE_DASHBOARD === 'true') {
    return new SimpleDashboard();
  }
  try {
    return new SwarmDashboard();
  } catch {
    return new SimpleDashboard();
  }
}
