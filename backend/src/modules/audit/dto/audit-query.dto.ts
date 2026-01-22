import type { tags } from "typia";

/**
 * Audit action result status
 */
export enum AuditResultStatus {
  SUCCESS = "success",
  FAILURE = "failure",
}

/**
 * Audit summary grouping option
 */
export enum AuditGroupBy {
  ACTION = "action",
  USER = "user",
}

/**
 * Query parameters for fetching audit logs
 * @example
 * {
 *   "userId": "user123",
 *   "action": "WITHDRAW",
 *   "result": "success",
 *   "startDate": "2026-01-01",
 *   "endDate": "2026-01-31",
 *   "limit": 50,
 *   "skip": 0
 * }
 */
export interface AuditLogQueryDto {
  /** Optional user ID filter */
  userId?: string & tags.Format<"uuid">;

  /** Optional action type filter */
  action?: string;

  /** Optional resource filter */
  resource?: string;

  /** Optional result filter */
  result?: AuditResultStatus;

  /** Optional start date filter (ISO 8601 format) */
  startDate?: string & tags.Format<"date">;

  /** Optional end date filter (ISO 8601 format) */
  endDate?: string & tags.Format<"date">;

  /** Limit per page (default: 100, min: 1, max: 1000) */
  limit?: number & tags.Type<"uint32"> & tags.Minimum<1> & tags.Maximum<1000>;

  /** Number of records to skip (default: 0, min: 0) */
  skip?: number & tags.Type<"uint32"> & tags.Minimum<0>;
}

/**
 * Query parameters for audit summary
 * @example
 * {
 *   "startDate": "2026-01-01",
 *   "endDate": "2026-01-31",
 *   "groupBy": "action"
 * }
 */
export interface AuditSummaryQueryDto {
  /** Optional start date filter (ISO 8601 format) */
  startDate?: string & tags.Format<"date">;

  /** Optional end date filter (ISO 8601 format) */
  endDate?: string & tags.Format<"date">;

  /** Group by action or user (default: action) */
  groupBy?: AuditGroupBy & tags.Default<AuditGroupBy.ACTION>;
}
