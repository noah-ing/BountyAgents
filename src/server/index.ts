/**
 * Web Dashboard Server
 *
 * Real-time dashboard for The Vulnerability Swarm
 * - Start/Stop hunting with a button
 * - Real-time progress updates via WebSocket
 * - Submission queue management
 * - Credit/cost tracking
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AutonomousHunter } from '../autonomous/hunter.js';
import type { SwarmConfig } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface DashboardState {
  status: 'idle' | 'hunting' | 'paused' | 'stopping';
  currentTarget: string | null;
  totalFindings: number;
  validatedFindings: number;
  submittedFindings: number;
  totalBountyValue: number;
  creditsUsed: number;
  creditsRemaining: number;
  huntsSinceStart: number;
  uptime: number;
  logs: LogEntry[];
  submissions: SubmissionEntry[];
}

interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'success';
  stage: string;
  message: string;
  details?: string;
}

interface SubmissionEntry {
  id: string;
  timestamp: Date;
  platform: string;
  program: string;
  vulnerability: string;
  severity: string;
  status: 'pending' | 'submitted' | 'accepted' | 'rejected' | 'paid';
  bountyValue: number;
  txHash?: string;
}

export class DashboardServer {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private hunter: AutonomousHunter | null = null;
  private state: DashboardState;
  private startTime: Date = new Date();
  private creditLimit: number;

  constructor(config: SwarmConfig, creditLimit: number = 100) {
    this.creditLimit = creditLimit;
    this.state = {
      status: 'idle',
      currentTarget: null,
      totalFindings: 0,
      validatedFindings: 0,
      submittedFindings: 0,
      totalBountyValue: 0,
      creditsUsed: 0,
      creditsRemaining: creditLimit,
      huntsSinceStart: 0,
      uptime: 0,
      logs: [],
      submissions: [],
    };

    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    this.setupRoutes();
    this.setupWebSocket();

    // Initialize hunter
    this.hunter = new AutonomousHunter(config, {
      onLog: (entry) => this.addLog(entry),
      onStateUpdate: (update) => this.updateState(update),
      onSubmission: (submission) => this.addSubmission(submission),
    });

    // Update uptime every second
    setInterval(() => {
      this.state.uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
      this.broadcast({ type: 'uptime', uptime: this.state.uptime });
    }, 1000);
  }

  private setupRoutes(): void {
    this.app.use(express.json());
    this.app.use(express.static(join(__dirname, '../../public')));

    // API Routes
    this.app.get('/api/state', (_req, res) => {
      res.json(this.state);
    });

    this.app.post('/api/start', async (_req, res) => {
      if (this.state.status === 'hunting') {
        return res.status(400).json({ error: 'Already hunting' });
      }
      if (this.state.creditsRemaining <= 0) {
        return res.status(400).json({ error: 'No credits remaining' });
      }

      this.state.status = 'hunting';
      this.broadcast({ type: 'status', status: 'hunting' });
      this.addLog({ level: 'success', stage: 'system', message: 'Autonomous hunting started' });

      // Start hunting in background
      this.hunter?.start().catch((err) => {
        this.addLog({ level: 'error', stage: 'system', message: 'Hunt error', details: err.message });
      });

      res.json({ success: true });
    });

    this.app.post('/api/stop', (_req, res) => {
      if (this.state.status === 'idle') {
        return res.status(400).json({ error: 'Not hunting' });
      }

      this.state.status = 'stopping';
      this.broadcast({ type: 'status', status: 'stopping' });
      this.addLog({ level: 'warn', stage: 'system', message: 'Stop requested - finishing current hunt...' });

      this.hunter?.stop();
      res.json({ success: true });
    });

    this.app.post('/api/pause', (_req, res) => {
      if (this.state.status !== 'hunting') {
        return res.status(400).json({ error: 'Not hunting' });
      }

      this.state.status = 'paused';
      this.broadcast({ type: 'status', status: 'paused' });
      this.addLog({ level: 'info', stage: 'system', message: 'Hunting paused' });

      this.hunter?.pause();
      res.json({ success: true });
    });

    this.app.post('/api/resume', (_req, res) => {
      if (this.state.status !== 'paused') {
        return res.status(400).json({ error: 'Not paused' });
      }

      this.state.status = 'hunting';
      this.broadcast({ type: 'status', status: 'hunting' });
      this.addLog({ level: 'success', stage: 'system', message: 'Hunting resumed' });

      this.hunter?.resume();
      res.json({ success: true });
    });

    this.app.get('/api/submissions', (_req, res) => {
      res.json(this.state.submissions);
    });

    this.app.post('/api/submission/:id/submit', async (req, res) => {
      const submission = this.state.submissions.find((s) => s.id === req.params.id);
      if (!submission) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      // Actually submit to platform
      try {
        await this.hunter?.submitToPlatform(submission);
        submission.status = 'submitted';
        this.broadcast({ type: 'submission_update', submission });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Serve dashboard HTML
    this.app.get('/', (_req, res) => {
      res.sendFile(join(__dirname, '../../public/index.html'));
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      // Send current state on connect
      ws.send(JSON.stringify({ type: 'init', state: this.state }));

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  private broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
    const logEntry: LogEntry = {
      id: uuidv4(),
      timestamp: new Date(),
      ...entry,
    };
    this.state.logs.unshift(logEntry);
    if (this.state.logs.length > 500) {
      this.state.logs.pop();
    }
    this.broadcast({ type: 'log', log: logEntry });
  }

  private addSubmission(submission: Omit<SubmissionEntry, 'id' | 'timestamp'>): void {
    const entry: SubmissionEntry = {
      id: uuidv4(),
      timestamp: new Date(),
      ...submission,
    };
    this.state.submissions.unshift(entry);
    this.state.totalBountyValue += submission.bountyValue;
    this.broadcast({ type: 'submission', submission: entry });
  }

  private updateState(update: Partial<DashboardState>): void {
    Object.assign(this.state, update);

    // Check credit limit
    if (this.state.creditsUsed >= this.creditLimit) {
      this.addLog({ level: 'error', stage: 'system', message: 'Credit limit reached - stopping' });
      this.hunter?.stop();
      this.state.status = 'idle';
    }

    this.state.creditsRemaining = this.creditLimit - this.state.creditsUsed;
    this.broadcast({ type: 'state_update', update });
  }

  start(port: number = 3000): void {
    this.server.listen(port, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║   🐝 THE VULNERABILITY SWARM - DASHBOARD                                      ║
║                                                                               ║
║   Dashboard running at: http://localhost:${port}                                ║
║                                                                               ║
║   Open in your browser to:                                                    ║
║   • Start/Stop autonomous hunting                                             ║
║   • Monitor real-time progress                                                ║
║   • Review and submit findings                                                ║
║   • Track bounty earnings                                                     ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
      `);
    });
  }
}
