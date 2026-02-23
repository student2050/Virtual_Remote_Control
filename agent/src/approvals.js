/**
 * Antigravity Agent — Interactive Approval Handler
 * Prompts the user in the terminal to approve/reject or auto-resolves based on config
 */

const readline = require('readline');
const chalk = require('chalk');
const log = require('./logger');
const config = require('./config');
const { waitForApproval } = require('./api');

/**
 * Handle an incoming approval request.
 * - If auto-approve is on and risk is within threshold → auto-approve via mobile push
 * - Otherwise → prompt user in terminal (y/n/i)
 *
 * Returns: 'approved' | 'rejected' | 'expired' | 'skipped'
 */
async function handleApproval(api, connector, approval) {
    log.approvalRequest(approval);

    // ── Auto-approve check ───────────────────────────────────────────────────
    const autoRisk = config.get('autoApproveRisk');  // 'none' | 'low' | 'medium'
    const riskOrder = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
    const requestRisk = riskOrder[approval.risk_level] || 0;
    const autoLevel = riskOrder[autoRisk] || 0;

    if (config.get('autoApprove') && requestRisk <= autoLevel && autoRisk !== 'none') {
        log.success(`Auto-aprobado (riesgo ${approval.risk_level} ≤ ${autoRisk})`);
        // Auto-approval happens on mobile side — we just wait for it passively
        // but since we control the terminal, let's signal via REST
        try {
            const upd = await api.request('POST',
                `/api/workspaces/${approval.workspace_id}/approvals/${approval.id}/resolve`,
                { action: 'approved', comment: 'Auto-approved by agent (low risk)' }
            );
        } catch { }
        return 'approved';
    }

    // ── Interactive terminal prompt ──────────────────────────────────────────
    return new Promise((resolve) => {
        const timeoutMs = new Date(approval.expires_at) - Date.now();
        if (timeoutMs <= 0) { resolve('expired'); return; }

        const timeout = setTimeout(() => {
            console.log('');
            log.warn('Aprobación expirada sin respuesta.');
            rl.close();
            resolve('expired');
        }, timeoutMs);

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
        });

        const prompt = () => {
            rl.question(
                chalk.yellow('  Aprobar? ') +
                chalk.bold('[s]í / [n]o / [i]nfo') +
                chalk.yellow(' → '),
                (answer) => {
                    const a = answer.trim().toLowerCase();
                    if (['s', 'si', 'sí', 'y', 'yes'].includes(a)) {
                        clearTimeout(timeout);
                        rl.close();
                        resolve('approved');
                    } else if (['n', 'no'].includes(a)) {
                        clearTimeout(timeout);
                        rl.close();
                        resolve('rejected');
                    } else if (a === 'i') {
                        console.log('');
                        console.log(chalk.dim(`  ID:          ${approval.id}`));
                        console.log(chalk.dim(`  Workspace:   ${approval.workspace_id}`));
                        console.log(chalk.dim(`  Metadata:    ${approval.metadata}`));
                        console.log('');
                        prompt();
                    } else {
                        console.log(chalk.dim('  (s = sí, n = no, i = más info)'));
                        prompt();
                    }
                }
            );
        };

        prompt();
    });
}

module.exports = { handleApproval };
