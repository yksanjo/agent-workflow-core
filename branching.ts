/**
 * Agent Pipeline Versioning - Branching Model
 * 
 * Implements the branching model for multi-agent workflow versioning:
 * - main: Production-stable
 * - develop: Integration branch
 * - feature/*: Isolated experiments
 * - hotfix/*: Critical fixes
 */

import { v4 as uuidv4 } from 'uuid';
import { Branch, BranchType, BranchSchema, RepositoryConfig } from './types';
import { sha256 } from './crypto';
import { AuditLogService } from './audit';

/**
 * Branch naming patterns
 */
export const BRANCH_PATTERNS = {
  MAIN: 'main',
  DEVELOP: 'develop',
  FEATURE: /^feature\/.+$/,
  HOTFIX: /^hotfix\/.+$/,
  RELEASE: /^release\/.+$/,
} as const;

/**
 * Determine branch type from branch name
 */
export function getBranchType(branchName: string): BranchType {
  if (branchName === BRANCH_PATTERNS.MAIN) return 'main';
  if (branchName === BRANCH_PATTERNS.DEVELOP) return 'develop';
  if (BRANCH_PATTERNS.FEATURE.test(branchName)) return 'feature';
  if (BRANCH_PATTERNS.HOTFIX.test(branchName)) return 'hotfix';
  if (BRANCH_PATTERNS.RELEASE.test(branchName)) return 'release';
  
  // Default to feature for unknown patterns
  return 'feature';
}

/**
 * Validate branch name
 */
export function validateBranchName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Branch name cannot be empty' };
  }
  
  if (name.includes('..')) {
    return { valid: false, error: 'Branch name cannot contain consecutive dots' };
  }
  
  if (name.startsWith('/') || name.endsWith('/')) {
    return { valid: false, error: 'Branch name cannot start or end with /' };
  }
  
  if (name.includes('//')) {
    return { valid: false, error: 'Branch name cannot contain consecutive slashes' };
  }
  
  // Check for invalid characters
  const invalidChars = [' ', '~', '^', ':', '?', '*', '[', '\\'];
  for (const char of invalidChars) {
    if (name.includes(char)) {
      return { valid: false, error: `Branch name cannot contain "${char}"` };
    }
  }
  
  // Check branch-specific rules
  const type = getBranchType(name);
  
  if (type === 'main' && name !== 'main') {
    return { valid: false, error: 'Main branch must be named "main"' };
  }
  
  if (type === 'develop' && name !== 'develop') {
    return { valid: false, error: 'Develop branch must be named "develop"' };
  }
  
  return { valid: true };
}

/**
 * Branch Manager - Handles all branch operations
 */
export class BranchManager {
  private branches: Map<string, Branch> = new Map();
  private config: RepositoryConfig;
  private auditLog: AuditLogService;
  
  constructor(config: RepositoryConfig, auditLog: AuditLogService) {
    this.config = config;
    this.auditLog = auditLog;
    this.initializeDefaultBranches();
  }
  
  /**
   * Initialize default branches (main and develop)
   */
  private initializeDefaultBranches(): void {
    // Create main branch
    const mainBranch: Branch = {
      name: 'main',
      type: 'main',
      headCommit: null,
      createdAt: new Date(),
      createdBy: 'system',
      protected: true,
      description: 'Production-stable branch',
    };
    this.branches.set('main', mainBranch);
    
    // Create develop branch
    const developBranch: Branch = {
      name: 'develop',
      type: 'develop',
      headCommit: null,
      createdAt: new Date(),
      createdBy: 'system',
      protected: false,
      description: 'Integration branch for development',
    };
    this.branches.set('develop', developBranch);
  }
  
  /**
   * Create a new branch
   */
  async createBranch(
    name: string,
    createdBy: string,
    baseBranch?: string,
    description?: string
  ): Promise<Branch> {
    // Validate branch name
    const validation = validateBranchName(name);
    if (!validation.valid) {
      throw new Error(`Invalid branch name: ${validation.error}`);
    }
    
    // Check if branch already exists
    if (this.branches.has(name)) {
      throw new Error(`Branch "${name}" already exists`);
    }
    
    // Determine branch type
    const type = getBranchType(name);
    
    // Get base branch head commit
    const base = baseBranch || this.getDefaultBaseBranch(type);
    const baseBranchObj = this.branches.get(base);
    const headCommit = baseBranchObj?.headCommit || null;
    
    // Determine if protected
    const protectedBranches = ['main', 'develop', ...Object.keys(this.config.branchProtection)];
    const isProtected = protectedBranches.includes(name);
    
    const branch: Branch = {
      name,
      type,
      headCommit,
      baseBranch: base,
      createdAt: new Date(),
      createdBy,
      protected: isProtected,
      description,
    };
    
    // Validate and store branch
    const validated = BranchSchema.safeParse(branch);
    if (!validated.success) {
      throw new Error(`Invalid branch data: ${validated.error.message}`);
    }
    
    this.branches.set(name, branch);
    
    // Audit log
    await this.auditLog.log({
      action: 'BRANCH_CREATED',
      actor: createdBy,
      target: name,
      targetType: 'branch',
      details: { baseBranch: base, type, description },
    });
    
    return branch;
  }
  
  /**
   * Delete a branch
   */
  async deleteBranch(name: string, deletedBy: string): Promise<void> {
    const branch = this.branches.get(name);
    
    if (!branch) {
      throw new Error(`Branch "${name}" does not exist`);
    }
    
    if (branch.protected) {
      throw new Error(`Cannot delete protected branch "${name}"`);
    }
    
    this.branches.delete(name);
    
    // Audit log
    await this.auditLog.log({
      action: 'BRANCH_DELETED',
      actor: deletedBy,
      target: name,
      targetType: 'branch',
      details: {},
    });
  }
  
  /**
   * Get branch by name
   */
  getBranch(name: string): Branch | undefined {
    return this.branches.get(name);
  }
  
  /**
   * Get all branches
   */
  getAllBranches(): Branch[] {
    return Array.from(this.branches.values());
  }
  
  /**
   * Get branches by type
   */
  getBranchesByType(type: BranchType): Branch[] {
    return this.getAllBranches().filter(b => b.type === type);
  }
  
  /**
   * Update branch head commit
   */
  async updateHeadCommit(
    branchName: string,
    commitId: string,
    updatedBy: string
  ): Promise<void> {
    const branch = this.branches.get(branchName);
    
    if (!branch) {
      throw new Error(`Branch "${branchName}" does not exist`);
    }
    
    if (branch.protected && !this.canPushToProtected(branchName, updatedBy)) {
      throw new Error(`Cannot push to protected branch "${branchName}" without approval`);
    }
    
    branch.headCommit = commitId;
    
    // Audit log
    await this.auditLog.log({
      action: 'BRANCH_UPDATED',
      actor: updatedBy,
      target: branchName,
      targetType: 'branch',
      details: { newHeadCommit: commitId },
    });
  }
  
  /**
   * Get default base branch for a given type
   */
  private getDefaultBaseBranch(type: BranchType): string {
    switch (type) {
      case 'feature':
        return 'develop';
      case 'hotfix':
        return 'main';
      case 'main':
        return 'main';
      case 'develop':
        return 'main';
      default:
        return 'develop';
    }
  }
  
  /**
   * Check if user can push to protected branch
   */
  private canPushToProtected(branchName: string, user: string): boolean {
    // In production, this would check user permissions
    // For now, always allow (implement proper RBAC in production)
    return true;
  }
  
  /**
   * Get current branch (for working directory)
   */
  private currentBranch: string = 'main';
  
  getCurrentBranch(): string {
    return this.currentBranch;
  }
  
  setCurrentBranch(name: string): void {
    if (!this.branches.has(name)) {
      throw new Error(`Branch "${name}" does not exist`);
    }
    this.currentBranch = name;
  }
  
  /**
   * List branches with filtering
   */
  listBranches(options?: {
    type?: BranchType;
    protected?: boolean;
    pattern?: RegExp;
  }): Branch[] {
    let branches = this.getAllBranches();
    
    if (options?.type) {
      branches = branches.filter(b => b.type === options.type);
    }
    
    if (options?.protected !== undefined) {
      branches = branches.filter(b => b.protected === options.protected);
    }
    
    if (options?.pattern) {
      branches = branches.filter(b => options.pattern!.test(b.name));
    }
    
    return branches;
  }
  
  /**
   * Get branch difference (commits ahead/behind)
   */
  getBranchDifference(sourceBranch: string, targetBranch: string): {
    ahead: number;
    behind: number;
  } {
    const source = this.branches.get(sourceBranch);
    const target = this.branches.get(targetBranch);
    
    if (!source || !target) {
      throw new Error('One or both branches not found');
    }
    
    // Simplified - in production, this would track actual commit history
    const sourceHead = source.headCommit ? 1 : 0;
    const targetHead = target.headCommit ? 1 : 0;
    
    return {
      ahead: Math.max(0, sourceHead - targetHead),
      behind: Math.max(0, targetHead - sourceHead),
    };
  }
  
  /**
   * Serialize branches for storage
   */
  serialize(): string {
    const data = {
      branches: Array.from(this.branches.entries()),
      currentBranch: this.currentBranch,
    };
    return JSON.stringify(data, null, 2);
  }
  
  /**
   * Deserialize branches from storage
   */
  static deserialize(data: string, config: RepositoryConfig, auditLog: AuditLogService): BranchManager {
    const parsed = JSON.parse(data);
    const manager = new BranchManager(config, auditLog);
    
    manager.branches = new Map(parsed.branches);
    manager.currentBranch = parsed.currentBranch || 'main';
    
    return manager;
  }
}

/**
 * Branch protection rules
 */
export interface BranchProtectionRule {
  branchPattern: string;
  requirePullRequest: boolean;
  requireApprovals: number;
  requireSignatures: boolean;
  allowForcePush: boolean;
  allowDeletion: boolean;
  requiredStatusChecks: string[];
}

/**
 * Default branch protection rules
 */
export const DEFAULT_BRANCH_PROTECTION: Record<string, BranchProtectionRule> = {
  main: {
    branchPattern: 'main',
    requirePullRequest: true,
    requireApprovals: 1,
    requireSignatures: true,
    allowForcePush: false,
    allowDeletion: false,
    requiredStatusChecks: ['tests', 'security-scan'],
  },
  develop: {
    branchPattern: 'develop',
    requirePullRequest: true,
    requireApprovals: 1,
    requireSignatures: false,
    allowForcePush: false,
    allowDeletion: false,
    requiredStatusChecks: ['tests'],
  },
};

/**
 * Check if branch operation is allowed based on protection rules
 */
export function checkBranchProtection(
  branchName: string,
  operation: 'push' | 'delete' | 'merge',
  userPermissions: string[],
  rules: Record<string, BranchProtectionRule> = DEFAULT_BRANCH_PROTECTION
): { allowed: boolean; reason?: string } {
  // Find matching rule
  const rule = Object.values(rules).find(r => 
    r.branchPattern === branchName || new RegExp(r.branchPattern).test(branchName)
  );
  
  if (!rule) {
    // No rule means no protection
    return { allowed: true };
  }
  
  switch (operation) {
    case 'push':
      if (!rule.allowForcePush) {
        return { allowed: false, reason: 'Force push is not allowed' };
      }
      break;
      
    case 'delete':
      if (!rule.allowDeletion) {
        return { allowed: false, reason: 'Branch deletion is not allowed' };
      }
      break;
      
    case 'merge':
      if (rule.requirePullRequest && !userPermissions.includes('merge')) {
        return { allowed: false, reason: 'Pull request required for merge' };
      }
      
      if (rule.requireApprovals > 0 && userPermissions.length < rule.requireApprovals) {
        return { allowed: false, reason: `Requires ${rule.requireApprovals} approval(s)` };
      }
      break;
  }
  
  return { allowed: true };
}
