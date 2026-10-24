import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController, MeController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';
import { TokensService } from './tokens.service.js';

@Module({
  imports: [JwtModule.register({})],
  providers: [TokensService, OtpService, AuthService],
  controllers: [AuthController, MeController],
  exports: [TokensService, AuthService, JwtModule],
})
export class IdentityModule {}
