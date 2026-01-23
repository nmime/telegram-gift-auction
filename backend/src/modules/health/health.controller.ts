import { Controller, Get } from "@nestjs/common";

interface IHealthResponse {
  status: "ok";
  timestamp: string;
}

@Controller("health")
export class HealthController {
  @Get()
  check(): IHealthResponse {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
