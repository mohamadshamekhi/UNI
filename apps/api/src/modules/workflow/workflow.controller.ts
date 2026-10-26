import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { PageQuery, ReasonBody } from '../../common/http/dto.js';
import type { CaseStatusCategory } from '../../database/schema.js';
import { AclService } from '../acl/acl.service.js';
import { CasesService } from './cases.service.js';
import { WorkflowEngine } from './engine.service.js';
import { WorkflowsService } from './workflows.service.js';

const REQUEST_TYPE = /^[a-z][a-z0-9_]{1,40}$/;
const CATEGORIES: CaseStatusCategory[] = ['open', 'revising', 'success', 'failure', 'cancelled'];

class CreateWorkflowBody {
  @Matches(/^[a-z][a-z0-9_-]{1,60}$/) key: string;
  @IsString() @IsNotEmpty() @MaxLength(120) nameFa: string;
  @Matches(REQUEST_TYPE) requestType: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

class TemplateBody extends CreateWorkflowBody {}

class CopyBody {
  @Matches(/^[a-z][a-z0-9_-]{1,60}$/) key: string;
  @IsString() @IsNotEmpty() @MaxLength(120) nameFa: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) unitIds: string[];
}

class VersionBody {
  @IsOptional() @IsObject() definition?: Record<string, unknown>;
  @IsOptional() @IsObject() selector?: Record<string, unknown>;
}

class SimStepDto {
  @Matches(/^[a-z][a-z0-9_]{1,30}$/) action: string;
  @IsOptional() @IsObject() form?: Record<string, unknown>;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
}

class SimulateBody {
  @IsOptional() @IsObject() data?: Record<string, unknown>;
  @IsOptional() @IsUUID() unitId?: string;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SimStepDto) script: SimStepDto[];
}

class CreateCaseBody {
  @Matches(REQUEST_TYPE) requestType: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
  /** THS-01: save without submitting */
  @IsOptional() @IsBoolean() draft?: boolean;
}

class DraftBody {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
}

class RevisionDto {
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) fields?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(90) deadlineDays?: number;
}

class EligibleQuery {
  @Matches(REQUEST_TYPE) requestType: string;
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/) field: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsString() @MaxLength(40) degree?: string;
}

class StepEligibleQuery {
  @Matches(/^[a-z][a-z0-9-]{1,40}$/) step: string;
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/) field: string;
}

class ActBody {
  @Matches(/^[a-z][a-z0-9_]{1,30}$/) action: string;
  @IsOptional() @IsObject() form?: Record<string, unknown>;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(2000) publicNote?: string;
  @IsOptional() @IsString() @MaxLength(2000) internalNote?: string;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
  @IsOptional() @ValidateNested() @Type(() => RevisionDto) revision?: RevisionDto;
}

class ReassignBody extends ReasonBody {
  @IsUUID() membershipId: string;
}

class ExtendBody extends ReasonBody {
  @Type(() => Number) @IsInt() @Min(1) @Max(60) days: number;
}

class CaseListQuery extends PageQuery {
  @IsOptional() @IsIn(CATEGORIES) statusCategory?: CaseStatusCategory;
  @IsOptional() @Matches(REQUEST_TYPE) requestType?: string;
}

@ApiTags('admin: workflows')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin')
export class WorkflowAdminController {
  constructor(private readonly workflows: WorkflowsService) {}

  @RequirePermission('workflow.define')
  @Get('workflows')
  list() {
    return this.workflows.list();
  }

  @RequirePermission('workflow.define')
  @Post('workflows')
  create(@Body() body: CreateWorkflowBody) {
    return this.workflows.create(body);
  }

  @RequirePermission('workflow.define')
  @Get('workflow-templates')
  templates() {
    return this.workflows.templates();
  }

  @RequirePermission('workflow.define')
  @Post('workflow-templates/:key/instantiate')
  fromTemplate(@Param('key') key: string, @Body() body: TemplateBody) {
    return this.workflows.fromTemplate(key, body);
  }

  @RequirePermission('workflow.define')
  @Post('workflows/:id/copy')
  copy(@Param('id', ParseUUIDPipe) id: string, @Body() body: CopyBody) {
    return this.workflows.copy(id, body);
  }

  @RequirePermission('workflow.define')
  @Get('workflows/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.get(id);
  }

  @RequirePermission('workflow.define')
  @Post('workflows/:id/versions')
  newVersion(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionBody) {
    return this.workflows.newVersion(id, body);
  }

  @RequirePermission('workflow.define')
  @Get('workflow-versions/:id')
  version(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.getVersion(id);
  }

  @RequirePermission('workflow.define')
  @Patch('workflow-versions/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionBody) {
    return this.workflows.updateVersion(id, body);
  }

  @RequirePermission('workflow.define')
  @Post('workflow-versions/:id/validate')
  @HttpCode(200)
  validate(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.validate(id);
  }

  @RequirePermission('workflow.define')
  @Post('workflow-versions/:id/simulate')
  @HttpCode(200)
  simulate(@Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateBody) {
    return this.workflows.simulate(id, body);
  }

  @RequirePermission('workflow.define')
  @Get('workflow-versions/:id/impact')
  impact(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.impact(id);
  }

  @RequirePermission('workflow.publish')
  @Post('workflow-versions/:id/publish')
  @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.publish(id);
  }

  @RequirePermission('workflow.publish')
  @Post('workflow-versions/:id/retire')
  @HttpCode(200)
  retire(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    return this.workflows.retire(id, body.reason);
  }
}

@ApiTags('cases')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1')
export class CasesController {
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly cases: CasesService,
    private readonly acl: AclService,
    private readonly workflows: WorkflowsService,
  ) {}

  @Get('cases/request-types')
  requestTypes() {
    return this.workflows.requestTypes();
  }

  @Get('cases/eligible-members')
  eligible(@Query() q: EligibleQuery) {
    return this.engine.eligibleForRequest(q.requestType, q.field, q.unitId, q.degree);
  }

  @Post('cases')
  async create(@Body() body: CreateCaseBody) {
    await this.acl.assert('case.create', { unitId: body.unitId ?? null });
    const c = await this.engine.start(body);
    return this.cases.get(c.id);
  }

  @Get('cases/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.cases.get(id);
  }

  @Patch('cases/:id/draft')
  async updateDraft(@Param('id', ParseUUIDPipe) id: string, @Body() body: DraftBody) {
    await this.engine.updateDraft(id, body);
    return this.cases.get(id);
  }

  @Post('cases/:id/submit')
  @HttpCode(200)
  async submit(@Param('id', ParseUUIDPipe) id: string) {
    await this.engine.submit(id);
    return this.cases.get(id);
  }

  @Post('cases/:id/withdraw')
  @HttpCode(200)
  async withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    await this.engine.withdraw(id, body.reason);
    return this.cases.get(id);
  }

  @Get('cases/:id/eligible-members')
  stepEligible(@Param('id', ParseUUIDPipe) id: string, @Query() q: StepEligibleQuery) {
    return this.engine.eligibleForStep(id, q.step, q.field);
  }

  @Post('cases/:id/tasks/:taskId/actions')
  @HttpCode(200)
  async act(@Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: ActBody) {
    await this.engine.act(id, taskId, body);
    return this.cases.get(id);
  }

  @Post('cases/:id/tasks/:taskId/reassign')
  @HttpCode(200)
  reassign(@Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: ReassignBody) {
    return this.cases.reassign(id, taskId, body.membershipId, body.reason);
  }

  @Post('cases/:id/tasks/:taskId/extend')
  @HttpCode(200)
  extend(@Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: ExtendBody) {
    return this.cases.extend(id, taskId, body.days, body.reason);
  }

  @Get('me/cases')
  mine(@Query() q: PageQuery) {
    return this.cases.mine(q.limit, q.offset);
  }

  @Get('me/tasks')
  tasks() {
    return this.cases.myTasks();
  }

  @RequirePermission('case.view.scope')
  @Get('admin/cases')
  list(@Query() q: CaseListQuery) {
    return this.cases.list(q);
  }
}
