import type { z } from 'zod'
import { badRequest } from './errors.js'

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw badRequest(issue?.message ?? 'Please check the details you entered.', result.error.issues)
  }
  return result.data
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}
