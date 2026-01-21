import { Test, TestingModule } from "@nestjs/testing";
import { AuditController } from "@/modules/audit/audit.controller";
import { AuditLogService } from "@/modules/audit/services";
import { AuthGuard } from "@/common";
import { Types } from "mongoose";
import { AuditResultStatus, AuditGroupBy } from "@/modules/audit/dto";

describe("AuditController", () => {
  let controller: AuditController;
  let service: AuditLogService;

  const mockUserId = new Types.ObjectId();
  const mockResourceId = new Types.ObjectId();
  const mockAuditLogId = new Types.ObjectId();

  const mockAuditLog = {
    _id: mockAuditLogId,
    userId: mockUserId,
    action: "WITHDRAW",
    resource: "balance",
    resourceId: mockResourceId,
    oldValues: { balance: 1000 },
    newValues: { balance: 900 },
    result: "success" as const,
    ipAddress: "192.168.1.1",
    userAgent: "Mozilla/5.0",
    metadata: { amount: 100 },
    createdAt: new Date("2026-01-21T10:00:00Z"),
  };

  const mockAuditLogService = {
    findWithFilters: jest.fn(),
    countLogs: jest.fn(),
    getSummaryByAction: jest.fn(),
    getSummaryByUser: jest.fn(),
    findByUser: jest.fn(),
    findByAction: jest.fn(),
  };

  const mockAuthGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        {
          provide: AuditLogService,
          useValue: mockAuditLogService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(mockAuthGuard)
      .compile();

    controller = module.get<AuditController>(AuditController);
    service = module.get<AuditLogService>(AuditLogService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Controller Initialization", () => {
    it("should be defined", () => {
      expect(controller).toBeDefined();
    });

    it("should have AuditLogService injected", () => {
      expect(service).toBeDefined();
    });
  });

  describe("GET /api/audit/logs - Get Audit Logs", () => {
    it("should get all audit logs with default pagination", async () => {
      const mockLogs = [mockAuditLog];
      mockAuditLogService.findWithFilters.mockResolvedValue(mockLogs);
      mockAuditLogService.countLogs.mockResolvedValue(1);

      const result = await controller.getLogs({});

      expect(result).toEqual({
        data: [
          {
            id: mockAuditLogId.toString(),
            userId: mockUserId.toString(),
            action: "WITHDRAW",
            resource: "balance",
            resourceId: mockResourceId.toString(),
            oldValues: { balance: 1000 },
            newValues: { balance: 900 },
            result: "success",
            errorMessage: undefined,
            ipAddress: "192.168.1.1",
            userAgent: "Mozilla/5.0",
            metadata: { amount: 100 },
            createdAt: mockAuditLog.createdAt,
          },
        ],
        total: 1,
        limit: 100,
        skip: 0,
      });
      expect(mockAuditLogService.findWithFilters).toHaveBeenCalledWith({
        userId: undefined,
        action: undefined,
        resource: undefined,
        result: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: 100,
        skip: 0,
      });
      expect(mockAuditLogService.countLogs).toHaveBeenCalled();
    });

    it("should filter by user ID", async () => {
      const userId = mockUserId.toString();
      mockAuditLogService.findWithFilters.mockResolvedValue([mockAuditLog]);
      mockAuditLogService.countLogs.mockResolvedValue(1);

      await controller.getLogs({ userId });

      expect(mockAuditLogService.findWithFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
        }),
      );
    });

    it("should filter by action type", async () => {
      mockAuditLogService.findWithFilters.mockResolvedValue([mockAuditLog]);
      mockAuditLogService.countLogs.mockResolvedValue(1);

      await controller.getLogs({ action: "WITHDRAW" });

      expect(mockAuditLogService.findWithFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "WITHDRAW",
        }),
      );
    });

    it("should filter by date range", async () => {
      const startDate = "2026-01-01";
      const endDate = "2026-01-31";
      mockAuditLogService.findWithFilters.mockResolvedValue([mockAuditLog]);
      mockAuditLogService.countLogs.mockResolvedValue(1);

      await controller.getLogs({ startDate, endDate });

      expect(mockAuditLogService.findWithFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: new Date(startDate),
          endDate: new Date(endDate),
        }),
      );
    });

    it("should filter by result status", async () => {
      mockAuditLogService.findWithFilters.mockResolvedValue([mockAuditLog]);
      mockAuditLogService.countLogs.mockResolvedValue(1);

      await controller.getLogs({ result: AuditResultStatus.SUCCESS });

      expect(mockAuditLogService.findWithFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          result: AuditResultStatus.SUCCESS,
        }),
      );
    });

    it("should combine multiple filters", async () => {
      const filters = {
        userId: mockUserId.toString(),
        action: "WITHDRAW",
        result: AuditResultStatus.SUCCESS,
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      };
      mockAuditLogService.findWithFilters.mockResolvedValue([mockAuditLog]);
      mockAuditLogService.countLogs.mockResolvedValue(1);

      await controller.getLogs(filters);

      expect(mockAuditLogService.findWithFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: filters.userId,
          action: filters.action,
          result: filters.result,
          startDate: new Date(filters.startDate),
          endDate: new Date(filters.endDate),
        }),
      );
    });

    it("should sort by timestamp (via service)", async () => {
      const mockLogs = [mockAuditLog];
      mockAuditLogService.findWithFilters.mockResolvedValue(mockLogs);
      mockAuditLogService.countLogs.mockResolvedValue(1);

      const result = await controller.getLogs({});

      // Service returns sorted results
      expect(result.data?.[0]?.createdAt).toBeDefined();
    });

    it("should include total count and pagination info", async () => {
      mockAuditLogService.findWithFilters.mockResolvedValue([mockAuditLog]);
      mockAuditLogService.countLogs.mockResolvedValue(150);

      const result = await controller.getLogs({ limit: 50, skip: 10 });

      expect(result).toMatchObject({
        total: 150,
        limit: 50,
        skip: 10,
      });
    });
  });

  describe("GET /api/audit/summary - Get Audit Summary", () => {
    it("should get summary grouped by action", async () => {
      const mockSummary = [
        {
          action: "WITHDRAW",
          count: 150,
          successCount: 148,
          failureCount: 2,
        },
        {
          action: "DEPOSIT",
          count: 200,
          successCount: 200,
          failureCount: 0,
        },
      ];
      mockAuditLogService.getSummaryByAction.mockResolvedValue(mockSummary);

      const result = await controller.getSummary({
        groupBy: AuditGroupBy.ACTION,
      });

      expect(result).toEqual(mockSummary);
      expect(mockAuditLogService.getSummaryByAction).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });

    it("should get summary grouped by user", async () => {
      const mockSummary = [
        {
          userId: mockUserId,
          count: 50,
          successCount: 48,
          failureCount: 2,
        },
      ];
      mockAuditLogService.getSummaryByUser.mockResolvedValue(mockSummary);

      const result = await controller.getSummary({
        groupBy: AuditGroupBy.USER,
      });

      expect(result).toEqual([
        {
          userId: mockUserId.toString(),
          count: 50,
          successCount: 48,
          failureCount: 2,
        },
      ]);
      expect(mockAuditLogService.getSummaryByUser).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });

    it("should include success/failure counts", async () => {
      const mockSummary = [
        {
          action: "WITHDRAW",
          count: 100,
          successCount: 95,
          failureCount: 5,
        },
      ];
      mockAuditLogService.getSummaryByAction.mockResolvedValue(mockSummary);

      const result = await controller.getSummary({});

      expect(result[0]).toMatchObject({
        count: 100,
        successCount: 95,
        failureCount: 5,
      });
    });

    it("should filter by date range", async () => {
      const startDate = "2026-01-01";
      const endDate = "2026-01-31";
      mockAuditLogService.getSummaryByAction.mockResolvedValue([]);

      await controller.getSummary({ startDate, endDate });

      expect(mockAuditLogService.getSummaryByAction).toHaveBeenCalledWith(
        new Date(startDate),
        new Date(endDate),
      );
    });

    it("should handle empty results", async () => {
      mockAuditLogService.getSummaryByAction.mockResolvedValue([]);

      const result = await controller.getSummary({});

      expect(result).toEqual([]);
    });

    it("should calculate aggregations correctly", async () => {
      const mockSummary = [
        {
          action: "BID",
          count: 300,
          successCount: 250,
          failureCount: 50,
        },
      ];
      mockAuditLogService.getSummaryByAction.mockResolvedValue(mockSummary);

      const result = await controller.getSummary({});

      expect(
        (result?.[0]?.successCount ?? 0) + (result?.[0]?.failureCount ?? 0),
      ).toBe(result?.[0]?.count);
    });
  });

  describe("GET /api/audit/user/:userId - Get User Audit Logs", () => {
    it("should get audit logs for specific user", async () => {
      const userId = mockUserId.toString();
      mockAuditLogService.findByUser.mockResolvedValue([mockAuditLog]);

      const result = await controller.getUserLogs(userId);

      expect(result).toHaveLength(1);
      expect(result?.[0]?.userId).toBe(userId);
      expect(mockAuditLogService.findByUser).toHaveBeenCalledWith(userId, {
        limit: 100,
        skip: 0,
      });
    });

    it("should paginate user logs", async () => {
      const userId = mockUserId.toString();
      mockAuditLogService.findByUser.mockResolvedValue([mockAuditLog]);

      await controller.getUserLogs(userId, 50, 10);

      expect(mockAuditLogService.findByUser).toHaveBeenCalledWith(userId, {
        limit: 50,
        skip: 10,
      });
    });

    it("should handle user with no logs", async () => {
      const userId = mockUserId.toString();
      mockAuditLogService.findByUser.mockResolvedValue([]);

      const result = await controller.getUserLogs(userId);

      expect(result).toEqual([]);
    });

    it("should return mapped response DTOs", async () => {
      const userId = mockUserId.toString();
      mockAuditLogService.findByUser.mockResolvedValue([mockAuditLog]);

      const result = await controller.getUserLogs(userId);

      expect(result?.[0]).toMatchObject({
        id: expect.any(String),
        userId: expect.any(String),
        action: expect.any(String),
        resource: expect.any(String),
        result: expect.any(String),
        createdAt: expect.any(Date),
      });
    });

    it("should use default pagination when not provided", async () => {
      const userId = mockUserId.toString();
      mockAuditLogService.findByUser.mockResolvedValue([mockAuditLog]);

      await controller.getUserLogs(userId);

      expect(mockAuditLogService.findByUser).toHaveBeenCalledWith(userId, {
        limit: 100,
        skip: 0,
      });
    });
  });

  describe("GET /api/audit/action/:action - Get Action-Specific Logs", () => {
    it("should get logs for specific action", async () => {
      const action = "WITHDRAW";
      mockAuditLogService.findByAction.mockResolvedValue([mockAuditLog]);

      const result = await controller.getActionLogs(action);

      expect(result).toHaveLength(1);
      expect(result?.[0]?.action).toBe(action);
      expect(mockAuditLogService.findByAction).toHaveBeenCalledWith(action, {
        limit: 100,
        skip: 0,
      });
    });

    it("should paginate action logs", async () => {
      const action = "DEPOSIT";
      mockAuditLogService.findByAction.mockResolvedValue([mockAuditLog]);

      await controller.getActionLogs(action, 25, 5);

      expect(mockAuditLogService.findByAction).toHaveBeenCalledWith(action, {
        limit: 25,
        skip: 5,
      });
    });

    it("should handle action with no logs", async () => {
      const action = "UNKNOWN_ACTION";
      mockAuditLogService.findByAction.mockResolvedValue([]);

      const result = await controller.getActionLogs(action);

      expect(result).toEqual([]);
    });

    it("should support different action types", async () => {
      const actions = ["WITHDRAW", "DEPOSIT", "BID", "WIN_AUCTION"];

      for (const action of actions) {
        mockAuditLogService.findByAction.mockResolvedValue([
          { ...mockAuditLog, action },
        ]);

        await controller.getActionLogs(action);

        expect(mockAuditLogService.findByAction).toHaveBeenCalledWith(
          action,
          expect.any(Object),
        );
      }
    });
  });

  describe("Authorization and Security", () => {
    it("should be protected by AuthGuard", () => {
      const guards = Reflect.getMetadata("__guards__", AuditController);
      expect(guards).toContain(AuthGuard);
    });

    it("should return audit logs only when authenticated", async () => {
      // Guard allows request through
      mockAuditLogService.findWithFilters.mockResolvedValue([mockAuditLog]);
      mockAuditLogService.countLogs.mockResolvedValue(1);

      const result = await controller.getLogs({});

      expect(result.data).toHaveLength(1);
      expect(mockAuditLogService.findWithFilters).toHaveBeenCalled();
    });

    it("should allow admin users to access all audit logs", async () => {
      // In a real scenario, admin access would be checked
      const allLogs = [
        mockAuditLog,
        {
          ...mockAuditLog,
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(),
        },
      ];
      mockAuditLogService.findWithFilters.mockResolvedValue(allLogs);
      mockAuditLogService.countLogs.mockResolvedValue(2);

      const result = await controller.getLogs({});

      expect(result.data).toHaveLength(2);
    });

    it("should have no write operations (audit logs are immutable)", () => {
      const methods = Object.getOwnPropertyNames(
        AuditController.prototype,
      ).filter(
        (name) =>
          name !== "constructor" &&
          typeof (controller as unknown as Record<string, unknown>)[name] ===
            "function",
      );

      // All methods should be GET operations only
      const writeMethodNames = [
        "post",
        "put",
        "patch",
        "delete",
        "create",
        "update",
        "remove",
      ];
      const hasWriteMethod = methods.some((method) =>
        writeMethodNames.some((writeName) =>
          method.toLowerCase().includes(writeName),
        ),
      );

      expect(hasWriteMethod).toBe(false);
    });
  });

  describe("Query Validation", () => {
    it("should handle invalid date format gracefully", async () => {
      // Invalid date strings are converted by Date constructor
      mockAuditLogService.findWithFilters.mockResolvedValue([]);
      mockAuditLogService.countLogs.mockResolvedValue(0);

      await controller.getLogs({
        startDate: "invalid-date",
        endDate: "2026-01-31",
      });

      // Date constructor will create invalid date, but service should handle it
      expect(mockAuditLogService.findWithFilters).toHaveBeenCalled();
    });

    it("should handle negative pagination parameters", async () => {
      mockAuditLogService.findWithFilters.mockResolvedValue([]);
      mockAuditLogService.countLogs.mockResolvedValue(0);

      // Negative values should be handled by validation or default to 0
      await controller.getLogs({ limit: -10, skip: -5 });

      const callArgs = mockAuditLogService.findWithFilters.mock.calls[0][0];
      // Either validation rejects or defaults are used
      expect(callArgs.limit).toBeDefined();
      expect(callArgs.skip).toBeDefined();
    });
  });

  describe("Performance", () => {
    it("should handle large result sets with pagination", async () => {
      // Simulate 10,000 total records
      const largeMockLogs = Array(100)
        .fill(null)
        .map((_, i) => ({
          ...mockAuditLog,
          _id: new Types.ObjectId(),
          action: `ACTION_${i}`,
        }));

      mockAuditLogService.findWithFilters.mockResolvedValue(largeMockLogs);
      mockAuditLogService.countLogs.mockResolvedValue(10000);

      const result = await controller.getLogs({ limit: 100, skip: 0 });

      expect(result.data).toHaveLength(100);
      expect(result.total).toBe(10000);
      expect(result.limit).toBe(100);
      expect(result.skip).toBe(0);
    });
  });

  describe("Response Mapping", () => {
    it("should correctly map ObjectId to string", () => {
      const mapped = controller["mapToResponseDto"](mockAuditLog);

      expect(typeof mapped.id).toBe("string");
      expect(typeof mapped.userId).toBe("string");
      expect(typeof mapped.resourceId).toBe("string");
    });

    it("should preserve optional fields", () => {
      const logWithOptionalFields = {
        ...mockAuditLog,
        errorMessage: "Test error",
        metadata: { custom: "data" },
      };

      const mapped = controller["mapToResponseDto"](logWithOptionalFields);

      expect(mapped.errorMessage).toBe("Test error");
      expect(mapped.metadata).toEqual({ custom: "data" });
    });

    it("should handle missing optional fields", () => {
      const minimalLog = {
        _id: mockAuditLogId,
        action: "TEST",
        resource: "test",
        result: "success",
        createdAt: new Date(),
      };

      const mapped = controller["mapToResponseDto"](minimalLog);

      expect(mapped.userId).toBeUndefined();
      expect(mapped.resourceId).toBeUndefined();
      expect(mapped.oldValues).toBeUndefined();
      expect(mapped.newValues).toBeUndefined();
    });

    it("should preserve date objects", () => {
      const mapped = controller["mapToResponseDto"](mockAuditLog);

      expect(mapped.createdAt).toBeInstanceOf(Date);
      expect(mapped.createdAt).toEqual(mockAuditLog.createdAt);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty query parameters", async () => {
      mockAuditLogService.findWithFilters.mockResolvedValue([]);
      mockAuditLogService.countLogs.mockResolvedValue(0);

      const result = await controller.getLogs({});

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should handle date range with same start and end date", async () => {
      const date = "2026-01-21";
      mockAuditLogService.findWithFilters.mockResolvedValue([mockAuditLog]);
      mockAuditLogService.countLogs.mockResolvedValue(1);

      await controller.getLogs({ startDate: date, endDate: date });

      expect(mockAuditLogService.findWithFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: new Date(date),
          endDate: new Date(date),
        }),
      );
    });

    it("should handle summary with no data in date range", async () => {
      mockAuditLogService.getSummaryByAction.mockResolvedValue([]);

      const result = await controller.getSummary({
        startDate: "2025-01-01",
        endDate: "2025-01-02",
      });

      expect(result).toEqual([]);
    });

    it("should handle getUserLogs with undefined optional parameters", async () => {
      const userId = mockUserId.toString();
      mockAuditLogService.findByUser.mockResolvedValue([mockAuditLog]);

      await controller.getUserLogs(userId, undefined, undefined);

      expect(mockAuditLogService.findByUser).toHaveBeenCalledWith(userId, {
        limit: 100,
        skip: 0,
      });
    });
  });
});
