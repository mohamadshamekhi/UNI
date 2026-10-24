import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';

export async function createApp(): Promise<INestApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);
  app.use(helmet());
  app.useBodyParser('json', { limit: '1mb' });
  const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins, credentials: true, allowedHeaders: ['authorization', 'content-type', 'x-tenant', 'x-request-id', 'x-mobile-proof'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Uni platform API')
      .setVersion('v1')
      .addBearerAuth()
      .addGlobalParameters({ name: 'X-Tenant', in: 'header', required: false, description: 'Tenant slug (or use the tenant host)' })
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config), { jsonDocumentUrl: 'docs/openapi.json' });
  }
  return app;
}
