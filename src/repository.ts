/**
 * Agent Pipeline Versioning - Repository
 * 
 * Main repository class that ties together all versioning components:
 * - Artifacts (workflows, prompts, models, tools, data)
 * - Commits with cryptographic signatures
 * - Branching model
 * - Audit logging
 * - Rollback capabilities
 * - FDA compliance
 */

import { v4 as uuidv4 } from 'uuid';
import {
  VersionedArtifact,
  Commit,
  ArtifactType,
  VersionType,
  EnvironmentSnapshot,
  RepositoryConfig,
  RepositoryConfigSchema,
  VersionedArtifactSchema,
  CommitSchema,
  EnvironmentSnapshotSchema,
  parseVersion,
  bumpVersion,
  detectVersionType,
} from './types';
import { sha256, signCommit, generateSignature } from './crypto';
import { BranchManager } from './branching';
import { AuditLogService, AUDIT_ACTIONS } from './audit';
import { RollbackService, DEFAULT_ROLLBACK_CONFIG } from './rollback';
import { FDAComplianceService } from './fda-compliance';

/**
 * Repository - Main entry point for the versioning system
 */
export class Repository {
  private config: RepositoryConfig;
  private artifacts: Map<string, VersionedArtifact> = new Map();
  private commits: Map<string, Commit> = new Map();
  private environments: Map<string, EnvironmentSnapshot> = new Map();
  private signingKey: string;
  
  // Services
  private branchManager: BranchManager;
  private auditLog: AuditLogService;
  private rollbackService: RollbackService;
  private fdaCompliance: FDAComplianceService;
  
  constructor(
    config: RepositoryConfig,
    signingKey: string = 'default-signing-key'
  ) {
    this.config = config;
    this.signingKey = signingKey;
    
    // Initialize services
    this.auditLog = new AuditLogService(config);
    this.branchManager = new BranchManager(config, this.auditLog);
    this.rollbackService = new RollbackService(DEFAULT_ROLLBACK_CONFIG, this.auditLog);
    this.fdaCompliance = new FDAComplianceService(this.auditLog);
  }
  
  // ==========================================================================
  // Artifact Management
  // ==========================================================================
  
  /**
   * Create a new artifact
   */
  async createArtifact(params: {
    type: ArtifactType;
    name: string;
    content: any;
    description?: string;
    createdBy: string;
    metadata?: Record<string, any>;
    tags?: string[];
  }): Promise<VersionedArtifact> {
    const artifact: VersionedArtifact = {
      id: uuidv4(),
      type: params.type,
      name: params.name,
      version: '0.0.0',
      description: params.description,
      content: params.content,
      metadata: params.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: params.createdBy,
      tags: params.tags || [],
    };
    
    // Validate
    const validated = VersionedArtifactSchema.safeParse(artifact);
    if (!validated.success) {
      throw new Error(`Invalid artifact: ${validated.error.message}`);
    }
    
    this.artifacts.set(artifact.id, artifact);
    
    // Audit log
    await this.auditLog.log({
      action: AUDIT_ACTIONS.ARTIFACT_CREATED,
      actor: params.createdBy,
      target: artifact.id,
      targetType: 'artifact',
      details: { type: params.type, name: params.name },
    });
    
    return artifact;
  }
  
  /**
   * Update an artifact
   */
  async updateArtifact(
    artifactId: string,
    updates: Partial<VersionedArtifact>,
    updatedBy: string
  ): Promise<VersionedArtifact> {
    const artifact = this.artifacts.get(artifactId);
    
    if (!artifact) {
      throw new Error(`Artifact "${artifactId}" not found`);
    }
    
    // Determine version bump type
    let versionType: VersionType = 'PATCH';
    if (updates.content && artifact.content) {
      versionType = detectVersionType(artifact.content, updates.content);
    }
    
    // Bump version
    const bump = bumpVersion(artifact.version, versionType);
    
    // Create updated artifact
    const updated: VersionedArtifact = {
      ...artifact,
      ...updates,
      id: artifact.id, // Keep original ID
      version: bump.newVersion,
      updatedAt: new Date(),
    };
    
    this.artifacts.set(artifactId, updated);
    
    // Audit log
    await this.auditLog.log({
      action: AUDIT_ACTIONS.ARTIFACT_UPDATED,
      actor: updatedBy,
      target: artifactId,
      targetType: 'artifact',
      details: { oldVersion: artifact.version, newVersion: bump.newVersion },
    });
    
    return updated;
  }
  
  /**
   * Get artifact by ID
   */
  getArtifact(id: string): VersionedArtifact | undefined {
    return this.artifacts.get(id);
  }
  
  /**
   * Get artifact by name
   */
  getArtifactByName(name: string): VersionedArtifact | undefined {
    return Array.from(this.artifacts.values()).find(a => a.name === name);
  }
  
  /**
   * Get all artifacts
   */
  getArtifacts(options?: {
    type?: ArtifactType;
    tags?: string[];
  }): VersionedArtifact[] {
    let filtered = Array.from(this.artifacts.values());
    
    if (options?.type) {
      filtered = filtered.filter(a => a.type === options.type);
    }
    
    if (options?.tags) {
      filtered = filtered.filter(a => 
        options.tags!.some(tag => a.tags.includes(tag))
      );
    }
    
    return filtered;
  }
  
  /**
   * Delete artifact
   */
  async deleteArtifact(id: string, deletedBy: string): Promise<void> {
    const artifact = this.artifacts.get(id);
    
    if (!artifact) {
      throw new Error(`Artifact "${id}" not found`);
    }
    
    this.artifacts.delete(id);
    
    await this.auditLog.log({
      action: AUDIT_ACTIONS.ARTIFACT_DELETED,
      actor: deletedBy,
      target: id,
      targetType: 'artifact',
      details: { name: artifact.name },
    });
  }
  
  // ==========================================================================
  // Commit Management
  // ==========================================================================
  
  /**
   * Create a commit
   */
  async commit(
    artifactId: string,
    message: string,
    author: string,
    changes?: any[]
  ): Promise<Commit> {
    const artifact = this.artifacts.get(artifactId);
    
    if (!artifact) {
      throw new Error(`Artifact "${artifactId}" not found`);
    }
    
    const branch = this.branchManager.getBranch(
      this.branchManager.getCurrentBranch()
    );
    
    const commit: Commit = {
      id: uuidv4(),
      artifactId,
      version: artifact.version,
      message,
      author,
      signature: '', // Will be set below
      parentCommits: branch?.headCommit ? [branch.headCommit] : [],
      timestamp: new Date(),
      changes: changes || [],
      environment: {
        nodeVersion: process.version,
        dependencies: {}, // Would capture actual dependencies
        platform: process.platform,
      },
    };
    
    // Sign commit
    commit.signature = signCommit({
      artifactId: commit.artifactId,
      version: commit.version,
      message: commit.message,
      author: commit.author,
      parentCommits: commit.parentCommits,
      timestamp: commit.timestamp.toISOString(),
      content: artifact.content,
    }, this.signingKey);
    
    // Validate
    const validated = CommitSchema.safeParse(commit);
    if (!validated.success) {
      throw new Error(`Invalid commit: ${validated.error.message}`);
    }
    
    this.commits.set(commit.id, commit);
    
    // Update branch head
    await this.branchManager.updateHeadCommit(
      this.branchManager.getCurrentBranch(),
      commit.id,
      author
    );
    
    // Audit log
    await this.auditLog.log({
      action: AUDIT_ACTIONS.COMMIT_CREATED,
      actor: author,
      target: commit.id,
      targetType: 'commit',
      details: { artifactId, version: commit.version, message },
    });
    
    return commit;
  }
  
  /**
   * Get commit by ID
   */
  getCommit(id: string): Commit | undefined {
    return this.commits.get(id);
  }
  
  /**
   * Get commit history for artifact
   */
  getCommitHistory(artifactId: string): Commit[] {
    return Array.from(this.commits.values())
      .filter(c => c.artifactId === artifactId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  
  // ==========================================================================
  // Branch Management
  // ==========================================================================
  
  /**
   * Create a new branch
   */
  async createBranch(
    name: string,
    createdBy: string,
    baseBranch?: string
  ): Promise<void> {
    await this.branchManager.createBranch(name, createdBy, baseBranch);
  }
  
  /**
   * Checkout a branch
   */
  checkout(branchName: string): void {
    this.branchManager.setCurrentBranch(branchName);
  }
  
  /**
   * Get current branch
   */
  getCurrentBranch(): string {
    return this.branchManager.getCurrentBranch();
  }
  
  /**
   * List branches
   */
  listBranches() {
    return this.branchManager.getAllBranches();
  }
  
  // ==========================================================================
  // Environment Snapshots
  // ==========================================================================
  
  /**
   * Pin environment for reproducibility
   */
  async pinEnvironment(
    workflowVersion: string,
    pinnedBy: string,
    conversationId?: string
  ): Promise<EnvironmentSnapshot> {
    const snapshot: EnvironmentSnapshot = {
      id: uuidv4(),
      workflowVersion,
      dependencies: {}, // Would capture actual dependencies
      environmentVariables: {},
      platform: process.platform,
      nodeVersion: process.version,
      createdAt: new Date(),
      createdBy: pinnedBy,
      pinned: true,
      conversationId,
    };
    
    const validated = EnvironmentSnapshotSchema.safeParse(snapshot);
    if (!validated.success) {
      throw new Error(`Invalid snapshot: ${validated.error.message}`);
    }
    
    this.environments.set(snapshot.id, snapshot);
    
    await this.auditLog.log({
      action: AUDIT_ACTIONS.ENVIRONMENT_PINNED,
      actor: pinnedBy,
      target: snapshot.id,
      targetType: 'environment',
      details: { workflowVersion, conversationId },
    });
    
    return snapshot;
  }
  
  /**
   * Get pinned environments
   */
  getPinnedEnvironments(): EnvironmentSnapshot[] {
    return Array.from(this.environments.values())
      .filter(e => e.pinned);
  }
  
  // ==========================================================================
  // Rollback
  // ==========================================================================
  
  /**
   * Trigger rollback
   */
  async rollback(
    targetVersion: string,
    reason: string,
    initiatedBy: string
  ): Promise<void> {
    await this.rollbackService.emergencyRollback(initiatedBy, targetVersion, reason);
  }
  
  /**
   * Get rollback history
   */
  getRollbackHistory() {
    return this.rollbackService.getRollbacks();
  }
  
  // ==========================================================================
  // FDA Compliance
  // ==========================================================================
  
  /**
   * Create risk assessment
   */
  async createRiskAssessment(params: {
    artifactId: string;
    version: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    probability: 'likely' | 'possible' | 'unlikely';
    impact: string;
    mitigation: string;
    residualRisk: string;
    assessedBy: string;
  }) {
    return this.fdaCompliance.createRiskAssessment(params);
  }
  
  /**
   * Create pull request
   */
  async createPullRequest(params: {
    title: string;
    description: string;
    sourceBranch: string;
    targetBranch: string;
    author: string;
  }) {
    return this.fdaCompliance.createPullRequest(params);
  }
  
  /**
   * Approve pull request
   */
  async approvePullRequest(prId: string, reviewer: string) {
    const signature = generateSignature({ prId }, this.signingKey);
    return this.fdaCompliance.approvePullRequest(prId, reviewer, signature);
  }
  
  /**
   * Merge pull request
   */
  async mergePullRequest(prId: string, mergedBy: string) {
    return this.fdaCompliance.mergePullRequest(prId, mergedBy);
  }
  
  /**
   * Get compliance summary
   */
  getComplianceSummary() {
    return this.fdaCompliance.getComplianceSummary();
  }
  
  /**
   * Get design control gates
   */
  getDesignControlGates() {
    return this.fdaCompliance.getDesignControlGates();
  }
  
  /**
   * Approve design control gate
   */
  async approveGate(gateId: string, approvedBy: string, notes?: string) {
    return this.fdaCompliance.approveGate(gateId, approvedBy, notes);
  }
  
  // ==========================================================================
  // Audit
  // ==========================================================================
  
  /**
   * Get audit logs
   */
  getAuditLogs(options?: any) {
    return this.auditLog.getLogs(options);
  }
  
  /**
   * Verify audit integrity
   */
  verifyAuditIntegrity() {
    return this.auditLog.verifyIntegrity();
  }
  
  /**
   * Export audit logs
   */
  exportAuditLogs(format: 'json' | 'csv' = 'json') {
    return this.auditLog.exportForCompliance(format);
  }
  
  // ==========================================================================
  // Serialization
  // ==========================================================================
  
  /**
   * Serialize repository state
   */
  serialize(): string {
    return JSON.stringify({
      config: this.config,
      artifacts: Array.from(this.artifacts.entries()),
      commits: Array.from(this.commits.entries()),
      environments: Array.from(this.environments.entries()),
      branches: this.branchManager.serialize(),
      auditLogs: this.auditLog.serialize(),
      rollbacks: this.rollbackService.serialize(),
      fdaCompliance: this.fdaCompliance.serialize(),
    }, null, 2);
  }
  
  /**
   * Create repository from serialized state
   */
  static async deserialize(
    data: string,
    signingKey: string = 'default-signing-key'
  ): Promise<Repository> {
    const parsed = JSON.parse(data);
    
    const repo = new Repository(parsed.config, signingKey);
    
    repo.artifacts = new Map(parsed.artifacts.map(([k, v]: [string, any]) => [
      k,
      { ...v, createdAt: new Date(v.createdAt), updatedAt: new Date(v.updatedAt) }
    ]));
    
    repo.commits = new Map(parsed.commits.map(([k, v]: [string, any]) => [
      k,
      { ...v, timestamp: new Date(v.timestamp) }
    ]));
    
    repo.environments = new Map(parsed.environments.map(([k, v]: [string, any]) => [
      k,
      { ...v, createdAt: new Date(v.createdAt) }
    ]));
    
    return repo;
  }
}

/**
 * Factory function to create a new repository
 */
export function createRepository(
  name: string,
  signingKey?: string
): Repository {
  const config: RepositoryConfig = {
    name,
    defaultBranch: 'main',
    retentionYears: 10,
    requireApprovals: true,
    minApprovals: 1,
    requireSignatures: true,
    autoRollback: {
      enabled: true,
      errorRateThreshold: 0.05,
      safetyViolationThreshold: 0,
      performanceThresholdMs: 5000,
    },
    branchProtection: {
      main: true,
      develop: false,
    },
  };
  
  return new Repository(config, signingKey);
}
