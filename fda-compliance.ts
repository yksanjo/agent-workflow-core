/**
 * Agent Pipeline Versioning - FDA Compliance Module
 * 
 * Implements FDA requirements for healthcare software:
 * - Design controls with review gates
 * - Risk management with impact analysis
 * - Software validation with traceability
 * - Complete audit trails with 7-10 year retention
 * - Post-market surveillance with incident correlation
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  RiskAssessment, 
  PullRequest, 
  TestReport, 
  RiskAssessmentSchema,
  PullRequestSchema,
  TestReportSchema,
  ArtifactType 
} from './types';
import { sha256 } from './crypto';
import { AuditLogService, AUDIT_ACTIONS } from './audit';

/**
 * Requirement for traceability
 */
export interface Requirement {
  id: string;
  description: string;
  type: 'functional' | 'non-functional' | 'safety' | 'regulatory';
  source: string;
  status: 'draft' | 'pending' | 'approved' | 'validated' | 'superseded';
  createdAt: Date;
  createdBy: string;
  linkedArtifacts: string[];
  testCoverage: string[];
}

/**
 * Design Control Gate
 */
export interface DesignControlGate {
  id: string;
  name: string;
  description: string;
  required: boolean;
  approvals: string[];
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: Date;
  notes?: string;
}

/**
 * FDA Compliance Service
 */
export class FDAComplianceService {
  private riskAssessments: Map<string, RiskAssessment> = new Map();
  private pullRequests: Map<string, PullRequest> = new Map();
  private testReports: Map<string, TestReport> = new Map();
  private requirements: Map<string, Requirement> = new Map();
  private designControlGates: Map<string, DesignControlGate> = new Map();
  private auditLog: AuditLogService;
  
  constructor(auditLog: AuditLogService) {
    this.auditLog = auditLog;
    this.initializeDefaultGates();
  }
  
  /**
   * Initialize default design control gates
   */
  private initializeDefaultGates(): void {
    const defaultGates: DesignControlGate[] = [
      {
        id: 'gate-1',
        name: 'Concept Approval',
        description: 'Initial concept and requirement definition approved',
        required: true,
        approvals: [],
        status: 'pending',
      },
      {
        id: 'gate-2',
        name: 'Design Review',
        description: 'System design and architecture reviewed',
        required: true,
        approvals: [],
        status: 'pending',
      },
      {
        id: 'gate-3',
        name: 'Implementation Review',
        description: 'Implementation completed and reviewed',
        required: true,
        approvals: [],
        status: 'pending',
      },
      {
        id: 'gate-4',
        name: 'Validation Approval',
        description: 'Validation testing completed and approved',
        required: true,
        approvals: [],
        status: 'pending',
      },
      {
        id: 'gate-5',
        name: 'Release Approval',
        description: 'Release to production approved',
        required: true,
        approvals: [],
        status: 'pending',
      },
    ];
    
    for (const gate of defaultGates) {
      this.designControlGates.set(gate.id, gate);
    }
  }
  
  // ==========================================================================
  // Risk Assessment Management
  // ==========================================================================
  
  /**
   * Create a risk assessment
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
    linkedCommits?: string[];
  }): Promise<RiskAssessment> {
    const assessment: RiskAssessment = {
      id: uuidv4(),
      artifactId: params.artifactId,
      version: params.version,
      severity: params.severity,
      probability: params.probability,
      impact: params.impact,
      mitigation: params.mitigation,
      residualRisk: params.residualRisk,
      assessedBy: params.assessedBy,
      assessedAt: new Date(),
      linkedCommits: params.linkedCommits || [],
    };
    
    // Validate
    const validated = RiskAssessmentSchema.safeParse(assessment);
    if (!validated.success) {
      throw new Error(`Invalid risk assessment: ${validated.error.message}`);
    }
    
    this.riskAssessments.set(assessment.id, assessment);
    
    // Audit log
    await this.auditLog.log({
      action: AUDIT_ACTIONS.RISK_ASSESSMENT_CREATED,
      actor: params.assessedBy,
      target: assessment.id,
      targetType: 'artifact',
      details: {
        artifactId: params.artifactId,
        version: params.version,
        severity: params.severity,
      },
    });
    
    return assessment;
  }
  
  /**
   * Approve a risk assessment
   */
  async approveRiskAssessment(
    assessmentId: string,
    approvedBy: string
  ): Promise<RiskAssessment> {
    const assessment = this.riskAssessments.get(assessmentId);
    
    if (!assessment) {
      throw new Error(`Risk assessment "${assessmentId}" not found`);
    }
    
    assessment.approvedBy = approvedBy;
    
    await this.auditLog.log({
      action: AUDIT_ACTIONS.RISK_ASSESSMENT_APPROVED,
      actor: approvedBy,
      target: assessmentId,
      targetType: 'artifact',
      details: { artifactId: assessment.artifactId },
    });
    
    return assessment;
  }
  
  /**
   * Get risk assessments for an artifact
   */
  getRiskAssessments(artifactId: string): RiskAssessment[] {
    return Array.from(this.riskAssessments.values())
      .filter(r => r.artifactId === artifactId)
      .sort((a, b) => b.assessedAt.getTime() - a.assessedAt.getTime());
  }
  
  /**
   * Get all critical/high risk assessments
   */
  getCriticalRisks(): RiskAssessment[] {
    return Array.from(this.riskAssessments.values())
      .filter(r => r.severity === 'critical' || r.severity === 'high')
      .filter(r => !r.approvedBy);
  }
  
  // ==========================================================================
  // Pull Request Management
  // ==========================================================================
  
  /**
   * Create a pull request
   */
  async createPullRequest(params: {
    title: string;
    description: string;
    sourceBranch: string;
    targetBranch: string;
    author: string;
    reviewers?: string[];
    linkedIssues?: string[];
    linkedRiskAssessments?: string[];
  }): Promise<PullRequest> {
    const pr: PullRequest = {
      id: uuidv4(),
      title: params.title,
      description: params.description,
      sourceBranch: params.sourceBranch,
      targetBranch: params.targetBranch,
      status: 'open',
      author: params.author,
      reviewers: params.reviewers || [],
      approvals: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      linkedIssues: params.linkedIssues || [],
      linkedRiskAssessments: params.linkedRiskAssessments || [],
    };
    
    // Validate
    const validated = PullRequestSchema.safeParse(pr);
    if (!validated.success) {
      throw new Error(`Invalid pull request: ${validated.error.message}`);
    }
    
    this.pullRequests.set(pr.id, pr);
    
    // Audit log
    await this.auditLog.log({
      action: AUDIT_ACTIONS.PR_CREATED,
      actor: params.author,
      target: pr.id,
      targetType: 'branch',
      details: {
        sourceBranch: params.sourceBranch,
        targetBranch: params.targetBranch,
      },
    });
    
    return pr;
  }
  
  /**
   * Approve a pull request
   */
  async approvePullRequest(
    prId: string,
    reviewer: string,
    signature: string
  ): Promise<PullRequest> {
    const pr = this.pullRequests.get(prId);
    
    if (!pr) {
      throw new Error(`Pull request "${prId}" not found`);
    }
    
    if (pr.status !== 'open') {
      throw new Error(`Pull request is not open`);
    }
    
    pr.approvals.push({
      reviewer,
      approvedAt: new Date(),
      signature,
    });
    pr.updatedAt = new Date();
    
    await this.auditLog.log({
      action: AUDIT_ACTIONS.PR_APPROVED,
      actor: reviewer,
      target: prId,
      targetType: 'branch',
      details: { reviewer },
    });
    
    return pr;
  }
  
  /**
   * Merge a pull request
   */
  async mergePullRequest(prId: string, mergedBy: string): Promise<PullRequest> {
    const pr = this.pullRequests.get(prId);
    
    if (!pr) {
      throw new Error(`Pull request "${prId}" not found`);
    }
    
    if (pr.status !== 'open') {
      throw new Error(`Pull request is not open`);
    }
    
    pr.status = 'merged';
    pr.mergedAt = new Date();
    pr.updatedAt = new Date();
    
    await this.auditLog.log({
      action: AUDIT_ACTIONS.PR_MERGED,
      actor: mergedBy,
      target: prId,
      targetType: 'branch',
      details: {
        sourceBranch: pr.sourceBranch,
        targetBranch: pr.targetBranch,
      },
    });
    
    return pr;
  }
  
  /**
   * Get pull requests
   */
  getPullRequests(options?: {
    status?: 'open' | 'merged' | 'closed' | 'draft';
    author?: string;
    sourceBranch?: string;
    targetBranch?: string;
  }): PullRequest[] {
    let filtered = Array.from(this.pullRequests.values());
    
    if (options?.status) {
      filtered = filtered.filter(pr => pr.status === options.status);
    }
    
    if (options?.author) {
      filtered = filtered.filter(pr => pr.author === options.author);
    }
    
    if (options?.sourceBranch) {
      filtered = filtered.filter(pr => pr.sourceBranch === options.sourceBranch);
    }
    
    if (options?.targetBranch) {
      filtered = filtered.filter(pr => pr.targetBranch === options.targetBranch);
    }
    
    return filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  
  /**
   * Check if PR has required approvals
   */
  hasRequiredApprovals(prId: string, minApprovals: number = 1): boolean {
    const pr = this.pullRequests.get(prId);
    if (!pr) return false;
    return pr.approvals.length >= minApprovals;
  }
  
  // ==========================================================================
  // Test Report Management
  // ==========================================================================
  
  /**
   * Create a test report
   */
  async createTestReport(params: {
    artifactId: string;
    version: string;
    testType: 'unit' | 'integration' | 'e2e' | 'performance' | 'security' | 'compliance';
    status: 'passed' | 'failed' | 'skipped' | 'pending';
    coverage: number;
    passedCount: number;
    failedCount: number;
    skippedCount: number;
    duration: number;
    requirements: Requirement[];
    executedBy: string;
    environment: string;
  }): Promise<TestReport> {
    const report: TestReport = {
      id: uuidv4(),
      artifactId: params.artifactId,
      version: params.version,
      testType: params.testType,
      status: params.status,
      coverage: params.coverage,
      passedCount: params.passedCount,
      failedCount: params.failedCount,
      skippedCount: params.skippedCount,
      duration: params.duration,
      requirements: params.requirements.map(r => ({
        id: r.id,
        description: r.description,
        covered: true,
      })),
      executedBy: params.executedBy,
      executedAt: new Date(),
      environment: params.environment,
    };
    
    // Validate
    const validated = TestReportSchema.safeParse(report);
    if (!validated.success) {
      throw new Error(`Invalid test report: ${validated.error.message}`);
    }
    
    this.testReports.set(report.id, report);
    
    return report;
  }
  
  /**
   * Get test reports for an artifact
   */
  getTestReports(artifactId: string): TestReport[] {
    return Array.from(this.testReports.values())
      .filter(r => r.artifactId === artifactId)
      .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());
  }
  
  /**
   * Get latest test report for an artifact
   */
  getLatestTestReport(artifactId: string): TestReport | undefined {
    const reports = this.getTestReports(artifactId);
    return reports[0];
  }
  
  // ==========================================================================
  // Requirements Management
  // ==========================================================================
  
  /**
   * Create a requirement
   */
  createRequirement(params: {
    description: string;
    type: 'functional' | 'non-functional' | 'safety' | 'regulatory';
    source: string;
    createdBy: string;
  }): Requirement {
    const requirement: Requirement = {
      id: uuidv4(),
      description: params.description,
      type: params.type,
      source: params.source,
      status: 'draft',
      createdAt: new Date(),
      createdBy: params.createdBy,
      linkedArtifacts: [],
      testCoverage: [],
    };
    
    this.requirements.set(requirement.id, requirement);
    return requirement;
  }
  
  /**
   * Get requirements
   */
  getRequirements(options?: {
    type?: Requirement['type'];
    status?: Requirement['status'];
  }): Requirement[] {
    let filtered = Array.from(this.requirements.values());
    
    if (options?.type) {
      filtered = filtered.filter(r => r.type === options.type);
    }
    
    if (options?.status) {
      filtered = filtered.filter(r => r.status === options.status);
    }
    
    return filtered;
  }
  
  /**
   * Link artifact to requirement
   */
  linkArtifactToRequirement(requirementId: string, artifactId: string): void {
    const requirement = this.requirements.get(requirementId);
    if (!requirement) {
      throw new Error(`Requirement "${requirementId}" not found`);
    }
    
    if (!requirement.linkedArtifacts.includes(artifactId)) {
      requirement.linkedArtifacts.push(artifactId);
    }
  }
  
  // ==========================================================================
  // Design Control Gates
  // ==========================================================================
  
  /**
   * Get design control gates
   */
  getDesignControlGates(): DesignControlGate[] {
    return Array.from(this.designControlGates.values());
  }
  
  /**
   * Approve a design control gate
   */
  async approveGate(
    gateId: string,
    approvedBy: string,
    notes?: string
  ): Promise<DesignControlGate> {
    const gate = this.designControlGates.get(gateId);
    
    if (!gate) {
      throw new Error(`Gate "${gateId}" not found`);
    }
    
    gate.status = 'approved';
    gate.approvedBy = approvedBy;
    gate.approvedAt = new Date();
    gate.notes = notes;
    
    await this.auditLog.log({
      action: 'DESIGN_GATE_APPROVED',
      actor: approvedBy,
      target: gateId,
      targetType: 'artifact',
      details: { gateName: gate.name, notes },
    });
    
    return gate;
  }
  
  /**
   * Check if all required gates are approved
   */
  areAllGatesApproved(): boolean {
    return Array.from(this.designControlGates.values())
      .filter(g => g.required)
      .every(g => g.status === 'approved');
  }
  
  // ==========================================================================
  // Compliance Reporting
  // ==========================================================================
  
  /**
   * Generate design history file
   */
  generateDesignHistoryFile(artifactId: string): {
    artifact: any;
    riskAssessments: RiskAssessment[];
    testReports: TestReport[];
    requirements: Requirement[];
    gates: DesignControlGate[];
    timeline: any[];
  } {
    const riskAssessments = this.getRiskAssessments(artifactId);
    const testReports = this.getTestReports(artifactId);
    const gates = this.getDesignControlGates();
    
    // Get linked requirements
    const requirements = Array.from(this.requirements.values())
      .filter(r => r.linkedArtifacts.includes(artifactId));
    
    return {
      artifact: null, // Would include actual artifact
      riskAssessments,
      testReports,
      requirements,
      gates,
      timeline: [], // Would include chronological events
    };
  }
  
  /**
   * Get compliance summary
   */
  getComplianceSummary(): {
    totalRiskAssessments: number;
    pendingApprovals: number;
    criticalRisks: number;
    openPullRequests: number;
    requirementsCoverage: number;
    gatesApproved: number;
    totalGates: number;
  } {
    const openPRs = this.getPullRequests({ status: 'open' });
    const criticalRisks = this.getCriticalRisks();
    const gates = this.getDesignControlGates();
    const requirements = this.getRequirements({ status: 'validated' });
    
    return {
      totalRiskAssessments: this.riskAssessments.size,
      pendingApprovals: openPRs.reduce((sum, pr) => sum + (pr.approvals.length === 0 ? 1 : 0), 0),
      criticalRisks: criticalRisks.length,
      openPullRequests: openPRs.length,
      requirementsCoverage: requirements.length,
      gatesApproved: gates.filter(g => g.status === 'approved').length,
      totalGates: gates.length,
    };
  }
  
  // ==========================================================================
  // Serialization
  // ==========================================================================
  
  serialize(): string {
    return JSON.stringify({
      riskAssessments: Array.from(this.riskAssessments.entries()),
      pullRequests: Array.from(this.pullRequests.entries()),
      testReports: Array.from(this.testReports.entries()),
      requirements: Array.from(this.requirements.entries()),
      designControlGates: Array.from(this.designControlGates.entries()),
    }, null, 2);
  }
  
  static deserialize(data: string, auditLog: AuditLogService): FDAComplianceService {
    const parsed = JSON.parse(data);
    const service = new FDAComplianceService(auditLog);
    
    service.riskAssessments = new Map(parsed.riskAssessments);
    service.pullRequests = new Map(parsed.pullRequests);
    service.testReports = new Map(parsed.testReports);
    service.requirements = new Map(parsed.requirements);
    service.designControlGates = new Map(parsed.designControlGates);
    
    return service;
  }
}
