import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { PlatformAdmin, RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService } from '../../database/db.service.js';
import { calendarHolidays } from '../../database/schema.js';
import { AuditService } from '../audit/audit.service.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class HolidayBody {
  @Matches(DAY) day: string;
  @IsString() @IsNotEmpty() @MaxLength(120) title: string;
}

class RangeQuery {
  @IsOptional() @Matches(DAY) from?: string;
  @IsOptional() @Matches(DAY) to?: string;
}

const validDay = (d: string) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
const fields = { id: calendarHolidays.id, day: calendarHolidays.day, title: calendarHolidays.title, tenantId: calendarHolidays.tenantId };

/** University closures on top of the national list (WF-20). */
@ApiTags('admin: calendar')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin/holidays')
export class HolidaysController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** National and university holidays in a range; `national: true` rows are read-only here. */
  @Get()
  async list(@Query() q: RangeQuery) {
    const tenantId = requestContext.get().tenant!.id;
    const rows = await this.db.run((tx) =>
      tx
        .select(fields)
        .from(calendarHolidays)
        .where(
          and(
            or(isNull(calendarHolidays.tenantId), eq(calendarHolidays.tenantId, tenantId)),
            q.from ? gte(calendarHolidays.day, q.from) : undefined,
            q.to ? lte(calendarHolidays.day, q.to) : undefined,
          ),
        )
        .orderBy(asc(calendarHolidays.day)),
    );
    return rows.map(({ tenantId: t, ...r }) => ({ ...r, national: t === null }));
  }

  @RequirePermission('tenant.settings.edit')
  @Post()
  async add(@Body() body: HolidayBody) {
    if (!validDay(body.day)) throw new AppError('VALIDATION_FAILED', { field: 'day' });
    const ctx = requestContext.get();
    const [row] = await this.db.run((tx) =>
      tx.insert(calendarHolidays).values({ tenantId: ctx.tenant!.id, ...body, createdBy: ctx.userId }).onConflictDoNothing().returning(fields),
    );
    if (!row) throw new AppError('CONFLICT', { field: 'day' });
    await this.audit.record({ action: 'calendar.holiday.added', targetType: 'holiday', targetId: row.id, after: body });
    return { ...row, national: false };
  }

  @RequirePermission('tenant.settings.edit')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.db.run((tx) => tx.delete(calendarHolidays).where(eq(calendarHolidays.id, id)).returning(fields));
    if (!row) throw new AppError('NOT_FOUND');
    await this.audit.record({ action: 'calendar.holiday.removed', targetType: 'holiday', targetId: id, before: { day: row.day, title: row.title } });
  }
}

/** Official national holidays shared by every tenant (platform admins). */
@ApiTags('platform: calendar')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('v1/platform/holidays')
export class PlatformHolidaysController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() q: RangeQuery) {
    return this.db.sys
      .select(fields)
      .from(calendarHolidays)
      .where(and(isNull(calendarHolidays.tenantId), q.from ? gte(calendarHolidays.day, q.from) : undefined, q.to ? lte(calendarHolidays.day, q.to) : undefined))
      .orderBy(asc(calendarHolidays.day));
  }

  @Post()
  async add(@Body() body: HolidayBody) {
    if (!validDay(body.day)) throw new AppError('VALIDATION_FAILED', { field: 'day' });
    const [row] = await this.db.sys
      .insert(calendarHolidays)
      .values({ tenantId: null, ...body, createdBy: requestContext.get().userId })
      .onConflictDoNothing()
      .returning(fields);
    if (!row) throw new AppError('CONFLICT', { field: 'day' });
    await this.audit.record({ action: 'calendar.national_holiday.added', tenantId: null, targetType: 'holiday', targetId: row.id, after: body });
    return row;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.db.sys.delete(calendarHolidays).where(and(eq(calendarHolidays.id, id), isNull(calendarHolidays.tenantId))).returning(fields);
    if (!row) throw new AppError('NOT_FOUND');
    await this.audit.record({ action: 'calendar.national_holiday.removed', tenantId: null, targetType: 'holiday', targetId: id, before: { day: row.day, title: row.title } });
  }
}
