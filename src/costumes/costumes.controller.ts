/**
 * costumes.controller.ts
 * ------------------------------------------------------------------
 * 코스튬 카탈로그 + 피드백 HTTP 컨트롤러. 전역 prefix("api") → /api/costumes/*.
 *
 *  카탈로그:
 *   - GET    /costumes                  목록(공개, character/year 필터)
 *   - GET    /costumes/facets           필터용 패싯(공개)
 *   - POST   /costumes/import           일괄 가져오기(관리자)
 *   - DELETE /costumes/:id              코스튬 삭제(관리자)
 *
 *  피드백(시세/수정요청):
 *   - GET    /costumes/:id/feedback         조회(공개)
 *   - POST   /costumes/:id/feedback         작성(공개, 익명)
 *   - DELETE /costumes/feedback/:fid        삭제(본인 비번 또는 관리자)
 *   - POST   /costumes/feedback/:fid/resolve 상태 변경(관리자)
 * ------------------------------------------------------------------
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CostumesService } from "./costumes.service";
import { AdminGuard } from "../analytics/admin.guard";
import {
  CreateFeedbackDto,
  DeleteFeedbackDto,
  ImportCostumesDto,
  ResolveFeedbackDto,
} from "./dto";

/** 코스튬 관련 라우트. 베이스 경로: /api/costumes */
@Controller("costumes")
export class CostumesController {
  constructor(private readonly svc: CostumesService) {}

  /* ---------------- 카탈로그 ---------------- */

  /** 코스튬 목록 조회(공개). GET /api/costumes?character=&year= */
  @Get()
  list(@Query("character") character?: string, @Query("year") year?: string) {
    return this.svc.list({
      character: character || undefined,
      year: year ? Number(year) : undefined,
    });
  }

  /** 필터 UI 용 패싯 조회(공개). GET /api/costumes/facets */
  @Get("facets")
  facets() {
    return this.svc.facets();
  }

  /** 코스튬 일괄 가져오기(관리자). POST /api/costumes/import */
  @UseGuards(AdminGuard)
  @Post("import")
  import(@Body() dto: ImportCostumesDto) {
    return this.svc.importRows(dto.rows ?? [], dto.mode ?? "upsert");
  }

  /* ---------------- 피드백 ---------------- */

  /** 코스튬 피드백 조회(공개). GET /api/costumes/:id/feedback */
  @Get(":id/feedback")
  listFeedback(@Param("id") id: string) {
    return this.svc.listFeedback(Number(id));
  }

  /** 코스튬 피드백 작성(공개, 익명). POST /api/costumes/:id/feedback */
  @Post(":id/feedback")
  createFeedback(@Param("id") id: string, @Body() dto: CreateFeedbackDto) {
    return this.svc.createFeedback(Number(id), dto);
  }

  /** 피드백 삭제(본인 비번 또는 관리자). DELETE /api/costumes/feedback/:fid */
  @Delete("feedback/:fid")
  deleteFeedback(
    @Param("fid") fid: string,
    @Body() body: DeleteFeedbackDto,
    @Headers("x-admin-token") adminToken?: string,
  ) {
    return this.svc.deleteFeedback(Number(fid), body?.password, adminToken);
  }

  /** 수정 요청 상태 변경(관리자). POST /api/costumes/feedback/:fid/resolve */
  @UseGuards(AdminGuard)
  @Post("feedback/:fid/resolve")
  resolveFeedback(@Param("fid") fid: string, @Body() body: ResolveFeedbackDto) {
    return this.svc.resolveFeedback(Number(fid), body?.status);
  }

  /* ---------------- 카탈로그 삭제(파라미터 라우트라 마지막) ---------------- */

  /** 코스튬 1건 삭제(관리자). DELETE /api/costumes/:id */
  @UseGuards(AdminGuard)
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.svc.remove(Number(id));
  }
}
