import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, Length, Matches, MaxLength } from 'class-validator';
import { eq } from 'drizzle-orm';
import { Ctx, Public } from '../../common/auth/decorators.js';
import type { RequestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { normalizeMobile, toAsciiDigits } from '../../common/util/normalize.js';
import { DbService } from '../../database/db.service.js';
import { users, type OtpPurpose } from '../../database/schema.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { OtpService } from './otp.service.js';
import { TokensService } from './tokens.service.js';

const OTP_PURPOSES: OtpPurpose[] = ['login', 'register', 'reset_password', 'verify_mobile'];

class OtpRequestBody {
  @IsString() @MaxLength(20) mobile: string;
  @IsIn(OTP_PURPOSES) purpose: OtpPurpose;
}

class OtpVerifyBody {
  @IsString() @MaxLength(20) mobile: string;
  @IsIn(['register', 'reset_password', 'verify_mobile']) purpose: Exclude<OtpPurpose, 'login'>;
  @IsString() @Length(6, 6) code: string;
}

class LoginBody {
  @IsString() @IsNotEmpty() @MaxLength(254) identifier: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password: string;
}

class OtpLoginBody {
  @IsString() @MaxLength(20) mobile: string;
  @IsString() @Length(6, 6) code: string;
}

class RefreshBody {
  @IsString() @Matches(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}$/) refreshToken: string;
}

class ResetBody {
  @IsString() @IsNotEmpty() proof: string;
  @IsString() @MaxLength(128) newPassword: string;
}

class SecondFactorBody {
  @IsString() @IsNotEmpty() mfaToken: string;
  /** 6-digit TOTP code or a recovery code (xxxx-xxxx) */
  @IsString() @Length(6, 12) code: string;
}

class TotpCodeBody {
  @IsString() @Length(6, 6) code: string;
}

class DisableTotpBody {
  @IsString() @IsNotEmpty() password: string;
  @IsString() @Length(6, 12) code: string;
}

class ChangePasswordBody {
  @IsString() @IsNotEmpty() currentPassword: string;
  @IsString() @MaxLength(128) newPassword: string;
}

const mobileOrFail = (raw: string) => {
  const m = normalizeMobile(raw);
  if (!m) throw new AppError('VALIDATION_FAILED', { field: 'mobile' });
  return m;
};

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    private readonly mfa: MfaService,
  ) {}

  /** Always answers the same shape, whether or not an account exists (AUTH-11). */
  @Public()
  @Post('otp/request')
  @HttpCode(202)
  requestOtp(@Body() body: OtpRequestBody, @Ctx() ctx: RequestContext) {
    return this.otp.request(mobileOrFail(body.mobile), body.purpose, ctx.ip, ctx.tenant?.id);
  }

  /** Exchanges a code for a short-lived proof of mobile ownership (used by registration/reset). */
  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body() body: OtpVerifyBody) {
    const mobile = mobileOrFail(body.mobile);
    await this.otp.verify(mobile, body.purpose, toAsciiDigits(body.code));
    const ttl = body.purpose === 'reset_password' ? 10 * 60 : 20 * 60;
    return { proof: this.tokens.signProof(mobile, body.purpose, ttl), expiresInSec: ttl };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginBody) {
    return this.auth.loginWithPassword(body.identifier, body.password);
  }

  @Public()
  @Post('login/otp')
  @HttpCode(200)
  loginOtp(@Body() body: OtpLoginBody) {
    return this.auth.loginWithOtp(body.mobile, toAsciiDigits(body.code));
  }

  @Public()
  @Post('login/2fa')
  @HttpCode(200)
  loginSecondFactor(@Body() body: SecondFactorBody) {
    return this.auth.loginWithSecondFactor(body.mfaToken, toAsciiDigits(body.code));
  }

  @ApiBearerAuth()
  @Get('2fa')
  mfaStatus(@Ctx() ctx: RequestContext) {
    return this.mfa.status(ctx.userId!);
  }

  @ApiBearerAuth()
  @Post('2fa/setup')
  @HttpCode(200)
  mfaSetup(@Ctx() ctx: RequestContext) {
    return this.mfa.setup(ctx.userId!);
  }

  @ApiBearerAuth()
  @Post('2fa/enable')
  @HttpCode(200)
  mfaEnable(@Body() body: TotpCodeBody, @Ctx() ctx: RequestContext) {
    return this.mfa.enable(ctx.userId!, toAsciiDigits(body.code));
  }

  @ApiBearerAuth()
  @Post('2fa/disable')
  @HttpCode(204)
  async mfaDisable(@Body() body: DisableTotpBody, @Ctx() ctx: RequestContext) {
    await this.mfa.disable(ctx.userId!, body.password, toAsciiDigits(body.code));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshBody) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() body: ResetBody) {
    await this.auth.resetPassword(body.proof, body.newPassword);
  }

  @ApiBearerAuth()
  @Post('password/change')
  @HttpCode(204)
  async changePassword(@Body() body: ChangePasswordBody, @Ctx() ctx: RequestContext) {
    await this.auth.changePassword(ctx.userId!, body.currentPassword, body.newPassword, ctx.sessionId);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@Ctx() ctx: RequestContext) {
    await this.auth.logout(ctx.sessionId!);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@Ctx() ctx: RequestContext) {
    return { revoked: await this.auth.logoutAll(ctx.userId!) };
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@Ctx() ctx: RequestContext) {
    return this.auth.listSessions(ctx.userId!, ctx.sessionId);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    await this.auth.revokeOwnSession(ctx.userId!, id);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('v1/me')
export class MeController {
  constructor(private readonly db: DbService) {}

  @Get()
  async me(@Ctx() ctx: RequestContext) {
    const [u] = await this.db.run((tx) =>
      tx
        .select({ id: users.id, fullName: users.fullName, mobile: users.mobile, email: users.email, kind: users.kind })
        .from(users)
        .where(eq(users.id, ctx.userId!)),
    );
    return { ...u, isPlatformAdmin: !!ctx.isPlatformAdmin };
  }
}
