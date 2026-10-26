import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { PageQuery, ReasonBody } from '../../common/http/dto.js';
import type { ThesisStatus } from '../../database/schema.js';
import { CasesService } from '../workflow/cases.service.js';
import { ThesisService } from './thesis.service.js';

class ThesisQuery extends PageQuery {
  @IsOptional() @IsIn(ThesisService.STATUSES) status?: ThesisStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

class AdvisorBody extends ReasonBody {
  @IsUUID() membershipId: string;
}

@ApiTags('thesis')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1')
export class ThesisController {
  constructor(
    private readonly theses: ThesisService,
    private readonly cases: CasesService,
  ) {}

  /** «پرونده تحصیلی» of the signed-in student. */
  @Get('me/theses')
  mine() {
    return this.theses.mine();
  }

  /** Theses the caller supervises or reviews. */
  @Get('me/supervisions')
  supervisions() {
    return this.theses.supervisions();
  }

  /** The thesis record of a case, for anyone who may see that case. */
  @Get('cases/:id/thesis')
  async ofCase(@Param('id', ParseUUIDPipe) id: string) {
    await this.cases.get(id);
    return this.theses.byCase(id);
  }

  @RequirePermission('case.view.scope')
  @Get('admin/theses')
  list(@Query() q: ThesisQuery) {
    return this.theses.list(q);
  }

  @Post('cases/:id/advisor')
  @HttpCode(200)
  changeAdvisor(@Param('id', ParseUUIDPipe) id: string, @Body() body: AdvisorBody) {
    return this.theses.changeAdvisor(id, body.membershipId, body.reason);
  }
}
