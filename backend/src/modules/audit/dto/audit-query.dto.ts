import type { tags } from "typia";

export enum AuditResultStatus {
  SUCCESS = "success",
  FAILURE = "failure",
}

export enum AuditGroupBy {
  ACTION = "action",
  USER = "user",
}

export interface AuditLogQueryDto {
  userId?: string & tags.Format<"uuid">;
  action?: string;
  resource?: string;
  result?: AuditResultStatus;
  startDate?: string & tags.Format<"date">;
  endDate?: string & tags.Format<"date">;
  limit?: number & tags.Type<"uint32"> & tags.Minimum<1> & tags.Maximum<1000>;
  skip?: number & tags.Type<"uint32"> & tags.Minimum<0>;
}

export interface AuditSummaryQueryDto {
  startDate?: string & tags.Format<"date">;
  endDate?: string & tags.Format<"date">;
  groupBy?: AuditGroupBy & tags.Default<AuditGroupBy.ACTION>;
}
