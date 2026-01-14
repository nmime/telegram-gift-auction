import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { BidsService } from "./bids.service";
import { Bid } from "@/schemas";

describe("BidsService", () => {
  let service: BidsService;

  const mockBidModel = {
    find: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn(),
    countDocuments: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidsService,
        {
          provide: getModelToken(Bid.name),
          useValue: mockBidModel,
        },
      ],
    }).compile();

    service = module.get<BidsService>(BidsService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getByAuction", () => {
    it("should return bids sorted by amount descending", async () => {
      const mockBids = [
        { amount: 200, userId: "user1" },
        { amount: 100, userId: "user2" },
      ];
      mockBidModel.exec.mockResolvedValue(mockBids);

      const result = await service.getByAuction("507f1f77bcf86cd799439011");

      expect(mockBidModel.find).toHaveBeenCalled();
      expect(mockBidModel.sort).toHaveBeenCalledWith({
        amount: -1,
        createdAt: 1,
      });
      expect(result).toEqual(mockBids);
    });
  });

  describe("countByAuction", () => {
    it("should return active bid count", async () => {
      mockBidModel.countDocuments.mockResolvedValue(5);

      const result = await service.countByAuction("507f1f77bcf86cd799439011");

      expect(result).toBe(5);
    });
  });
});
