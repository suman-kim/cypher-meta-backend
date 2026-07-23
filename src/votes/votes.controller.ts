import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { VotesService } from "./votes.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

@Controller("votes")
export class VotesController {
  constructor(private readonly votes: VotesService) {}

  @Post("tier")
  saveTier(@Body() body: any) {
    return this.votes.saveTier(body?.visitorId, body?.picks);
  }

  @Get("tier")
  getTier() {
    return this.votes.getTier();
  }

  @Get("tier/mine")
  tierMine(@Query("visitorId") visitorId: string) {
    return this.votes.getTierMine(visitorId);
  }

  @Post("comp")
  saveComp(@Body() body: any) {
    return this.votes.saveComp(body?.visitorId, body?.formationKey, body?.ids);
  }

  @Get("comp")
  getComp() {
    return this.votes.getComp();
  }

  @Get("comp/mine")
  compMine(@Query("visitorId") visitorId: string) {
    return this.votes.getCompMine(visitorId);
  }
}
