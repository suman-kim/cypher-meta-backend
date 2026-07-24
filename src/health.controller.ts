/**
 * health.controller.ts
 *
 * 서비스 상태 점검용 컨트롤러. 루트 경로와 헬스체크 경로를 제공하며,
 * 헬스체크에서는 DB 연결 여부까지 확인한다.
 */
import { Controller, Get } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

/** 서비스/DB 상태를 반환하는 헬스체크 컨트롤러 */
@Controller()
export class HealthController {
  /**
   * @param dataSource — DB 연결 확인용 TypeORM DataSource(의존성 주입)
   */
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 서비스 기본 정보를 반환한다.
   *
   * HTTP: GET /api
   * @returns { name, status } 서비스 이름과 상태
   */
  @Get()
  root() {
    return { name: "cyphers-api", status: "ok" };
  }

  /**
   * 헬스체크. DB에 SELECT 1 을 실행해 연결 상태를 함께 반환한다.
   *
   * HTTP: GET /api/health
   * @returns { status, db } 서비스 상태와 DB 상태("up" | "down")
   */
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
