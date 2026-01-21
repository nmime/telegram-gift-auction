import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { AuditLog, AuditLogDocument } from "@/schemas";

export interface CreateAuditLogDto {
  userId?: Types.ObjectId | string;
  action: string;
  resource: string;
  resourceId?: Types.ObjectId | string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  result: "success" | "failure";
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export interface AuditLogFilter {
  userId?: Types.ObjectId | string;
  action?: string;
  resource?: string;
  result?: "success" | "failure";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  skip?: number;
}

export interface AuditLogSummary {
  action: string;
  count: number;
  successCount: number;
  failureCount: number;
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
      userId: dto.userId ? new Types.ObjectId(dto.userId) : undefined,
      resourceId: dto.resourceId
        ? new Types.ObjectId(dto.resourceId)
        : undefined,
    });
    return auditLog.save();
  }

  async findByUser(
    userId: string | Types.ObjectId,
    options?: { limit?: number; skip?: number },
  ): Promise<AuditLogDocument[]> {
    return this.auditLogModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(options?.limit || 100)
      .skip(options?.skip || 0)
      .exec();
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: { limit?: number; skip?: number },
  ): Promise<AuditLogDocument[]> {
    return this.auditLogModel
      .find({
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      })
      .sort({ createdAt: -1 })
      .limit(options?.limit || 100)
      .skip(options?.skip || 0)
      .exec();
  }

  async findByAction(
    action: string,
    options?: { limit?: number; skip?: number },
  ): Promise<AuditLogDocument[]> {
    return this.auditLogModel
      .find({ action })
      .sort({ createdAt: -1 })
      .limit(options?.limit || 100)
      .skip(options?.skip || 0)
      .exec();
  }

  async findByResource(
    resource: string,
    options?: { limit?: number; skip?: number },
  ): Promise<AuditLogDocument[]> {
    return this.auditLogModel
      .find({ resource })
      .sort({ createdAt: -1 })
      .limit(options?.limit || 100)
      .skip(options?.skip || 0)
      .exec();
  }

  async findWithFilters(filter: AuditLogFilter): Promise<AuditLogDocument[]> {
    const query: any = {};

    if (filter.userId) {
      query.userId = new Types.ObjectId(filter.userId);
    }
    if (filter.action) {
      query.action = filter.action;
    }
    if (filter.resource) {
      query.resource = filter.resource;
    }
    if (filter.result) {
      query.result = filter.result;
    }
    if (filter.startDate || filter.endDate) {
      query.createdAt = {};
      if (filter.startDate) {
        query.createdAt.$gte = filter.startDate;
      }
      if (filter.endDate) {
        query.createdAt.$lte = filter.endDate;
      }
    }

    return this.auditLogModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(filter.limit || 100)
      .skip(filter.skip || 0)
      .exec();
  }

  async getSummaryByAction(
    startDate?: Date,
    endDate?: Date,
  ): Promise<AuditLogSummary[]> {
    const matchStage: any = {};
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }

    const pipeline: any[] = [];
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

    return this.auditLogModel.aggregate(pipeline).exec();
  }

  async getSummaryByUser(startDate?: Date, endDate?: Date): Promise<any[]> {
    const matchStage: any = { userId: { $exists: true, $ne: null } };
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }

    return this.auditLogModel
      .aggregate([
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
    const query: any = {};
    if (filter?.userId) {
      query.userId = new Types.ObjectId(filter.userId);
    }
    if (filter?.action) {
      query.action = filter.action;
    }
    if (filter?.resource) {
      query.resource = filter.resource;
    }
    if (filter?.result) {
      query.result = filter.result;
    }
    return this.auditLogModel.countDocuments(query).exec();
  }
}
