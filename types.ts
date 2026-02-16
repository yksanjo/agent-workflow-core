/**
 * Agent Pipeline Versioning - Core Types
 * 
 * Defines the fundamental data models for version control of multi-agent workflows
 * with support for FDA compliance and healthcare regulations.
 */

import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

export const ArtifactTypeSchema = z.enum(['workflow', 'prompt', 'model', 'tool', 'data']);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const BranchTypeSchema = z.enum(['main', 'develop', 'feature', 'hotfix', 'release']);
export type BranchType = z.infer<typeof BranchTypeSchema>;

export const VersionTypeSchema = z.enum(['MAJOR', 'MINOR', 'PATCH']);
export type VersionType = z.infer<typeof VersionTypeSchema>;

export const RollbackTriggerSchema = z.enum(['manual', 'automated']);
export type RollbackTrigger = z.infer<typeof RollbackTriggerSchema>;

export const RollbackStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);
export type RollbackStatus = z.infer<typeof RollbackStatusSchema>;

export const ChangeTypeSchema = z.enum(['add', 'modify', 'delete']);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const TriggerReasonSchema = z.enum([
  'error_rate_spike',
  'safety_violation',
  'performance_degradation',
  'manual_request',
  'scheduled_rollback'
]);
export type TriggerReason = z.infer<typeof TriggerReasonSchema>;

// ============================================================================
// Core Data Models
// ============================================================================

/**
 * Represents a versioned artifact in the system.
 * Artifacts are the primary units of version control.
 */
export const VersionedArtifactSchema = z.object({
  id: z.string().uuid(),
  type: ArtifactTypeSchema,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'SemVer format required'),
  description: z.string().optional(),
  content: z.any(),
  metadata: z.record(z.any()).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
  tags: z.array(z.string()).default([]),
});
export type VersionedArtifact = z.infer<typeof VersionedArtifactSchema>;

/**
 * Represents a change to an artifact between versions.
 */
export const ChangeSchema = z.object({
  id: z.string().uuid(),
  type: ChangeTypeSchema,
  path: z.string(),
  oldValue: z.any().optional(),
  newValue: z.any().optional(),
  description: z.string().optional(),
});
export type Change = z.infer<typeof ChangeSchema>;

/**
 * Represents a commit in the version history.
 * Commits are immutable snapshots of artifacts at a point in time.
 */
export const CommitSchema = z.object({
  id: z.string().uuid(),
  artifactId: z.string().uuid(),
  version: z.string(),
  message: z.string(),
  author: z.string(),
  signature: z.string(), // Cryptographic signature for verification
  parentCommits: z.array(z.string().uuid()).default([]),
  timestamp: z.date(),
  changes: z.array(ChangeSchema).default([]),
  environment: z.object({
    nodeVersion: z.string(),
    dependencies: z.record(z.string()),
    platform: z.string(),
  }).optional(),
  approval: z.object({
    approvedBy: z.string().optional(),
    approvedAt: z.date().optional(),
    signature: z.string().optional(),
  }).optional(),
});
export type Commit = z.infer<typeof CommitSchema>;

/**
 * Represents a branch in the versioning system.
 */
export const BranchSchema = z.object({
  name: z.string(),
  type: BranchTypeSchema,
  headCommit: z.string().uuid().nullable(),
  baseBranch: z.string().optional(),
  createdAt: z.date(),
  createdBy: z.string(),
  protected: z.boolean().default(false),
  description: z.string().optional(),
});
export type Branch = z.infer<typeof BranchSchema>;

/**
 * Immutable audit log entry for compliance.
 */
export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  actor: z.string(),
  target: z.string(),
  targetType: z.enum(['artifact', 'commit', 'branch', 'rollback', 'environment']),
  timestamp: z.date(),
  details: z.record(z.any()).default({}),
  hash: z.string(), // SHA-256 for integrity verification
  previousHash: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

/**
 * Represents a rollback operation.
 */
export const RollbackSchema = z.object({
  id: z.string().uuid(),
  targetVersion: z.string(),
  targetCommitId: z.string().uuid().optional(),
  trigger: RollbackTriggerSchema,
  reason: TriggerReasonSchema,
  initiatedBy: z.string(),
  timestamp: z.date(),
  status: RollbackStatusSchema,
  completedAt: z.date().optional(),
  error: z.string().optional(),
  affectedArtifacts: z.array(z.string().uuid()).default([]),
  autoRollbackConfig: z.object({
    errorRateThreshold: z.number().default(0.05),
    safetyViolationThreshold: z.number().default(0),
    performanceThresholdMs: z.number().default(5000),
    detectionWindowSeconds: z.number().default(60),
    cooldownSeconds: z.number().default(300),
  }).optional(),
});
export type Rollback = z.infer<typeof RollbackSchema>;

/**
 * Risk assessment for FDA compliance.
 */
export const RiskAssessmentSchema = z.object({
  id: z.string().uuid(),
  artifactId: z.string().uuid(),
  version: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  probability: z.enum(['likely', 'possible', 'unlikely']),
  impact: z.string(),
  mitigation: z.string(),
  residualRisk: z.string(),
  assessedBy: z.string(),
  assessedAt: z.date(),
  approvedBy: z.string().optional(),
  linkedCommits: z.array(z.string().uuid()).default([]),
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

/**
 * Pull request for code review and approval.
 */
export const PullRequestSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  status: z.enum(['open', 'merged', 'closed', 'draft']),
  author: z.string(),
  reviewers: z.array(z.string()).default([]),
  approvals: z.array(z.object({
    reviewer: z.string(),
    approvedAt: z.date(),
    signature: z.string(),
  })).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
  mergedAt: z.date().optional(),
  linkedIssues: z.array(z.string()).default([]),
  linkedRiskAssessments: z.array(z.string().uuid()).default([]),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

/**
 * Test report for validation traceability.
 */
export const TestReportSchema = z.object({
  id: z.string().uuid(),
  artifactId: z.string().uuid(),
  version: z.string(),
  testType: z.enum(['unit', 'integration', 'e2e', 'performance', 'security', 'compliance']),
  status: z.enum(['passed', 'failed', 'skipped', 'pending']),
  coverage: z.number().min(0).max(100),
  passedCount: z.number(),
  failedCount: z.number(),
  skippedCount: z.number(),
  duration: z.number(), // milliseconds
  requirements: z.array(z.object({
    id: z.string(),
    description: z.string(),
    covered: z.boolean(),
    testId: z.string().optional(),
  })).default([]),
  executedBy: z.string(),
  executedAt: z.date(),
  environment: z.string(),
});
export type TestReport = z.infer<typeof TestReportSchema>;

/**
 * Environment snapshot for reproducibility.
 */
export const EnvironmentSnapshotSchema = z.object({
  id: z.string().uuid(),
  workflowVersion: z.string(),
  dependencies: z.record(z.string()),
  environmentVariables: z.record(z.string()).default({}),
  platform: z.string(),
  nodeVersion: z.string(),
  createdAt: z.date(),
  createdBy: z.string(),
  pinned: z.boolean().default(false),
  conversationId: z.string().uuid().optional(),
});
export type EnvironmentSnapshot = z.infer<typeof EnvironmentSnapshotSchema>;

// ============================================================================
// Repository Configuration
// ============================================================================

export const RepositoryConfigSchema = z.object({
  name: z.string(),
  defaultBranch: z.string().default('main'),
  retentionYears: z.number().min(1).max(30).default(10),
  requireApprovals: z.boolean().default(true),
  minApprovals: z.number().min(1).default(1),
  requireSignatures: z.boolean().default(true),
  autoRollback: z.object({
    enabled: z.boolean().default(true),
    errorRateThreshold: z.number().default(0.05),
    safetyViolationThreshold: z.number().default(0),
    performanceThresholdMs: z.number().default(5000),
  }).default({}),
  branchProtection: z.record(z.boolean()).default({}),
});
export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>;

// ============================================================================
// Version bump types for semantic versioning
// ============================================================================

export interface VersionBump {
  type: VersionType;
  oldVersion: string;
  newVersion: string;
  changes: Change[];
}

// ============================================================================
// Helper functions
// ============================================================================

export function createArtifactId(): string {
  return crypto.randomUUID();
}

export function createCommitId(): string {
  return crypto.randomUUID();
}

export function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = version.split('.').map(Number);
  return { major, minor, patch };
}

export function formatVersion(major: number, minor: number, patch: number): string {
  return `${major}.${minor}.${patch}`;
}

export function bumpVersion(currentVersion: string, type: VersionType): VersionBump {
  const { major, minor, patch } = parseVersion(currentVersion);
  let newVersion: string;

  switch (type) {
    case 'MAJOR':
      newVersion = formatVersion(major + 1, 0, 0);
      break;
    case 'MINOR':
      newVersion = formatVersion(major, minor + 1, 0);
      break;
    case 'PATCH':
      newVersion = formatVersion(major, minor, patch + 1);
      break;
  }

  return {
    type,
    oldVersion: currentVersion,
    newVersion,
    changes: [],
  };
}

export function detectVersionType(oldContent: any, newContent: any): VersionType {
  // This is a simplified heuristic - in production, you'd have more sophisticated detection
  // MAJOR: Complete structural changes, removed features, API breaking changes
  // MINOR: New features, backward compatible additions
  // PATCH: Bug fixes, performance improvements

  // For now, default to PATCH for small changes, MINOR for new features
  // In a real implementation, this would analyze the actual diff
  return 'PATCH';
}
