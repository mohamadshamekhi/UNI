import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { Public, TenantScoped } from '../../common/auth/decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import { PageQuery } from '../../common/http/dto.js';
import type { PaymentStatus } from '../../database/schema.js';
import { SandboxGateway, type SandboxOutcome } from './gateway.js';
import { PaymentsService } from './payments.service.js';

const STATUSES: PaymentStatus[] = ['created', 'pending', 'succeeded', 'failed', 'cancelled', 'review', 'refunded'];

class VerifyBody {
  @IsString() @IsNotEmpty() @MaxLength(200) authority: string;
}

class FeeBody {
  @Matches(/^[a-z0-9_.:-]{2,80}$/) serviceKey: string;
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @Type(() => Number) @IsInt() @Min(1000) @Max(100_000_000_000) amount: number;
  @IsOptional() @IsDateString() effectiveFrom?: string;
}

class GatewayBody {
  @IsString() @MaxLength(40) adapter: string;
  @IsOptional() @IsString() @MaxLength(200) merchantId?: string;
  @IsOptional() @IsString() @MaxLength(500) secret?: string;
  @IsBoolean() active: boolean;
}

class ReviewBody {
  @IsIn(['succeeded', 'failed']) outcome: 'succeeded' | 'failed';
  @IsString() @IsNotEmpty() @MaxLength(1000) reason: string;
}

class ListQuery extends PageQuery {
  @IsOptional() @IsIn(STATUSES) status?: PaymentStatus;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

class DayQuery {
  @IsDateString() day: string;
}

/** Payer side: own requests, bank attempts, return from the bank, receipt. */
@ApiTags('payments')
@ApiBearerAuth()
@TenantScoped({ membership: 'any' })
@Controller('v1')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('me/payments')
  mine() {
    return this.payments.mine();
  }

  @Get('payments/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(id);
  }

  @Post('payments/:id/start')
  @HttpCode(200)
  start(@Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key?: string) {
    if (key && !/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new AppError('VALIDATION_FAILED', { field: 'Idempotency-Key' });
    return this.payments.start(id, key);
  }

  @Post('payments/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.cancel(id);
  }

  @Get('payments/:id/receipt')
  receipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.receipt(id);
  }

  /** Return from the bank: no session needed — the server verifies with the gateway (PAY-05). */
  @Public()
  @Post('payments/:id/verify')
  @HttpCode(200)
  verify(@Param('id', ParseUUIDPipe) id: string, @Body() body: VerifyBody) {
    return this.payments.verifyReturn(id, body.authority);
  }
}

/** Finance staff: requests, review decisions, tariffs, gateway settings, reconciliation. */
@ApiTags('payments')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin')
export class PaymentsAdminController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  list(@Query() q: ListQuery) {
    return this.payments.list(q);
  }

  @Get('payments/reconciliation')
  reconciliation(@Query() q: DayQuery) {
    return this.payments.dailyReconciliation(new Date(q.day));
  }

  @Get('payments/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(id);
  }

  @Post('payments/:id/review')
  @HttpCode(200)
  review(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewBody) {
    return this.payments.decideReview(id, body.outcome, body.reason);
  }

  @Get('fees')
  fees() {
    return this.payments.fees();
  }

  @Post('fees')
  setFee(@Body() body: FeeBody) {
    return this.payments.setFee(body);
  }

  @Get('payment-gateway')
  gateway() {
    return this.payments.gatewayConfig();
  }

  @Put('payment-gateway')
  setGateway(@Body() body: GatewayBody) {
    return this.payments.setGatewayConfig(body);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n);

/** Development-only simulated bank (sandbox adapter). Disabled in production. */
@ApiTags('payments')
@Public()
@Controller('v1/payment-sandbox')
export class SandboxBankController {
  constructor(private readonly sandbox: SandboxGateway) {}

  @Get(':authority')
  async page(@Param('authority') authority: string, @Res() res: Response) {
    const s = this.sandbox.enabled && /^SBX[0-9A-F]{24}$/.test(authority) ? await this.sandbox.state(authority) : null;
    if (!s) throw new AppError('NOT_FOUND');
    const link = (o: SandboxOutcome, label: string, color: string) =>
      `<a href="/v1/payment-sandbox/${authority}/decide?outcome=${o}" style="display:block;padding:14px;margin-top:10px;border-radius:12px;background:${color};color:#fff;text-decoration:none;font-weight:700">${label}</a>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>درگاه آزمایشی</title></head>
<body style="font-family:Tahoma,sans-serif;background:#f1f5f9;margin:0;padding:24px">
<main style="max-width:420px;margin:40px auto;background:#fff;border-radius:20px;padding:24px;text-align:center;box-shadow:0 10px 30px rgba(15,23,42,.08)">
<p style="color:#b45309;font-size:13px;margin:0">فقط برای آزمایش — پولی جابه‌جا نمی‌شود</p>
<h1 style="font-size:20px">درگاه پرداخت آزمایشی</h1>
<p style="color:#475569">${esc(s.description)}</p>
<p style="font-size:24px;font-weight:800">${fa(s.amount)} ریال</p>
${s.outcome ? '<p>این تراکنش قبلاً پاسخ گرفته است.</p>' : link('success', 'پرداخت موفق', '#15803d') + link('fail', 'رد توسط بانک', '#b91c1c') + link('cancel', 'انصراف', '#475569') + link('hang', 'بدون پاسخ (قطع ارتباط)', '#92400e')}
</main></body></html>`);
  }

  @Get(':authority/decide')
  async decide(@Param('authority') authority: string, @Query('outcome') outcome: string, @Res() res: Response) {
    if (!this.sandbox.enabled || !['success', 'fail', 'cancel', 'hang'].includes(outcome)) throw new AppError('NOT_FOUND');
    const s = await this.sandbox.decide(authority, outcome as SandboxOutcome);
    if (!s) throw new AppError('NOT_FOUND');
    if (outcome === 'hang') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><body style="font-family:Tahoma;padding:40px;text-align:center">ارتباط با بانک قطع شد. نتیجه با مطابقت خودکار مشخص می‌شود.</body></html>');
      return;
    }
    res.redirect(303, `${s.callbackUrl}?authority=${authority}&status=${outcome === 'success' ? 'OK' : 'NOK'}`);
  }
}
