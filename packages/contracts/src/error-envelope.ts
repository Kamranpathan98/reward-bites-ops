import { z } from 'zod';

/**
 * Field-level validation error, used inside `error.details` for
 * `VALIDATION_FAILED` (400) responses.
 *
 * Shape locked by the V1 Architecture, section 14 ("Error Handling, Audit
 * Architecture and Concurrency Strategy").
 */
export const fieldErrorSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

/**
 * The single error shape every API error response uses, per the V1
 * Architecture: `{ error: { code, message, details?, requestId, retryable } }`.
 *
 * `details` carries either field errors (validation failures) or the
 * current entity (conflicts) — both are legitimate per the architecture,
 * so it is intentionally left as an open record when it isn't field errors.
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.union([z.array(fieldErrorSchema), z.record(z.string(), z.unknown())]).optional(),
    requestId: z.string().min(1),
    retryable: z.boolean(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
