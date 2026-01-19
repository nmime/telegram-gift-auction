import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken, getConnectionToken } from "@nestjs/mongoose";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Types } from "mongoose";
import { AuctionsService } from "./auctions.service";
import { Auction, AuctionStatus, Bid, User } from "@/schemas";
import { UsersService } from "@/modules/users";
import { EventsGateway } from "@/modules/events";
import { NotificationsService } from "@/modules/notifications";
import { redlock, redisClient } from "@/modules/redis";

describe("AuctionsService", () => {
  let service: AuctionsService;

  const mockAuctionModel = {
    create: jest.fn(),
    find: jest.fn().mockReturnThis(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findOneAndUpdate: jest.fn(),
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };

  const mockBidModel = {
    create: jest.fn(),
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };

  const mockUserModel = {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
  };

  const mockSession = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn(),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  const mockUsersService = {
    recordTransaction: jest.fn(),
    findById: jest.fn(),
  };

  const mockEventsGateway = {
    emitAuctionUpdate: jest.fn(),
    emitNewBid: jest.fn(),
    emitAntiSniping: jest.fn(),
  };

  const mockNotificationsService = {
    notifyOutbid: jest.fn(),
  };

  const mockRedlock = {
    acquire: jest.fn().mockResolvedValue({ release: jest.fn() }),
  };

  const mockRedis = {
    exists: jest.fn().mockResolvedValue(0),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionsService,
        { provide: getModelToken(Auction.name), useValue: mockAuctionModel },
        { provide: getModelToken(Bid.name), useValue: mockBidModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getConnectionToken(), useValue: mockConnection },
        { provide: UsersService, useValue: mockUsersService },
        { provide: EventsGateway, useValue: mockEventsGateway },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: redlock, useValue: mockRedlock },
        { provide: redisClient, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<AuctionsService>(AuctionsService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("create", () => {
    it("should throw if round items do not sum to totalItems", async () => {
      const dto = {
        title: "Test Auction",
        totalItems: 10,
        rounds: [
          { itemsCount: 3, durationMinutes: 10 },
          { itemsCount: 5, durationMinutes: 10 },
        ],
      };

      await expect(
        service.create(dto, new Types.ObjectId().toString()),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw if totalItems is not positive", async () => {
      const dto = {
        title: "Test Auction",
        totalItems: 0,
        rounds: [],
      };

      await expect(
        service.create(dto, new Types.ObjectId().toString()),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw if any round has invalid items or duration", async () => {
      const dto = {
        title: "Test Auction",
        totalItems: 5,
        rounds: [
          { itemsCount: 0, durationMinutes: 10 },
          { itemsCount: 5, durationMinutes: 10 },
        ],
      };

      await expect(
        service.create(dto, new Types.ObjectId().toString()),
      ).rejects.toThrow(BadRequestException);
    });

    it("should create auction with valid data", async () => {
      const dto = {
        title: "Test Auction",
        totalItems: 10,
        rounds: [
          { itemsCount: 5, durationMinutes: 10 },
          { itemsCount: 5, durationMinutes: 10 },
        ],
      };
      const userId = new Types.ObjectId().toString();

      mockAuctionModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        ...dto,
      });

      const result = await service.create(dto, userId);
      expect(mockAuctionModel.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe("findById", () => {
    it("should throw BadRequestException for invalid ID", async () => {
      await expect(service.findById("invalid-id")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw NotFoundException if auction not found", async () => {
      mockAuctionModel.findById.mockResolvedValue(null);

      await expect(
        service.findById(new Types.ObjectId().toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return auction if found", async () => {
      const mockAuction = { _id: new Types.ObjectId(), title: "Test" };
      mockAuctionModel.findById.mockResolvedValue(mockAuction);

      const result = await service.findById(mockAuction._id.toString());
      expect(result).toEqual(mockAuction);
    });
  });

  describe("placeBid validation", () => {
    it("should throw BadRequestException for invalid auction ID", async () => {
      await expect(
        service.placeBid("invalid", new Types.ObjectId().toString(), {
          amount: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for invalid user ID", async () => {
      await expect(
        service.placeBid(new Types.ObjectId().toString(), "invalid", {
          amount: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for non-positive bid amount", async () => {
      await expect(
        service.placeBid(
          new Types.ObjectId().toString(),
          new Types.ObjectId().toString(),
          { amount: 0 },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for non-integer bid amount", async () => {
      await expect(
        service.placeBid(
          new Types.ObjectId().toString(),
          new Types.ObjectId().toString(),
          { amount: 100.5 },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("findAll", () => {
    it("should return all auctions when no status filter", async () => {
      const mockAuctions = [{ _id: new Types.ObjectId() }];
      mockAuctionModel.exec.mockResolvedValue(mockAuctions);

      const result = await service.findAll();
      expect(mockAuctionModel.find).toHaveBeenCalledWith({});
      expect(result).toEqual(mockAuctions);
    });

    it("should filter by status when provided", async () => {
      const mockAuctions = [
        { _id: new Types.ObjectId(), status: AuctionStatus.ACTIVE },
      ];
      mockAuctionModel.exec.mockResolvedValue(mockAuctions);

      const result = await service.findAll(AuctionStatus.ACTIVE);
      expect(mockAuctionModel.find).toHaveBeenCalledWith({
        status: AuctionStatus.ACTIVE,
      });
      expect(result).toEqual(mockAuctions);
    });
  });
});
