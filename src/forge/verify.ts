/**
 * Foundry Exploit Verification
 *
 * Verifies exploits by running them on a forked blockchain.
 * Requirements:
 * - Foundry installed (forge, anvil, cast)
 * - Target contract source code
 * - Exploit PoC code
 *
 * Verification process:
 * 1. Fork mainnet at specific block
 * 2. Deploy exploit contract
 * 3. Run exploit
 * 4. Verify profit >= threshold
 * 5. Repeat across multiple blocks for consistency
 */

import { spawn } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ForgedExploit, ExploitTestResult, VulnerabilityFinding } from '../types/index.js';

interface VerificationConfig {
  rpcUrl: string; // Ethereum RPC URL (Alchemy, Infura, etc.)
  forkBlock?: number; // Specific block to fork from (default: latest)
  profitThreshold: number; // Minimum profit in native tokens (default: 0.1)
  timeout: number; // Test timeout in ms (default: 60000)
  numBlocks: number; // Number of blocks to test across (default: 3)
}

interface VerificationResult {
  success: boolean;
  profit: number;
  gasUsed: number;
  logs: string[];
  error?: string;
}

export class FoundryVerifier {
  private config: VerificationConfig;
  private workDir: string;

  constructor(config: Partial<VerificationConfig> = {}) {
    this.config = {
      rpcUrl: config.rpcUrl || process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
      forkBlock: config.forkBlock,
      profitThreshold: config.profitThreshold ?? 0.1,
      timeout: config.timeout ?? 60000,
      numBlocks: config.numBlocks ?? 3,
    };
    this.workDir = join(process.cwd(), '.forge-verify');
  }

  /**
   * Verify an exploit across multiple blocks
   */
  async verifyExploit(
    vulnerability: VulnerabilityFinding,
    exploitCode: string,
    targetContract: string
  ): Promise<ForgedExploit> {
    const results: ExploitTestResult[] = [];
    const id = uuidv4();

    // Get latest block if not specified
    const latestBlock = await this.getLatestBlock();
    const testBlocks = this.config.forkBlock
      ? [this.config.forkBlock]
      : [latestBlock, latestBlock - 100, latestBlock - 1000].slice(0, this.config.numBlocks);

    console.log(`\n[Foundry] Verifying exploit for: ${vulnerability.title}`);
    console.log(`[Foundry] Testing across ${testBlocks.length} blocks: ${testBlocks.join(', ')}`);

    for (const block of testBlocks) {
      const result = await this.runExploitAtBlock(id, exploitCode, targetContract, block);
      results.push({
        blockNumber: block,
        chain: 'ethereum',
        profit: result.profit,
        gasUsed: result.gasUsed,
        success: result.success,
        logs: result.logs,
        timestamp: new Date(),
      });

      if (result.success) {
        console.log(`[Foundry] Block ${block}: SUCCESS - Profit: ${result.profit} ETH`);
      } else {
        console.log(`[Foundry] Block ${block}: FAILED - ${result.error || 'Unknown error'}`);
      }
    }

    // Calculate overall success
    const successfulTests = results.filter((r) => r.success);
    const avgProfit = successfulTests.reduce((sum, r) => sum + r.profit, 0) / (successfulTests.length || 1);
    const verified = successfulTests.length >= Math.ceil(testBlocks.length / 2) && avgProfit >= this.config.profitThreshold;

    return {
      id,
      vulnerability,
      approaches: [
        {
          name: 'Primary',
          strategy: 'direct',
          description: 'Direct exploit approach',
          code: exploitCode,
          estimatedProfit: avgProfit,
          capitalRequired: 0,
          successProbability: successfulTests.length / results.length,
        },
      ],
      finalExploit: exploitCode,
      testResults: results,
      verified,
      profitAchieved: avgProfit,
    };
  }

  /**
   * Run exploit at specific block
   */
  private async runExploitAtBlock(
    id: string,
    exploitCode: string,
    targetContract: string,
    block: number
  ): Promise<VerificationResult> {
    const testDir = join(this.workDir, id, `block-${block}`);

    try {
      // Setup test directory
      await mkdir(testDir, { recursive: true });

      // Write foundry.toml
      await writeFile(
        join(testDir, 'foundry.toml'),
        `[profile.default]
src = "src"
out = "out"
libs = ["lib"]
fork_url = "${this.config.rpcUrl}"
fork_block_number = ${block}
gas_limit = 30000000

[rpc_endpoints]
mainnet = "${this.config.rpcUrl}"
`
      );

      // Write target contract
      await mkdir(join(testDir, 'src'), { recursive: true });
      await writeFile(join(testDir, 'src', 'Target.sol'), targetContract);

      // Write exploit test
      const testCode = this.wrapExploitAsTest(exploitCode);
      await mkdir(join(testDir, 'test'), { recursive: true });
      await writeFile(join(testDir, 'test', 'Exploit.t.sol'), testCode);

      // Run forge test
      const result = await this.runForgeTest(testDir);

      // Cleanup
      await rm(testDir, { recursive: true, force: true });

      return result;
    } catch (error) {
      // Cleanup on error
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {}

      return {
        success: false,
        profit: 0,
        gasUsed: 0,
        logs: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Wrap exploit code in a Foundry test harness
   */
  private wrapExploitAsTest(exploitCode: string): string {
    // If exploit code is already a complete test, use it directly
    if (exploitCode.includes('function test') && exploitCode.includes('import "forge-std')) {
      return exploitCode;
    }

    // Otherwise, wrap it in a test harness
    return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "forge-std/console.sol";

contract ExploitTest is Test {
    address constant ATTACKER = address(0xBEEF);
    uint256 constant INITIAL_BALANCE = 1 ether;

    function setUp() public {
        vm.deal(ATTACKER, INITIAL_BALANCE);
    }

    function testExploit() public {
        uint256 balanceBefore = ATTACKER.balance;

        // Execute exploit
        vm.startPrank(ATTACKER);
        ${this.extractExploitBody(exploitCode)}
        vm.stopPrank();

        uint256 balanceAfter = ATTACKER.balance;
        int256 profit = int256(balanceAfter) - int256(balanceBefore);

        console.log("Balance Before:", balanceBefore);
        console.log("Balance After:", balanceAfter);
        console.log("Profit:", profit > 0 ? uint256(profit) : 0);

        // Emit profit for parsing
        emit ExploitResult(profit > 0 ? uint256(profit) : 0);
    }

    event ExploitResult(uint256 profit);
}

${exploitCode.includes('contract') ? exploitCode : ''}
`;
  }

  /**
   * Extract the core exploit logic
   */
  private extractExploitBody(code: string): string {
    // If it's a function body, return as-is
    if (!code.includes('function') && !code.includes('contract')) {
      return code;
    }

    // Try to extract the attack function body
    const attackMatch = code.match(/function\s+(?:attack|exploit|run|execute)\s*\([^)]*\)[^{]*\{([\s\S]*)\}/);
    if (attackMatch) {
      return attackMatch[1];
    }

    // If it's a complete contract, we'll deploy and call it
    return `
        // Deploy and execute exploit contract
        Exploit exploit = new Exploit();
        exploit.attack();
    `;
  }

  /**
   * Run forge test and parse results
   */
  private async runForgeTest(testDir: string): Promise<VerificationResult> {
    return new Promise((resolve) => {
      const logs: string[] = [];
      let stdout = '';
      let stderr = '';

      const forge = spawn('forge', ['test', '-vvv', '--json'], {
        cwd: testDir,
        timeout: this.config.timeout,
      });

      forge.stdout.on('data', (data) => {
        stdout += data.toString();
        logs.push(data.toString());
      });

      forge.stderr.on('data', (data) => {
        stderr += data.toString();
        logs.push(`[stderr] ${data.toString()}`);
      });

      forge.on('close', (code) => {
        if (code !== 0) {
          resolve({
            success: false,
            profit: 0,
            gasUsed: 0,
            logs,
            error: stderr || 'Forge test failed',
          });
          return;
        }

        // Parse profit from logs
        const profitMatch = stdout.match(/Profit:\s*(\d+)/);
        const profit = profitMatch ? parseInt(profitMatch[1]) / 1e18 : 0;

        // Parse gas used
        const gasMatch = stdout.match(/Gas:\s*(\d+)/);
        const gasUsed = gasMatch ? parseInt(gasMatch[1]) : 0;

        resolve({
          success: profit >= this.config.profitThreshold,
          profit,
          gasUsed,
          logs,
        });
      });

      forge.on('error', (error) => {
        resolve({
          success: false,
          profit: 0,
          gasUsed: 0,
          logs,
          error: error.message,
        });
      });
    });
  }

  /**
   * Get latest block number
   */
  private async getLatestBlock(): Promise<number> {
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
      });
      const data = (await response.json()) as { result: string };
      return parseInt(data.result, 16);
    } catch {
      return 18000000; // Fallback to a known block
    }
  }

  /**
   * Check if Foundry is installed
   */
  async checkFoundryInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const forge = spawn('forge', ['--version']);
      forge.on('close', (code) => resolve(code === 0));
      forge.on('error', () => resolve(false));
    });
  }

  /**
   * Install Foundry if not present
   */
  async installFoundry(): Promise<void> {
    console.log('[Foundry] Installing Foundry...');
    return new Promise((resolve, reject) => {
      const install = spawn('sh', ['-c', 'curl -L https://foundry.paradigm.xyz | bash && foundryup'], {
        stdio: 'inherit',
      });
      install.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Foundry installation failed'));
      });
    });
  }
}
