import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { TenantScoped } from '../../common/auth/decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import { isReportKey, ReportsService } from './reports.service.js';

class FilterQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsString() @MaxLength(60) requestType?: string;
}

class ExportQuery extends FilterQuery {
  @IsIn(['csv', 'xlsx']) format: 'csv' | 'xlsx';
}

@ApiTags('reports')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list() {
    return this.reports.list();
  }

  @Get('summary')
  summary() {
    return this.reports.summary();
  }

  @Get(':key')
  run(@Param('key') key: string, @Query() q: FilterQuery) {
    if (!isReportKey(key)) throw new AppError('NOT_FOUND');
    return this.reports.run(key, q);
  }

  @Get(':key/export')
  async export(@Param('key') key: string, @Query() q: ExportQuery, @Res() res: Response) {
    if (!isReportKey(key)) throw new AppError('NOT_FOUND');
    const { format, ...filter } = q;
    const out = await this.reports.export(key, filter, format);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(out.body);
  }
}
