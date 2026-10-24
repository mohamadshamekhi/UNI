import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Public, RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ReasonBody } from '../../common/http/dto.js';
import { UnitsService } from './units.service.js';

class UnitTypeBody {
  @Matches(/^[a-z0-9_]{2,40}$/) key: string;
  @IsString() @IsNotEmpty() @MaxLength(100) nameFa: string;
  @IsOptional() @IsString() @MaxLength(100) nameEn?: string;
  @IsOptional() @IsBoolean() isFacultyLevel?: boolean;
}

class UnitBody {
  @IsOptional() @IsUUID() parentId?: string;
  @IsUUID() typeId: string;
  @IsString() @IsNotEmpty() @MaxLength(200) nameFa: string;
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
}

class UnitPatchBody {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) nameFa?: string;
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
}

class MoveBody extends ReasonBody {
  @IsOptional() @IsUUID() parentId?: string;
}

class TreeQuery {
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() includeArchived?: boolean;
}

@ApiTags('admin: units')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin')
export class UnitsAdminController {
  constructor(private readonly units: UnitsService) {}

  @Get('unit-types')
  types() {
    return this.units.listTypes();
  }

  @RequirePermission('unit.manage')
  @Post('unit-types')
  createType(@Body() body: UnitTypeBody) {
    return this.units.createType(body);
  }

  @Get('units')
  tree(@Query() q: TreeQuery) {
    return this.units.tree({ includeArchived: q.includeArchived });
  }

  @RequirePermission('unit.manage')
  @Post('units')
  create(@Body() body: UnitBody) {
    return this.units.create(body);
  }

  @RequirePermission('unit.manage')
  @Patch('units/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UnitPatchBody) {
    return this.units.update(id, body);
  }

  @RequirePermission('unit.manage')
  @Post('units/:id/move')
  @HttpCode(200)
  move(@Param('id', ParseUUIDPipe) id: string, @Body() body: MoveBody) {
    return this.units.move(id, body.parentId ?? null, body.reason);
  }

  @RequirePermission('unit.manage')
  @Post('units/:id/archive')
  @HttpCode(204)
  async archive(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    await this.units.archive(id, body.reason);
  }
}

@ApiTags('public')
@Controller('v1/public')
export class UnitsPublicController {
  constructor(private readonly units: UnitsService) {}

  /** Active unit tree for the registration form (faculty → department → field). */
  @Public()
  @TenantScoped({ membership: 'any' })
  @Get('units')
  async tree() {
    const strip = (nodes: Awaited<ReturnType<UnitsService['tree']>>): unknown[] =>
      nodes.map((n) => ({ id: n.id, nameFa: n.nameFa, nameEn: n.nameEn, typeId: n.typeId, children: strip(n.children) }));
    return strip(await this.units.tree());
  }

  @Public()
  @TenantScoped({ membership: 'any' })
  @Get('unit-types')
  types() {
    return this.units.listTypes();
  }
}
