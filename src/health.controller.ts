import { Controller, Get } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

@Controller()
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  root() {
    return { name: "cyphers-api", status: "ok" };
  }

  @Get("health")
  async health() {
    let db = "down";
    try {
      await this.dataSource.query("SELECT 1");
      db = "up";
    } catch {
      db = "down";
    }
    return { status: "ok", db };
  }
}
