import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/decorators.js';
import { DbService } from '../../database/db.service.js';
import { RedisService } from '../../infra/redis.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async health() {
    const [db, redis] = await Promise.allSettled([this.db.sys.execute(sql`select 1`), this.redis.client.ping()]);
    return { status: db.status === 'fulfilled' && redis.status === 'fulfilled' ? 'ok' : 'degraded', db: db.status, redis: redis.status };
  }
}
