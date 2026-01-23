import type { AuditResultStatus } from "./audit-query.dto";

export interface AuditLogResponseDto {
  id: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  result: AuditResultStatus;
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditLogListResponseDto {
  data: AuditLogResponseDto[];
  total: number;
  limit: number;
  skip: number;
}

export interface AuditSummaryResponseDto {
  action?: string;
  userId?: string;
  count: number;
  successCount: number;
  failureCount: number;
}
