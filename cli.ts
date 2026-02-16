#!/usr/bin/env node

/**
 * Agent Pipeline Versioning - CLI
 * 
 * Command-line interface for the versioning system
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { createRepository, Repository } from './repository';
import { ArtifactType } from './types';

// Global repository instance
let repository: Repository;

// Initialize repository
async function initRepository(name: string = 'agent-pipeline'): Promise<Repository> {
  return createRepository(name, 'cli-signing-key');
}

// CLI Commands
const program = new Command();

program
  .name('apv')
  .description('Agent Pipeline Versioning - Enterprise multi-agent workflow version control')
  .version('1.0.0');

// ============================================================================
// Repository Commands
// ============================================================================

program
  .command('init')
  .description('Initialize a new repository')
  .argument('[name]', 'Repository name', 'agent-pipeline')
  .action(async (name: string) => {
    try {
      repository = await initRepository(name);
      console.log(chalk.green('✓ Repository "' + name + '" initialized successfully'));
      console.log(chalk.gray('  Default branch: main'));
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

// ============================================================================
// Artifact Commands
// ============================================================================

program
  .command('artifact:create')
  .description('Create a new artifact')
  .action(async () => {
    try {
      if (!repository) repository = await initRepository();
      
      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'type',
          message: 'Artifact type:',
          choices: ['workflow', 'prompt', 'model', 'tool', 'data'],
        },
        {
          type: 'input',
          name: 'name',
          message: 'Artifact name:',
          validate: (input: string) => input.length > 0 || 'Name is required',
        },
        {
          type: 'input',
          name: 'description',
          message: 'Description:',
        },
        {
          type: 'input',
          name: 'content',
          message: 'Content (JSON or text):',
        },
      ]);
      
      const artifact = await repository.createArtifact({
        type: answers.type as ArtifactType,
        name: answers.name,
        description: answers.description,
        content: JSON.parse(answers.content || '{}'),
        createdBy: 'cli-user',
      });
      
      console.log(chalk.green('✓ Artifact created: ' + artifact.name + ' (' + artifact.version + ')'));
      console.log(chalk.gray('  ID: ' + artifact.id));
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

program
  .command('artifact:list')
  .description('List all artifacts')
  .option('-t, --type <type>', 'Filter by type')
  .action(async (options: any) => {
    try {
      if (!repository) repository = await initRepository();
      
      const artifacts = repository.getArtifacts(options.type ? { type: options.type as ArtifactType } : undefined);
      
      if (artifacts.length === 0) {
        console.log(chalk.yellow('No artifacts found'));
        return;
      }
      
      console.log(chalk.bold('\nArtifacts (' + artifacts.length + '):\n'));
      
      for (const artifact of artifacts) {
        console.log(chalk.cyan(artifact.name));
        console.log(chalk.gray('  Version: ' + artifact.version + ' | Type: ' + artifact.type));
        console.log(chalk.gray('  ID: ' + artifact.id));
        console.log();
      }
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

program
  .command('artifact:show')
  .description('Show artifact details')
  .argument('<name>', 'Artifact name or ID')
  .action(async (name: string) => {
    try {
      if (!repository) repository = await initRepository();
      
      let artifact = repository.getArtifactByName(name);
      if (!artifact) {
        artifact = repository.getArtifact(name);
      }
      
      if (!artifact) {
        console.log(chalk.red('Artifact "' + name + '" not found'));
        return;
      }
      
      console.log(chalk.bold('\n' + artifact.name + '\n'));
      console.log(chalk.gray('  ID: ' + artifact.id));
      console.log(chalk.gray('  Version: ' + artifact.version));
      console.log(chalk.gray('  Type: ' + artifact.type));
      console.log(chalk.gray('  Created: ' + artifact.createdAt.toISOString()));
      console.log(chalk.gray('  Updated: ' + artifact.updatedAt.toISOString()));
      if (artifact.description) {
        console.log(chalk.gray('  Description: ' + artifact.description));
      }
      console.log(chalk.gray('  Content: ' + JSON.stringify(artifact.content, null, 2)));
      console.log();
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

// ============================================================================
// Commit Commands
// ============================================================================

program
  .command('commit')
  .description('Create a commit for an artifact')
  .argument('<artifact-name>', 'Artifact name')
  .argument('<message>', 'Commit message')
  .action(async (artifactName: string, message: string) => {
    try {
      if (!repository) repository = await initRepository();
      
      const artifact = repository.getArtifactByName(artifactName);
      if (!artifact) {
        console.log(chalk.red('Artifact "' + artifactName + '" not found'));
        return;
      }
      
      const commit = await repository.commit(artifact.id, message, 'cli-user');
      
      console.log(chalk.green('✓ Commit created: ' + commit.id.substring(0, 8)));
      console.log(chalk.gray('  Version: ' + commit.version));
      console.log(chalk.gray('  Message: ' + commit.message));
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

program
  .command('log')
  .description('Show commit history')
  .argument('[artifact-name]', 'Artifact name')
  .action(async (artifactName?: string) => {
    try {
      if (!repository) repository = await initRepository();
      
      if (artifactName) {
        const artifact = repository.getArtifactByName(artifactName);
        if (!artifact) {
          console.log(chalk.red('Artifact "' + artifactName + '" not found'));
          return;
        }
        
        const history = repository.getCommitHistory(artifact.id);
        
        console.log(chalk.bold('\nCommit history for ' + artifactName + ':\n'));
        
        for (const commit of history) {
          console.log(chalk.cyan('commit ' + commit.id.substring(0, 8)));
          console.log(chalk.gray('  Version: ' + commit.version));
          console.log(chalk.gray('  Author: ' + commit.author));
          console.log(chalk.gray('  Date: ' + commit.timestamp.toISOString()));
          console.log(chalk.gray('\n    ' + commit.message + '\n'));
        }
      } else {
        console.log(chalk.yellow('Please specify an artifact name'));
      }
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

// ============================================================================
// Branch Commands
// ============================================================================

program
  .command('branch:create')
  .description('Create a new branch')
  .argument('<name>', 'Branch name')
  .option('-b, --base <branch>', 'Base branch')
  .action(async (name: string, options: any) => {
    try {
      if (!repository) repository = await initRepository();
      
      await repository.createBranch(name, 'cli-user', options.base);
      
      console.log(chalk.green('✓ Branch "' + name + '" created'));
      if (options.base) {
        console.log(chalk.gray('  Base: ' + options.base));
      }
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

program
  .command('branch:list')
  .description('List all branches')
  .action(async () => {
    try {
      if (!repository) repository = await initRepository();
      
      const branches = repository.listBranches();
      
      console.log(chalk.bold('\nBranches (' + branches.length + '):\n'));
      
      for (const branch of branches) {
        const current = branch.name === repository.getCurrentBranch() ? ' *' : '';
        const protectedBadge = branch.protected ? chalk.red(' [protected]') : '';
        console.log(chalk.cyan(branch.name + current + protectedBadge));
        console.log(chalk.gray('  Type: ' + branch.type + ' | Head: ' + (branch.headCommit ? branch.headCommit.substring(0, 8) : 'none')));
        console.log();
      }
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

program
  .command('checkout')
  .description('Checkout a branch')
  .argument('<branch>', 'Branch name')
  .action(async (branch: string) => {
    try {
      if (!repository) repository = await initRepository();
      
      repository.checkout(branch);
      
      console.log(chalk.green('✓ Switched to branch "' + branch + '"'));
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

// ============================================================================
// Audit Commands
// ============================================================================

program
  .command('audit:list')
  .description('List audit logs')
  .option('-l, --limit <number>', 'Limit number of entries', '20')
  .action(async (options: any) => {
    try {
      if (!repository) repository = await initRepository();
      
      const logs = repository.getAuditLogs({ limit: parseInt(options.limit) });
      
      console.log(chalk.bold('\nAudit Logs (' + logs.length + '):\n'));
      
      for (const log of logs) {
        console.log(chalk.cyan(log.action));
        console.log(chalk.gray('  Actor: ' + log.actor + ' | Target: ' + log.target));
        console.log(chalk.gray('  Time: ' + log.timestamp.toISOString()));
        console.log(chalk.gray('  Hash: ' + log.hash.substring(0, 16) + '...'));
        console.log();
      }
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

program
  .command('audit:verify')
  .description('Verify audit log integrity')
  .action(async () => {
    try {
      if (!repository) repository = await initRepository();
      
      const result = repository.verifyAuditIntegrity();
      
      if (result.valid) {
        console.log(chalk.green('✓ Audit log integrity verified'));
      } else {
        console.log(chalk.red('✗ Audit log integrity broken at entry ' + result.brokenAt));
      }
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

program
  .command('audit:export')
  .description('Export audit logs for compliance')
  .option('-f, --format <format>', 'Format (json|csv)', 'json')
  .action(async (options: any) => {
    try {
      if (!repository) repository = await initRepository();
      
      const data = repository.exportAuditLogs(options.format as 'json' | 'csv');
      console.log(data);
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

// ============================================================================
// Rollback Commands
// ============================================================================

program
  .command('rollback:list')
  .description('List rollback history')
  .action(async () => {
    try {
      if (!repository) repository = await initRepository();
      
      const rollbacks = repository.getRollbackHistory();
      
      if (rollbacks.length === 0) {
        console.log(chalk.yellow('No rollbacks found'));
        return;
      }
      
      console.log(chalk.bold('\nRollbacks (' + rollbacks.length + '):\n'));
      
      for (const rb of rollbacks) {
        const statusColor = rb.status === 'completed' ? chalk.green : 
                          rb.status === 'failed' ? chalk.red : chalk.yellow;
        console.log(statusColor('#' + rb.id.substring(0, 8)));
        console.log(chalk.gray('  Target: ' + rb.targetVersion + ' | Trigger: ' + rb.trigger));
        console.log(chalk.gray('  Status: ' + rb.status + ' | Reason: ' + rb.reason));
        console.log(chalk.gray('  Time: ' + rb.timestamp.toISOString()));
        console.log();
      }
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

// ============================================================================
// FDA Compliance Commands
// ============================================================================

program
  .command('compliance:summary')
  .description('Show compliance summary')
  .action(async () => {
    try {
      if (!repository) repository = await initRepository();
      
      const summary = repository.getComplianceSummary();
      
      console.log(chalk.bold('\nFDA Compliance Summary\n'));
      console.log(chalk.gray('  Risk Assessments: ' + summary.totalRiskAssessments));
      console.log(chalk.gray('  Critical Risks: ' + summary.criticalRisks));
      console.log(chalk.gray('  Open PRs: ' + summary.openPullRequests));
      console.log(chalk.gray('  Requirements Coverage: ' + summary.requirementsCoverage));
      console.log(chalk.gray('  Design Gates: ' + summary.gatesApproved + '/' + summary.totalGates));
      console.log();
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

program
  .command('compliance:gates')
  .description('Show design control gates')
  .action(async () => {
    try {
      if (!repository) repository = await initRepository();
      
      const gates = repository.getDesignControlGates();
      
      console.log(chalk.bold('\nDesign Control Gates\n'));
      
      for (const gate of gates) {
        const statusColor = gate.status === 'approved' ? chalk.green : 
                          gate.status === 'rejected' ? chalk.red : chalk.yellow;
        console.log(statusColor(gate.name));
        console.log(chalk.gray('  Status: ' + gate.status));
        console.log(chalk.gray('  ' + gate.description));
        if (gate.approvedBy) {
          console.log(chalk.gray('  Approved by: ' + gate.approvedBy));
        }
        console.log();
      }
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

// ============================================================================
// PR Commands
// ============================================================================

program
  .command('pr:create')
  .description('Create a pull request')
  .action(async () => {
    try {
      if (!repository) repository = await initRepository();
      
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'title',
          message: 'PR title:',
          validate: (input: string) => input.length > 0 || 'Title is required',
        },
        {
          type: 'input',
          name: 'description',
          message: 'Description:',
        },
        {
          type: 'input',
          name: 'sourceBranch',
          message: 'Source branch:',
        },
        {
          type: 'input',
          name: 'targetBranch',
          message: 'Target branch:',
          default: 'main',
        },
      ]);
      
      const pr = await repository.createPullRequest({
        title: answers.title,
        description: answers.description,
        sourceBranch: answers.sourceBranch,
        targetBranch: answers.targetBranch,
        author: 'cli-user',
      });
      
      console.log(chalk.green('✓ Pull request created: #' + pr.id.substring(0, 8)));
      console.log(chalk.gray('  Title: ' + pr.title));
      console.log(chalk.gray('  ' + pr.sourceBranch + ' → ' + pr.targetBranch));
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

program
  .command('pr:list')
  .description('List pull requests')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (_options: any) => {
    try {
      if (!repository) repository = await initRepository();
      
      console.log(chalk.yellow('Pull request listing not implemented yet'));
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

// ============================================================================
// Status Command
// ============================================================================

program
  .command('status')
  .description('Show repository status')
  .action(async () => {
    try {
      if (!repository) repository = await initRepository();
      
      const branches = repository.listBranches();
      const currentBranch = repository.getCurrentBranch();
      const artifacts = repository.getArtifacts();
      const auditLogs = repository.getAuditLogs({ limit: 1 });
      
      console.log(chalk.bold('\nRepository Status\n'));
      console.log(chalk.gray('  Current branch: ' + chalk.cyan(currentBranch)));
      console.log(chalk.gray('  Branches: ' + branches.length));
      console.log(chalk.gray('  Artifacts: ' + artifacts.length));
      console.log(chalk.gray('  Latest audit: ' + (auditLogs[0]?.timestamp?.toISOString() || 'none')));
      console.log();
    } catch (error) {
      console.error(chalk.red('Error: ' + error));
    }
  });

// ============================================================================
// Parse and execute
// ============================================================================

program.parse();
