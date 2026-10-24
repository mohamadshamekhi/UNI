import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { maskMobile } from '../common/util/normalize.js';

export interface SmsMessage {
  to: string;
  text: string;
  /** Tenant whose line / quota is used (NTF-11, NTF-14). */
  tenantId?: string | null;
}

/** Adapter contract (NTF-14): swap providers without touching callers. */
export abstract class SmsProvider {
  abstract send(msg: SmsMessage): Promise<{ providerMessageId?: string }>;
}

/** Development: logs the message (masked recipient) instead of sending. */
@Injectable()
export class ConsoleSmsProvider extends SmsProvider {
  private readonly logger = new Logger('SMS');
  async send(msg: SmsMessage) {
    this.logger.log(`to=${maskMobile(msg.to)} text=${msg.text}`);
    return {};
  }
}

/** Tests: keeps messages in memory so specs can read OTP codes. */
@Injectable()
export class MemorySmsProvider extends SmsProvider {
  readonly sent: SmsMessage[] = [];
  async send(msg: SmsMessage) {
    this.sent.push(msg);
    return {};
  }
  lastTo(to: string) {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}

@Global()
@Module({
  providers: [
    ConsoleSmsProvider,
    MemorySmsProvider,
    {
      provide: SmsProvider,
      inject: [ENV, ConsoleSmsProvider, MemorySmsProvider],
      useFactory: (env: Env, c: ConsoleSmsProvider, m: MemorySmsProvider) => (env.SMS_PROVIDER === 'memory' ? m : c),
    },
  ],
  exports: [SmsProvider, MemorySmsProvider],
})
export class SmsModule {}

