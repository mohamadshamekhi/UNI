import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { requestContext } from '../context/request-context.js';
import { AppError, ErrorCodes, type ErrorCode } from './app-error.js';

const httpToCode: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'FILE_TOO_LARGE',
};

/** Uniform error body: { error: { code, message, details? }, requestId } */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = requestContext.find()?.requestId;
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'INTERNAL';
    let message: string = ErrorCodes.INTERNAL[1];
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppError) {
      ({ status, code, message, details } = exception);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = httpToCode[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
      message = ErrorCodes[code][1];
      const body = exception.getResponse();
      if (code === 'VALIDATION_FAILED' && typeof body === 'object' && body && 'message' in body) {
        details = { fields: (body as { message: unknown }).message };
      }
    } else {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }

    if (res.headersSent) return;
    res.status(status).json({ error: { code, message, ...(details ? { details } : {}) }, requestId });
  }
}
