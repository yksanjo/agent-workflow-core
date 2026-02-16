/**
 * Agent Pipeline Versioning - Rollback System
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  Rollback, 
  RollbackStatus, 
  RollbackTrigger, 
  TriggerReason,
  RollbackSchema 
} from './types';
import { sha256 } from './crypto';
import { AuditLogService, AUDIT_ACTIONS } from './audit';

export interface RollbackMetrics {
  errorRate: number;
  safetyViolations: number;
  averageResponseTimeMs: number;
  totalRequests: number;
  failedRequests: number;
}

export interface RollbackConfig {
  errorRateThreshold: number;
  safetyViolationThreshold: number;
  performanceThresholdMs: number;
  detectionWindowSeconds: number;
  cooldownSeconds: number;
  maxRollbacksPerHour: number;
}

export class RollbackService {
  private rollbacks: Map<string, Rollback> = new Map();
  private config: RollbackConfig;
  private auditLog: AuditLogService;
  private lastRollbackTime: number = 0;
  private rollbackCountLastHour: number = 0;
  private checkInterval: NodeJS.Timeout | null = null;
  private onRollbackTriggered?: (rollback: Rollback) => void;
  
  constructor(
    config: RollbackConfig, 
    auditLog: AuditLogService,
    onRollbackTriggered?: (rollback: Rollback) => void
  ) {
    this.config = config;
    this.auditLog = auditLog;
    this.onRollbackTriggered = onRollbackTriggered;
  }
  
  async checkAndTriggerRollback(metrics: RollbackMetrics): Promise<Rollback | null> {
    const now = Date.now();
    const timeSinceLastRollback = (now - this.lastRollbackTime) / 1000;
    
    if (timeSinceLastRollback < this.config.cooldownSeconds) {
      return null;
    }
    
    if (this.rollbackCountLastHour >= this.config.maxRollbacksPerHour) {
      return null;
    }
    
    let triggerReason: TriggerReason | null = null;
    let targetVersion: string = '';
    
    if (metrics.safetyViolations > this.config.safetyViolationThreshold) {
      triggerReason = 'safety_violation';
    }
    else if (metrics.errorRate > this.config.errorRateThreshold) {
      triggerReason = 'error_rate_spike';
    }
    else if (metrics.averageResponseTimeMs > this.config.performanceThresholdMs) {
      triggerReason = 'performance_degradation';
    }
    
    if (triggerReason) {
      const rollback = await this.initiateRollback({
        targetVersion: targetVersion,
        trigger: 'automated',
        triggerReason: triggerReason,
        initiatedBy: 'system',
        description: 'Automated trigger: ' + triggerReason,
      });
      
      return rollback;
    }
    
    return null;
  }
  
  async initiateRollback(params: {
    targetVersion: string;
    trigger: RollbackTrigger;
    triggerReason: TriggerReason;
    initiatedBy: string;
    description?: string;
    targetCommitId?: string;
  }): Promise<Rollback> {
    const rollback: Rollback = {
      id: uuidv4(),
      targetVersion: params.targetVersion,
      targetCommitId: params.targetCommitId,
      trigger: params.trigger,
      reason: params.triggerReason,
      initiatedBy: params.initiatedBy,
      timestamp: new Date(),
      status: 'pending',
      affectedArtifacts: [],
      autoRollbackConfig: {
        errorRateThreshold: this.config.errorRateThreshold,
        safetyViolationThreshold: this.config.safetyViolationThreshold,
        performanceThresholdMs: this.config.performanceThresholdMs,
        detectionWindowSeconds: this.config.detectionWindowSeconds,
        cooldownSeconds: this.config.cooldownSeconds,
      },
    };
    
    const validated = RollbackSchema.safeParse(rollback);
    if (!validated.success) {
      throw new Error('Invalid rollback: ' + validated.error.message);
    }
    
    this.rollbacks.set(rollback.id, rollback);
    
    this.lastRollbackTime = Date.now();
    this.rollbackCountLastHour++;
    
    await this.auditLog.log({
      action: AUDIT_ACTIONS.ROLLBACK_INITIATED,
      actor: params.initiatedBy,
      target: rollback.id,
      targetType: 'rollback',
      details: {
        targetVersion: params.targetVersion,
        trigger: params.trigger,
        reason: params.triggerReason,
      },
    });
    
    if (this.onRollbackTriggered) {
      this.onRollbackTriggered(rollback);
    }
    
    return rollback;
  }
  
  async executeRollback(rollbackId: string): Promise<Rollback> {
    const rollback = this.rollbacks.get(rollbackId);
    
    if (!rollback) {
      throw new Error('Rollback "' + rollbackId + '" not found');
    }
    
    if (rollback.status !== 'pending') {
      throw new Error('Rollback is not in pending status');
    }
    
    rollback.status = 'in_progress';
    
    await this.auditLog.log({
      action: 'ROLLBACK_IN_PROGRESS',
      actor: 'system',
      target: rollbackId,
      targetType: 'rollback',
      details: { status: 'in_progress' },
    });
    
    return rollback;
  }
  
  async completeRollback(rollbackId: string, affectedArtifacts: string[]): Promise<Rollback> {
    const rollback = this.rollbacks.get(rollbackId);
    
    if (!rollback) {
      throw new Error('Rollback "' + rollbackId + '" not found');
    }
    
    rollback.status = 'completed';
    rollback.completedAt = new Date();
    rollback.affectedArtifacts = affectedArtifacts;
    
    await this.auditLog.log({
      action: AUDIT_ACTIONS.ROLLBACK_COMPLETED,
      actor: rollback.initiatedBy,
      target: rollbackId,
      targetType: 'rollback',
      details: {
        targetVersion: rollback.targetVersion,
        affectedArtifacts: affectedArtifacts,
      },
    });
    
    return rollback;
  }
  
  async failRollback(rollbackId: string, error: string): Promise<Rollback> {
    const rollback = this.rollbacks.get(rollbackId);
    
    if (!rollback) {
      throw new Error('Rollback "' + rollbackId + '" not found');
    }
    
    rollback.status = 'failed';
    rollback.completedAt = new Date();
    rollback.error = error;
    
    await this.auditLog.log({
      action: AUDIT_ACTIONS.ROLLBACK_FAILED,
      actor: rollback.initiatedBy,
      target: rollbackId,
      targetType: 'rollback',
      details: { error: error },
    });
    
    return rollback;
  }
  
  getRollback(id: string): Rollback | undefined {
    return this.rollbacks.get(id);
  }
  
  getRollbacks(options?: {
    status?: RollbackStatus;
    trigger?: RollbackTrigger;
    limit?: number;
  }): Rollback[] {
    let filtered = Array.from(this.rollbacks.values());
    
    if (options && options.status) {
      filtered = filtered.filter(r => r.status === options.status);
    }
    
    if (options && options.trigger) {
      filtered = filtered.filter(r => r.trigger === options.trigger);
    }
    
    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    if (options && options.limit) {
      filtered = filtered.slice(0, options.limit);
    }
    
    return filtered;
  }
  
  getRecentRollbacks(limit: number = 10): Rollback[] {
    return this.getRollbacks({ limit: limit });
  }
  
  getStatistics(): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    automatedCount: number;
    manualCount: number;
    averageCompletionTimeMs: number;
  } {
    const rollbacks = Array.from(this.rollbacks.values());
    
    const completed = rollbacks.filter(r => r.status === 'completed' && r.completedAt);
    const completionTimes = completed.map(r => 
      r.completedAt!.getTime() - r.timestamp.getTime()
    );
    
    return {
      total: rollbacks.length,
      pending: rollbacks.filter(r => r.status === 'pending').length,
      inProgress: rollbacks.filter(r => r.status === 'in_progress').length,
      completed: completed.length,
      failed: rollbacks.filter(r => r.status === 'failed').length,
      automatedCount: rollbacks.filter(r => r.trigger === 'automated').length,
      manualCount: rollbacks.filter(r => r.trigger === 'manual').length,
      averageCompletionTimeMs: completionTimes.length > 0
        ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
        : 0,
    };
  }
  
  startMonitoring(getMetrics: () => Promise<RollbackMetrics>, intervalMs: number = 10000): void {
    if (this.checkInterval) {
      throw new Error('Monitoring already started');
    }
    
    this.checkInterval = setInterval(async () => {
      try {
        const metrics = await getMetrics();
        await this.checkAndTriggerRollback(metrics);
      } catch (error) {
        console.error('Error checking rollback metrics:', error);
      }
    }, intervalMs);
  }
  
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
  
  async emergencyRollback(
    initiatedBy: string,
    targetVersion: string,
    description: string
  ): Promise<Rollback> {
    const rollback = await this.initiateRollback({
      targetVersion: targetVersion,
      trigger: 'manual',
      triggerReason: 'manual_request',
      initiatedBy: initiatedBy,
      description: description,
    });
    
    await this.executeRollback(rollback.id);
    
    return rollback;
  }
  
  async cancelRollback(rollbackId: string, cancelledBy: string): Promise<void> {
    const rollback = this.rollbacks.get(rollbackId);
    
    if (!rollback) {
      throw new Error('Rollback "' + rollbackId + '" not found');
    }
    
    if (rollback.status !== 'pending') {
      throw new Error('Only pending rollbacks can be cancelled');
    }
    
    rollback.status = 'failed';
    rollback.error = 'Cancelled by ' + cancelledBy;
    rollback.completedAt = new Date();
    
    await this.auditLog.log({
      action: 'ROLLBACK_CANCELLED',
      actor: cancelledBy,
      target: rollbackId,
      targetType: 'rollback',
      details: {},
    });
  }
  
  serialize(): string {
    return JSON.stringify({
      rollbacks: Array.from(this.rollbacks.entries()),
      lastRollbackTime: this.lastRollbackTime,
      rollbackCountLastHour: this.rollbackCountLastHour,
    }, null, 2);
  }
  
  static deserialize(
    data: string, 
    config: RollbackConfig, 
    auditLog: AuditLogService
  ): RollbackService {
    const parsed = JSON.parse(data);
    const service = new RollbackService(config, auditLog);
    
    service.rollbacks = new Map(parsed.rollbacks);
    service.lastRollbackTime = parsed.lastRollbackTime;
    service.rollbackCountLastHour = parsed.rollbackCountLastHour;
    
    return service;
  }
}

export const DEFAULT_ROLLBACK_CONFIG: RollbackConfig = {
  errorRateThreshold: 0.05,
  safetyViolationThreshold: 0,
  performanceThresholdMs: 5000,
  detectionWindowSeconds: 60,
  cooldownSeconds: 300,
  maxRollbacksPerHour: 10,
};

export function createRollbackService(
  auditLog: AuditLogService,
  config?: Partial<RollbackConfig>,
  onRollbackTriggered?: (rollback: Rollback) => void
): RollbackService {
  return new RollbackService(
    { ...DEFAULT_ROLLBACK_CONFIG, ...config },
    auditLog,
    onRollbackTriggered
  );
}
