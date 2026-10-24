import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from '../context/request-context.js';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,80}$/;

@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // pino-http may already have assigned req.id (same rules), keep log lines and context aligned
    const fromLogger = (req as Request & { id?: unknown }).id;
    const incoming = typeof fromLogger === 'string' ? fromLogger : req.header('x-request-id');
    const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', requestId);
    requestContext.run({ requestId, ip: req.ip, userAgent: req.header('user-agent') }, () => next());
  }
}
