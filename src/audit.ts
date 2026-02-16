/**
 * Agent Pipeline Versioning - Audit Logging Service
 * 
 * Provides immutable, cryptographically verifiable audit logs
 * for FDA compliance and regulatory requirements.
 */

import { v4 as uuidv4 } from 'uuid';
import { AuditLog, AuditLogSchema, RepositoryConfig } from './types';
import { sha256, createAuditHash, createInitialHash } from './crypto';

export interface AuditLogEntry {
  action: string;
  actor: string;
  target: string;
  targetType: 'artifact' | 'commit' | 'branch' | 'rollback' | 'environment';
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditLogService {
  private logs: AuditLog[] = [];
  private config: RepositoryConfig;
  private lastHash: string;
  
  constructor(config: RepositoryConfig) {
    this.config = config;
    this.lastHash = createInitialHash();
  }
  
  async log(entry: AuditLogEntry): Promise<AuditLog> {
    const id = uuidv4();
    const timestamp = new Date();
    
    const logData = {
      id: id,
      action: entry.action,
      actor: entry.actor,
      target: entry.target,
      timestamp: timestamp.toISOString(),
      details: entry.details || {},
    };
    
    const hash = createAuditHash(logData, this.lastHash);
    
    const auditLog: AuditLog = {
      id: id,
      action: entry.action,
      actor: entry.actor,
      target: entry.target,
      targetType: entry.targetType,
      timestamp: timestamp,
      details: entry.details || {},
      hash: hash,
      previousHash: this.lastHash,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    };
    
    const validated = AuditLogSchema.safeParse(auditLog);
    if (!validated.success) {
      throw new Error('Invalid audit log: ' + validated.error.message);
    }
    
    this.logs.push(auditLog);
    this.lastHash = hash;
    
    return auditLog;
  }
  
  getLogs(options?: {
    actor?: string;
    action?: string;
    target?: string;
    targetType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): AuditLog[] {
    let filtered = [...this.logs];
    
    if (options && options.actor) {
      filtered = filtered.filter(log => log.actor === options.actor);
    }
    
    if (options && options.action) {
      filtered = filtered.filter(log => log.action === options.action);
    }
    
    if (options && options.target) {
      filtered = filtered.filter(log => log.target === options.target);
    }
    
    if (options && options.targetType) {
      filtered = filtered.filter(log => log.targetType === options.targetType);
    }
    
    if (options && options.startDate) {
      filtered = filtered.filter(log => log.timestamp >= options.startDate!);
    }
    
    if (options && options.endDate) {
      filtered = filtered.filter(log => log.timestamp <= options.endDate!);
    }
    
    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    const offset = (options && options.offset) ? options.offset : 0;
    const limit = (options && options.limit) ? options.limit : filtered.length;
    
    return filtered.slice(offset, offset + limit);
  }
  
  getLogsForArtifact(artifactId: string): AuditLog[] {
    return this.logs.filter(
      log => log.target === artifactId && log.targetType === 'artifact'
    );
  }
  
  getLogsForCommit(commitId: string): AuditLog[] {
    return this.logs.filter(
      log => log.target === commitId && log.targetType === 'commit'
    );
  }
  
  verifyIntegrity(): { valid: boolean; brokenAt?: number } {
    for (let i = 0; i < this.logs.length; i++) {
      const log = this.logs[i];
      const expectedPreviousHash = i > 0 ? this.logs[i - 1].hash : undefined;
      
      if (log.previousHash !== expectedPreviousHash) {
        return { valid: false, brokenAt: i };
      }
      
      const logData = {
        id: log.id,
        action: log.action,
        actor: log.actor,
        target: log.target,
        timestamp: log.timestamp.toISOString(),
        details: log.details,
      };
      
      const computedHash = createAuditHash(logData, log.previousHash);
      if (log.hash !== computedHash) {
        return { valid: false, brokenAt: i };
      }
    }
    
    return { valid: true };
  }
  
  exportForCompliance(format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.logs, null, 2);
    }
    
    const headers = [
      'id', 'action', 'actor', 'target', 'targetType',
      'timestamp', 'hash', 'previousHash'
    ];
    
    const rows = this.logs.map(log => [
      log.id,
      log.action,
      log.actor,
      log.target,
      log.targetType,
      log.timestamp.toISOString(),
      log.hash,
      log.previousHash || '',
    ]);
    
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
  
  getLogsWithinRetention(): AuditLog[] {
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - this.config.retentionYears);
    
    return this.logs.filter(log => log.timestamp >= cutoffDate);
  }
  
  async archiveOldLogs(): Promise<{ archived: number; retained: number }> {
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - this.config.retentionYears);
    
    const toArchive = this.logs.filter(log => log.timestamp < cutoffDate);
    const toRetain = this.logs.filter(log => log.timestamp >= cutoffDate);
    
    this.logs = toRetain;
    
    return {
      archived: toArchive.length,
      retained: toRetain.length,
    };
  }
  
  getSummary(startDate: Date, endDate: Date): {
    totalActions: number;
    actionsByType: Record<string, number>;
    actors: string[];
    artifacts: string[];
  } {
    const periodLogs = this.logs.filter(
      log => log.timestamp >= startDate && log.timestamp <= endDate
    );
    
    const actionsByType: Record<string, number> = {};
    const actors = new Set<string>();
    const artifacts = new Set<string>();
    
    for (const log of periodLogs) {
      actionsByType[log.action] = (actionsByType[log.action] || 0) + 1;
      actors.add(log.actor);
      if (log.targetType === 'artifact') {
        artifacts.add(log.target);
      }
    }
    
    return {
      totalActions: periodLogs.length,
      actionsByType: actionsByType,
      actors: Array.from(actors),
      artifacts: Array.from(artifacts),
    };
  }
  
  getLastHash(): string {
    return this.lastHash;
  }
  
  serialize(): string {
    return JSON.stringify({
      logs: this.logs,
      lastHash: this.lastHash,
    }, null, 2);
  }
  
  static deserialize(data: string, config: RepositoryConfig): AuditLogService {
    const parsed = JSON.parse(data);
    const service = new AuditLogService(config);
    
    service.logs = parsed.logs.map((log: any) => ({
      ...log,
      timestamp: new Date(log.timestamp),
    }));
    service.lastHash = parsed.lastHash;
    
    return service;
  }
  
  getLogCount(): number {
    return this.logs.length;
  }
  
  search(keyword: string): AuditLog[] {
    const lowerKeyword = keyword.toLowerCase();
    return this.logs.filter(log => 
      log.action.toLowerCase().includes(lowerKeyword) ||
      log.actor.toLowerCase().includes(lowerKeyword) ||
      log.target.toLowerCase().includes(lowerKeyword) ||
      JSON.stringify(log.details).toLowerCase().includes(lowerKeyword)
    );
  }
}

interface AuditLogData {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
  details: Record<string, any>;
}

export const AUDIT_ACTIONS = {
  ARTIFACT_CREATED: 'ARTIFACT_CREATED',
  ARTIFACT_UPDATED: 'ARTIFACT_UPDATED',
  ARTIFACT_DELETED: 'ARTIFACT_DELETED',
  ARTIFACT_TAGGED: 'ARTIFACT_TAGGED',
  COMMIT_CREATED: 'COMMIT_CREATED',
  COMMIT_SIGNED: 'COMMIT_SIGNED',
  COMMIT_APPROVED: 'COMMIT_APPROVED',
  BRANCH_CREATED: 'BRANCH_CREATED',
  BRANCH_DELETED: 'BRANCH_DELETED',
  BRANCH_MERGED: 'BRANCH_MERGED',
  BRANCH_UPDATED: 'BRANCH_UPDATED',
  ROLLBACK_INITIATED: 'ROLLBACK_INITIATED',
  ROLLBACK_COMPLETED: 'ROLLBACK_COMPLETED',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  ENVIRONMENT_PINNED: 'ENVIRONMENT_PINNED',
  ENVIRONMENT_RESTORED: 'ENVIRONMENT_RESTORED',
  COMPLIANCE_REPORT_GENERATED: 'COMPLIANCE_REPORT_GENERATED',
  AUDIT_LOG_EXPORTED: 'AUDIT_LOG_EXPORTED',
  RISK_ASSESSMENT_CREATED: 'RISK_ASSESSMENT_CREATED',
  RISK_ASSESSMENT_APPROVED: 'RISK_ASSESSMENT_APPROVED',
  PR_CREATED: 'PR_CREATED',
  PR_APPROVED: 'PR_APPROVED',
  PR_MERGED: 'PR_MERGED',
  PR_CLOSED: 'PR_CLOSED',
} as const;
