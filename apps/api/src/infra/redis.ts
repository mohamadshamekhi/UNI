import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { AppError } from '../common/errors/app-error.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  /**
   * Fixed-window counter. Throws RATE_LIMITED when `limit` is exceeded within `windowSec`.
   */
  async hit(key: string, limit: number, windowSec: number): Promise<void> {
    const k = `rl:${key}`;
    const [[, count]] = (await this.client.multi().incr(k).expire(k, windowSec, 'NX').exec()) as [[null, number]];
    if (count > limit) {
      const ttl = await this.client.ttl(k);
      throw new AppError('RATE_LIMITED', { retryAfterSec: Math.max(ttl, 1) });
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
