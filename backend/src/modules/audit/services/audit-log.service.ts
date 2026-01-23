import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types, PipelineStage } from "mongoose";
import { AuditLog, AuditLogDocument } from "@/schemas";

interface CreateAuditLogDto {
  userId?: Types.ObjectId | string;
  action: string;
  resource: string;
  resourceId?: Types.ObjectId | string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  result: "success" | "failure";
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

interface AuditLogFilter {
  userId?: Types.ObjectId | string;
  action?: string;
  resource?: string;
  result?: "success" | "failure";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  skip?: number;
}

interface AuditLogSummary {
  action: string;
  count: number;
  successCount: number;
  failureCount: number;
}

interface UserAuditLogSummary {
  userId: Types.ObjectId | null;
  count: number;
  successCount: number;
  failureCount: number;
}

interface DateRangeQuery {
  $gte?: Date;
  $lte?: Date;
}

interface AuditLogQueryFilter {
  userId?: Types.ObjectId;
  action?: string;
  resource?: string;
  result?: "success" | "failure";
  createdAt?: DateRangeQuery;
}

interface MatchStageWithCreatedAt {
  userId?: { $exists: boolean; $ne: null };
  createdAt?: DateRangeQuery;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name)
    private auditLogModel: Model<AuditLogDocument>,
  ) {}

  async createLog(dto: CreateAuditLogDto): Promise<AuditLogDocument> {
    const auditLog = new this.auditLogModel({
      ...dto,
      userId:
        dto.userId !== undefined ? new Types.ObjectId(dto.userId) : undefined,
      resourceId:
        dto.resourceId !== undefined
          ? new Types.ObjectId(dto.resourceId)
          : undefined,
    });
    return await auditLog.save();
  }

  async findByUser(
    userId: string | Types.ObjectId,
    options?: { limit?: number; skip?: number },
  ): Promise<AuditLogDocument[]> {
    return await this.auditLogModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(options?.limit ?? 100)
      .skip(options?.skip ?? 0)
      .exec();
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: { limit?: number; skip?: number },
  ): Promise<AuditLogDocument[]> {
    return await this.auditLogModel
      .find({
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      })
      .sort({ createdAt: -1 })
      .limit(options?.limit ?? 100)
      .skip(options?.skip ?? 0)
      .exec();
  }

  async findByAction(
    action: string,
    options?: { limit?: number; skip?: number },
  ): Promise<AuditLogDocument[]> {
    return await this.auditLogModel
      .find({ action })
      .sort({ createdAt: -1 })
      .limit(options?.limit ?? 100)
      .skip(options?.skip ?? 0)
      .exec();
  }

  async findByResource(
    resource: string,
    options?: { limit?: number; skip?: number },
  ): Promise<AuditLogDocument[]> {
    return await this.auditLogModel
      .find({ resource })
      .sort({ createdAt: -1 })
      .limit(options?.limit ?? 100)
      .skip(options?.skip ?? 0)
      .exec();
  }

  async findWithFilters(filter: AuditLogFilter): Promise<AuditLogDocument[]> {
    const query: AuditLogQueryFilter = {};

    if (filter.userId !== undefined) {
      query.userId = new Types.ObjectId(filter.userId);
    }
    if (filter.action !== undefined) {
      query.action = filter.action;
    }
    if (filter.resource !== undefined) {
      query.resource = filter.resource;
    }
    if (filter.result !== undefined) {
      query.result = filter.result;
    }
    if (filter.startDate !== undefined || filter.endDate !== undefined) {
      query.createdAt = {};
      if (filter.startDate !== undefined) {
        query.createdAt.$gte = filter.startDate;
      }
      if (filter.endDate !== undefined) {
        query.createdAt.$lte = filter.endDate;
      }
    }

    return await this.auditLogModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(filter.limit ?? 100)
      .skip(filter.skip ?? 0)
      .exec();
  }

  async getSummaryByAction(
    startDate?: Date,
    endDate?: Date,
  ): Promise<AuditLogSummary[]> {
    const matchStage: MatchStageWithCreatedAt = {};
    if (startDate !== undefined || endDate !== undefined) {
      matchStage.createdAt = {};
      if (startDate !== undefined) {
        matchStage.createdAt.$gte = startDate;
      }
      if (endDate !== undefined) {
        matchStage.createdAt.$lte = endDate;
      }
    }

    const pipeline: PipelineStage[] = [];
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push(
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
          successCount: {
            $sum: { $cond: [{ $eq: ["$result", "success"] }, 1, 0] },
          },
          failureCount: {
            $sum: { $cond: [{ $eq: ["$result", "failure"] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          action: "$_id",
          count: 1,
          successCount: 1,
          failureCount: 1,
        },
      },
      { $sort: { count: -1 } },
    );

    return await this.auditLogModel.aggregate<AuditLogSummary>(pipeline).exec();
  }

  async getSummaryByUser(
    startDate?: Date,
    endDate?: Date,
  ): Promise<UserAuditLogSummary[]> {
    const matchStage: MatchStageWithCreatedAt = {
      userId: { $exists: true, $ne: null },
    };
    if (startDate !== undefined || endDate !== undefined) {
      matchStage.createdAt = {};
      if (startDate !== undefined) {
        matchStage.createdAt.$gte = startDate;
      }
      if (endDate !== undefined) {
        matchStage.createdAt.$lte = endDate;
      }
    }

    return await this.auditLogModel
      .aggregate<UserAuditLogSummary>([
        { $match: matchStage },
        {
          $group: {
            _id: "$userId",
            count: { $sum: 1 },
            successCount: {
              $sum: { $cond: [{ $eq: ["$result", "success"] }, 1, 0] },
            },
            failureCount: {
              $sum: { $cond: [{ $eq: ["$result", "failure"] }, 1, 0] },
            },
          },
        },
        {
          $project: {
            _id: 0,
            userId: "$_id",
            count: 1,
            successCount: 1,
            failureCount: 1,
          },
        },
        { $sort: { count: -1 } },
      ])
      .exec();
  }

  async countLogs(filter?: Partial<AuditLogFilter>): Promise<number> {
    const query: AuditLogQueryFilter = {};
    if (filter?.userId !== undefined) {
      query.userId = new Types.ObjectId(filter.userId);
    }
    if (filter?.action !== undefined) {
      query.action = filter.action;
    }
    if (filter?.resource !== undefined) {
      query.resource = filter.resource;
    }
    if (filter?.result !== undefined) {
      query.result = filter.result;
    }
    return await this.auditLogModel.countDocuments(query).exec();
  }
}
