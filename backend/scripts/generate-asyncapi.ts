/**
 * Generate AsyncAPI HTML documentation at build time
 * Run with: pnpm exec ts-node scripts/generate-asyncapi.ts
 */
import * as fs from "fs";
import * as path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Generator = require("@asyncapi/generator");
import * as yaml from "js-yaml";
import { getAllSchemas } from "../src/modules/events/asyncapi.schemas";

async function generateAsyncApiDocs() {
  console.log("Generating AsyncAPI documentation...");

  const asyncApiDocument = {
    asyncapi: "3.0.0",
    info: {
      title: "Gift Auction WebSocket API",
      version: "1.0.0",
      description:
        "Real-time WebSocket events for the auction system. Supports bidding (~3,000 rps × number of CPUs), countdown sync, and live auction updates.",
    },
    defaultContentType: "application/json",
    servers: {
      "auction-ws": {
        host: "{{ASYNCAPI_WS_HOST}}",
        protocol: "wss",
        description: "Auction WebSocket server (Socket.IO)",
      },
    },
    channels: {
      auth: {
        address: "auth",
        messages: {
          AuthPayload: { $ref: "#/components/messages/AuthPayload" },
        },
      },
      authenticated: {
        address: "authenticated",
        messages: {
          AuthResponse: { $ref: "#/components/messages/AuthResponse" },
        },
      },
      "join-auction": {
        address: "join-auction",
        messages: {
          AuctionIdPayload: { $ref: "#/components/messages/AuctionIdPayload" },
        },
      },
      "leave-auction": {
        address: "leave-auction",
        messages: {
          AuctionIdPayload: { $ref: "#/components/messages/AuctionIdPayload" },
        },
      },
      "auction-room": {
        address: "auction-room",
        messages: {
          AuctionRoomResponse: { $ref: "#/components/messages/AuctionRoomResponse" },
        },
      },
      "place-bid": {
        address: "place-bid",
        messages: {
          PlaceBidPayload: { $ref: "#/components/messages/PlaceBidPayload" },
        },
      },
      "bid-result": {
        address: "bid-result",
        messages: {
          BidResponse: { $ref: "#/components/messages/BidResponse" },
        },
      },
      "new-bid": {
        address: "new-bid",
        messages: {
          NewBidEvent: { $ref: "#/components/messages/NewBidEvent" },
        },
      },
      "auction-update": {
        address: "auction-update",
        messages: {
          AuctionUpdateEvent: { $ref: "#/components/messages/AuctionUpdateEvent" },
        },
      },
      countdown: {
        address: "countdown",
        messages: {
          CountdownEvent: { $ref: "#/components/messages/CountdownEvent" },
        },
      },
      "anti-sniping": {
        address: "anti-sniping",
        messages: {
          AntiSnipingEvent: { $ref: "#/components/messages/AntiSnipingEvent" },
        },
      },
      "round-start": {
        address: "round-start",
        messages: {
          RoundStartEvent: { $ref: "#/components/messages/RoundStartEvent" },
        },
      },
      "round-complete": {
        address: "round-complete",
        messages: {
          RoundCompleteEvent: { $ref: "#/components/messages/RoundCompleteEvent" },
        },
      },
      "auction-complete": {
        address: "auction-complete",
        messages: {
          AuctionCompleteEvent: { $ref: "#/components/messages/AuctionCompleteEvent" },
        },
      },
    },
    operations: {
      sendAuth: {
        action: "send",
        channel: { $ref: "#/channels/auth" },
        summary: "Authenticate with Telegram init data",
      },
      receiveAuthenticated: {
        action: "receive",
        channel: { $ref: "#/channels/authenticated" },
        summary: "Authentication result",
      },
      sendJoinAuction: {
        action: "send",
        channel: { $ref: "#/channels/join-auction" },
        summary: "Join an auction room",
      },
      sendLeaveAuction: {
        action: "send",
        channel: { $ref: "#/channels/leave-auction" },
        summary: "Leave an auction room",
      },
      receiveAuctionRoom: {
        action: "receive",
        channel: { $ref: "#/channels/auction-room" },
        summary: "Auction room state after joining",
      },
      sendPlaceBid: {
        action: "send",
        channel: { $ref: "#/channels/place-bid" },
        summary: "Place a bid on an auction",
      },
      receiveBidResult: {
        action: "receive",
        channel: { $ref: "#/channels/bid-result" },
        summary: "Result of bid placement",
      },
      receiveNewBid: {
        action: "receive",
        channel: { $ref: "#/channels/new-bid" },
        summary: "New bid placed by any user",
      },
      receiveAuctionUpdate: {
        action: "receive",
        channel: { $ref: "#/channels/auction-update" },
        summary: "Auction state update",
      },
      receiveCountdown: {
        action: "receive",
        channel: { $ref: "#/channels/countdown" },
        summary: "Countdown timer sync",
      },
      receiveAntiSniping: {
        action: "receive",
        channel: { $ref: "#/channels/anti-sniping" },
        summary: "Anti-sniping extension triggered",
      },
      receiveRoundStart: {
        action: "receive",
        channel: { $ref: "#/channels/round-start" },
        summary: "New auction round started",
      },
      receiveRoundComplete: {
        action: "receive",
        channel: { $ref: "#/channels/round-complete" },
        summary: "Auction round completed",
      },
      receiveAuctionComplete: {
        action: "receive",
        channel: { $ref: "#/channels/auction-complete" },
        summary: "Auction fully completed",
      },
    },
    components: {
      messages: {
        AuthPayload: {
          payload: { $ref: "#/components/schemas/AuthPayload" },
        },
        AuthResponse: {
          payload: { $ref: "#/components/schemas/AuthResponse" },
        },
        PlaceBidPayload: {
          payload: { $ref: "#/components/schemas/PlaceBidPayload" },
        },
        BidResponse: {
          payload: { $ref: "#/components/schemas/BidResponse" },
        },
        AuctionIdPayload: {
          payload: { $ref: "#/components/schemas/AuctionIdPayload" },
        },
        AuctionRoomResponse: {
          payload: { $ref: "#/components/schemas/AuctionRoomResponse" },
        },
        NewBidEvent: {
          payload: { $ref: "#/components/schemas/NewBidEvent" },
        },
        AuctionUpdateEvent: {
          payload: { $ref: "#/components/schemas/AuctionUpdateEvent" },
        },
        CountdownEvent: {
          payload: { $ref: "#/components/schemas/CountdownEvent" },
        },
        AntiSnipingEvent: {
          payload: { $ref: "#/components/schemas/AntiSnipingEvent" },
        },
        RoundStartEvent: {
          payload: { $ref: "#/components/schemas/RoundStartEvent" },
        },
        RoundCompleteEvent: {
          payload: { $ref: "#/components/schemas/RoundCompleteEvent" },
        },
        AuctionCompleteEvent: {
          payload: { $ref: "#/components/schemas/AuctionCompleteEvent" },
        },
      },
      schemas: getAllSchemas(),
    },
  };

  // Save YAML for reference
  const yamlContent = yaml.dump(asyncApiDocument);
  const yamlPath = path.join(__dirname, "..", "asyncapi.yaml");
  fs.writeFileSync(yamlPath, yamlContent);
  console.log(`AsyncAPI YAML saved to: ${yamlPath}`);

  // Generate HTML using @asyncapi/generator
  const tmpDir = path.join(__dirname, "..", ".asyncapi-tmp");
  const generator = new Generator("@asyncapi/html-template", tmpDir, {
    forceWrite: true,
    templateParams: { singleFile: true },
  });

  await generator.generateFromString(yamlContent, {
    resolve: { file: false },
  });

  // Read generated HTML and save to final location
  const htmlPath = path.join(tmpDir, "index.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const outputPath = path.join(__dirname, "..", "asyncapi.html");
  fs.writeFileSync(outputPath, html);
  console.log(`AsyncAPI HTML saved to: ${outputPath}`);

  // Cleanup temp directory
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log("AsyncAPI documentation generated successfully!");
}

generateAsyncApiDocs().catch((err) => {
  console.error("Failed to generate AsyncAPI docs:", err);
  process.exit(1);
});
