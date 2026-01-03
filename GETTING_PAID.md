# Getting Paid: Complete Guide to Bug Bounty Submissions

## Quick Start

```bash
# 1. Start the dashboard
npm start

# 2. Open http://localhost:3000 in your browser

# 3. Click "Start Hunting" - the swarm runs until you stop it or run out of credits

# 4. When vulnerabilities are validated, they appear in the Submissions panel

# 5. Click "Submit" to send to Immunefi (currently opens prepared report)
```

---

## How Submission Works

### Step 1: Vulnerability Discovery

The swarm automatically:
1. Fetches active bounties from Immunefi
2. Downloads contract source code
3. Spawns specialized expert agents
4. Analyzes contracts in parallel
5. Debates findings (Red Team vs Blue Team)
6. Synthesizes validated vulnerabilities
7. Forges and verifies exploits on forked chain

### Step 2: Review Before Submission

When a vulnerability is validated:
- It appears in the **Submissions** panel on the dashboard
- Shows: Title, Severity, Program, Estimated Bounty Value
- Status: `pending` (awaiting your review)

**IMPORTANT**: Always review before submitting:
- Is the vulnerability real? (Check the PoC works)
- Is it in scope for this program?
- Has it been reported before? (Check public disclosures)
- Is the severity classification accurate?

### Step 3: Submitting to Immunefi

Click "Submit" on a pending finding. The system will:
1. Generate a formatted report (Immunefi's required format)
2. Save the report to `./reports/submission-{timestamp}.md`
3. Open the Immunefi submission page in your browser
4. Display the report for copy-paste

**Current Limitation**: Full automation requires browser auth. For now:
1. Log into Immunefi manually
2. Copy the generated report
3. Paste into the submission form
4. Attach any PoC files

### Step 4: After Submission

Track your submission:
1. Immunefi assigns a report ID
2. Status changes: `Pending` → `Triaging` → `Confirmed` or `Closed`
3. Typical response time: 24-72 hours for initial triage

---

## Immunefi Reward Structure

### Severity Levels

| Severity | Typical Range | Examples |
|----------|--------------|----------|
| **Critical** | $50K - $10M | Direct theft of funds, permanent freezing of funds |
| **High** | $10K - $100K | Theft of unclaimed yield, temporary freezing |
| **Medium** | $1K - $10K | Griefing attacks, protocol parameter manipulation |
| **Low** | $100 - $1K | Informational, minor issues |

### Bounty Calculation

Most programs use:
```
Bounty = min(MaxBounty, ImpactValue × SeverityMultiplier)
```

Where `ImpactValue` is typically:
- **Direct theft**: 10% of funds at risk
- **Indirect loss**: 5% of funds at risk
- **Griefing**: Cost to attacker vs cost to protocol

### Maximizing Your Payout

1. **Prove maximum impact**: Show worst-case scenario
2. **Provide working PoC**: Fork mainnet, show exact profit
3. **Calculate TVL at risk**: Higher TVL = higher payout
4. **Chain vulnerabilities**: Multiple bugs = multiplied impact
5. **Be responsive**: Answer triager questions quickly

---

## Payment Process

### Step 1: Vulnerability Confirmed

Immunefi will:
1. Verify your finding with the project
2. Assess severity (may differ from your submission)
3. Calculate bounty based on program rules

**Timeline**: 1-4 weeks after submission

### Step 2: Bounty Negotiation

If you disagree with the severity assessment:
1. Provide additional evidence
2. Reference similar past payouts
3. Show real-world impact scenarios

### Step 3: Payout Request

Immunefi will ask for:
1. **Wallet address** (ETH, Polygon, Arbitrum, etc.)
2. **Payment preference**: USDC, USDT, or project tokens
3. **KYC verification** (for bounties > $10K in many jurisdictions)

### Step 4: Receiving Payment

Payments are sent via:
- **USDC/USDT**: Direct transfer, usually within 1-2 weeks
- **Project tokens**: May have vesting periods (30-180 days)
- **ETH**: Less common but some projects prefer it

### Tax Considerations

**IMPORTANT**: Bug bounty income is taxable in most jurisdictions.

1. Keep records of all submissions and payments
2. Track USD value at time of receipt
3. Consider consulting a crypto-tax professional
4. Some jurisdictions treat it as:
   - Self-employment income (US)
   - Miscellaneous income (varies by country)

---

## Important Links

| Resource | URL |
|----------|-----|
| Immunefi Dashboard | https://immunefi.com/dashboard |
| Submit Report | https://immunefi.com/bounty/{program}/submit |
| Payment Status | https://immunefi.com/hackers/payments |
| Support | https://immunefi.com/support |
| Discord | https://discord.gg/immunefi |

---

## Common Issues

### "Duplicate" Rejection
- Check if similar reports exist in public disclosures
- Search project's GitHub issues
- Look for recent security advisories

### "Out of Scope" Rejection
- Re-read the bounty program scope carefully
- Some exclusions: governance attacks, admin key compromises, theoretical attacks

### "Informational" Downgrade
- Provide concrete exploit scenario
- Show actual fund loss (not just theoretical)
- Prove the attack is economically viable

### No Response
- Wait at least 72 hours
- Contact Immunefi support with report ID
- Be patient but persistent

---

## Pro Tips

1. **Quality over quantity**: One critical finding beats 10 low/info
2. **Write clear reports**: Triagers aren't always technical experts
3. **Provide PoC always**: "Trust me bro" doesn't work
4. **Follow up professionally**: Be respectful even if rejected
5. **Learn from rejections**: Understand why and improve
6. **Build reputation**: Good reports = faster future payouts

---

## Setting Up for Maximum Efficiency

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional - for contract source fetching
ETHERSCAN_API_KEY=...

# Optional - for forked chain testing
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Optional - credit limit (default $100)
CREDIT_LIMIT=50
```

### Running 24/7

For continuous hunting:
```bash
# Use screen or tmux
screen -S swarm
npm start
# Detach with Ctrl+A, D
# Reattach with: screen -r swarm

# Or use PM2
npm install -g pm2
pm2 start npm --name "swarm" -- start
pm2 logs swarm
```

### Monitoring Costs

The dashboard shows:
- Credits used (API costs)
- Credits remaining
- Cost per hunt

At ~$15/hunt average, $100 budget = ~6-7 full program scans.

---

## Legal Disclaimer

1. Only test on programs with active bug bounty programs
2. Never exploit vulnerabilities on mainnet
3. Follow responsible disclosure practices
4. This tool is for authorized security research only
5. You are responsible for your own actions

---

**Happy hunting!** 🐝
