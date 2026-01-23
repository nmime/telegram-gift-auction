import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { AuditLogService } from "./services";
import {
  AuditLogQueryDto,
  AuditSummaryQueryDto,
  AuditLogListResponseDto,
  AuditLogResponseDto,
  AuditSummaryResponseDto,
  AuditResultStatus,
} from "./dto";
import { AuthGuard } from "@/common";
import type { AuditLogDocument } from "@/schemas";

@Controller("api/audit")
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get("logs")
  async getLogs(
    @Query() query: AuditLogQueryDto,
  ): Promise<AuditLogListResponseDto> {
    const filter = {
      userId: query.userId,
      action: query.action,
      resource: query.resource,
      result: query.result,
      startDate:
        query.startDate !== undefined ? new Date(query.startDate) : undefined,
      endDate:
        query.endDate !== undefined ? new Date(query.endDate) : undefined,
      limit: query.limit ?? 100,
      skip: query.skip ?? 0,
    };

    const [logs, total] = await Promise.all([
      this.auditLogService.findWithFilters(filter),
      this.auditLogService.countLogs(filter),
    ]);

    return {
      data: logs.map((log) => this.mapToResponseDto(log)),
      total,
      limit: filter.limit,
      skip: filter.skip,
    };
  }

  @Get("summary")
  async getSummary(
    @Query() query: AuditSummaryQueryDto,
  ): Promise<AuditSummaryResponseDto[]> {
    const startDate =
      query.startDate !== undefined ? new Date(query.startDate) : undefined;
    const endDate =
      query.endDate !== undefined ? new Date(query.endDate) : undefined;

    if (query.groupBy === "user") {
      const summary = await this.auditLogService.getSummaryByUser(
        startDate,
        endDate,
      );
      return summary.map((item) => ({
        userId: item.userId?.toString(),
        count: item.count,
        successCount: item.successCount,
        failureCount: item.failureCount,
      }));
    }

    const summary = await this.auditLogService.getSummaryByAction(
      startDate,
      endDate,
    );
    return summary;
  }

  @Get("user/:userId")
  async getUserLogs(
    @Param("userId") userId: string,
    @Query("limit") limit?: number,
    @Query("skip") skip?: number,
  ): Promise<AuditLogResponseDto[]> {
    const logs = await this.auditLogService.findByUser(userId, {
      limit: limit ?? 100,
      skip: skip ?? 0,
    });
    return logs.map((log) => this.mapToResponseDto(log));
  }

  @Get("action/:action")
  async getActionLogs(
    @Param("action") action: string,
    @Query("limit") limit?: number,
    @Query("skip") skip?: number,
  ): Promise<AuditLogResponseDto[]> {
    const logs = await this.auditLogService.findByAction(action, {
      limit: limit ?? 100,
      skip: skip ?? 0,
    });
    return logs.map((log) => this.mapToResponseDto(log));
  }

  private mapToResponseDto(log: AuditLogDocument): AuditLogResponseDto {
    return {
      id: log._id.toString(),
      userId: log.userId?.toString(),
      action: log.action,
      resource: log.resource,
      resourceId: log.resourceId?.toString(),
      oldValues: log.oldValues,
      newValues: log.newValues,
      result:
        log.result === "success"
          ? AuditResultStatus.SUCCESS
          : AuditResultStatus.FAILURE,
      errorMessage: log.errorMessage,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      metadata: log.metadata,
      createdAt: log.createdAt,
    };
  }
}
