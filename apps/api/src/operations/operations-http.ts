import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';

const errorCodes: Record<number, string> = {
  400: 'invalid_input',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  503: 'service_unavailable',
};

@Catch(HttpException)
export class OperationsErrorFilter implements ExceptionFilter<HttpException> {
  catch(error: HttpException, host: ArgumentsHost) {
    const status = error.getStatus();
    const response = host.switchToHttp().getResponse();
    const payload = error.getResponse();
    if (typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string') {
      response.status(status).json(payload);
      return;
    }
    response.status(status).json({ code: errorCodes[status] ?? 'request_failed', message: error.message });
  }
}

export function requireIdempotencyKey(key?: string): string {
  if (!key || !/^[!-+\x2D-~]{1,128}$/.test(key)) {
    throw new BadRequestException('A single Idempotency-Key of 1–128 visible ASCII characters is required');
  }
  return key;
}
