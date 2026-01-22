import type { AuditResultStatus } from "./audit-query.dto";

/**
 * Audit log entry response
 * @example
 * {
 *   "id": "65a1234567890abcdef01234",
 *   "userId": "user123",
 *   "action": "WITHDRAW",
 *   "resource": "balance",
 *   "resourceId": "user123",
 *   "oldValues": { "balance": 1000 },
 *   "newValues": { "balance": 900 },
 *   "result": "success",
 *   "ipAddress": "192.168.1.1",
 *   "userAgent": "Mozilla/5.0...",
 *   "createdAt": "2026-01-21T10:30:00Z"
 * }
 */
export interface AuditLogResponseDto {
  /** Audit log ID */
  id: string;

  /** User ID who performed action */
  userId?: string;

  /** Action type */
  action: string;

  /** Resource type */
  resource: string;

  /** Resource ID */
  resourceId?: string;

  /** Previous values */
  oldValues?: Record<string, unknown>;

  /** New values */
  newValues?: Record<string, unknown>;

  /** Result status */
  result: AuditResultStatus;

  /** Error message if failed */
  errorMessage?: string;

  /** Client IP address */
  ipAddress?: string;

  /** User agent */
  userAgent?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;

  /** Created timestamp */
  createdAt: Date;
}

/**
 * List of audit logs with pagination
 */
export interface AuditLogListResponseDto {
  /** Audit log entries */
  data: AuditLogResponseDto[];

  /** Total count */
  total: number;

  /** Items per page */
  limit: number;

  /** Items skipped */
  skip: number;
}

/**
 * Audit summary statistics
 * @example
 * {
 *   "action": "WITHDRAW",
 *   "count": 150,
 *   "successCount": 148,
 *   "failureCount": 2
 * }
 */
export interface AuditSummaryResponseDto {
  /** Action type (if grouped by action) */
  action?: string;

  /** User ID (if grouped by user) */
  userId?: string;

  /** Total count */
  count: number;

  /** Successful count */
  successCount: number;

  /** Failed count */
  failureCount: number;
}
