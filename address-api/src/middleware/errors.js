import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Wrap async route handlers so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(_req, _res, next) {
  next(new ApiError(404, 'NOT_FOUND', 'Route not found'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: 'Invalid request', details: err.flatten() },
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  // Postgres unique violation
  if (err.code === '23505') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Record already exists', details: err.detail },
    });
  }

  console.error('[error]', err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
