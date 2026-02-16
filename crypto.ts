/**
 * Agent Pipeline Versioning - Cryptographic Utilities
 * 
 * Provides cryptographic signing and verification for immutable audit logs
 * and commit verification.
 */

import CryptoJS from 'crypto-js';

// ============================================================================
// Hashing Functions
// ============================================================================

/**
 * Generate SHA-256 hash of data
 */
export function sha256(data: any): string {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  return CryptoJS.SHA256(serialized).toString();
}

/**
 * Generate SHA-256 hash with previous hash for chain integrity
 */
export function hashWithPrevious(data: any, previousHash: string): string {
  const combined = sha256(data) + previousHash;
  return CryptoJS.SHA256(combined).toString();
}

/**
 * Verify hash integrity
 */
export function verifyHash(data: any, expectedHash: string): boolean {
  return sha256(data) === expectedHash;
}

// ============================================================================
// Signing and Verification
// ============================================================================

/**
 * Generate a cryptographic signature for commits and approvals
 * Note: In production, use proper asymmetric cryptography (RSA/ECDSA)
 */
export function generateSignature(data: any, secretKey: string): string {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  const hmac = CryptoJS.HmacSHA256(serialized, secretKey);
  return hmac.toString();
}

/**
 * Verify a cryptographic signature
 */
export function verifySignature(data: any, signature: string, secretKey: string): boolean {
  const expectedSignature = generateSignature(data, secretKey);
  return expectedSignature === signature;
}

/**
 * Generate a commit signature with metadata
 */
export interface CommitSignatureData {
  artifactId: string;
  version: string;
  message: string;
  author: string;
  parentCommits: string[];
  timestamp: string;
  content: any;
}

export function signCommit(data: CommitSignatureData, secretKey: string): string {
  const payload = [
    data.artifactId,
    data.version,
    data.message,
    data.author,
    data.parentCommits.join(','),
    data.timestamp,
    typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
  ].join('|');
  
  return generateSignature(payload, secretKey);
}

/**
 * Verify commit signature
 */
export function verifyCommitSignature(
  data: CommitSignatureData,
  signature: string,
  secretKey: string
): boolean {
  return verifySignature(
    [
      data.artifactId,
      data.version,
      data.message,
      data.author,
      data.parentCommits.join(','),
      data.timestamp,
      typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
    ].join('|'),
    signature,
    secretKey
  );
}

// ============================================================================
// Audit Log Hash Chain
// ============================================================================

/**
 * Create initial hash for audit log chain
 */
export function createInitialHash(): string {
  return sha256('AGENT_PIPELINE_VERSIONING_INITIAL_HASH_' + Date.now());
}

/**
 * Create audit log hash with chain integrity
 */
export interface AuditLogData {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
  details: any;
}

export function createAuditHash(
  logData: AuditLogData,
  previousHash: string | undefined
): string {
  const payload = [
    logData.id,
    logData.action,
    logData.actor,
    logData.target,
    logData.timestamp,
    JSON.stringify(logData.details),
    previousHash || '',
  ].join('|');
  
  return sha256(payload);
}

/**
 * Verify audit log chain integrity
 */
export function verifyAuditChain(logs: Array<{ id: string; hash: string; previousHash?: string }>): boolean {
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    const expectedPreviousHash = i > 0 ? logs[i - 1].hash : undefined;
    
    if (log.previousHash !== expectedPreviousHash) {
      return false;
    }
  }
  return true;
}

// ============================================================================
// Encryption for Sensitive Data
// ============================================================================

/**
 * Encrypt sensitive data (e.g., API keys in environment variables)
 */
export function encrypt(data: string, encryptionKey: string): string {
  return CryptoJS.AES.encrypt(data, encryptionKey).toString();
}

/**
 * Decrypt sensitive data
 */
export function decrypt(encryptedData: string, encryptionKey: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedData, encryptionKey);
  return bytes.toString(CryptoJS.enc.Utf8);
}

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Derive a key from user password for signing
 */
export function deriveKey(password: string, salt: string): string {
  const key = CryptoJS.PBKDF2(password, salt, {
    keySize: 256 / 32,
    iterations: 10000,
  });
  return key.toString();
}

// ============================================================================
// Hash for Content Addressing
// ============================================================================

/**
 * Generate content-addressable hash for artifacts
 * Used for deduplication and integrity verification
 */
export function contentHash(content: any): string {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  return sha256(contentStr);
}
