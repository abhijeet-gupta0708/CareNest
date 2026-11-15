import type { Request } from 'express'

/**
 * Express 5 types route parameters as `string | string[]`. CareNest routes only
 * ever define single-value parameters, so normalise them in one place.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name]
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}
