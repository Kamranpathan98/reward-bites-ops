import { z } from 'zod';

/**
 * Organization payment settings. V1 exposes only payment configuration.
 *
 * Business rules (locked):
 * - At least one payment method must be enabled.
 * - If UPI is enabled, upiId must be non-empty after trimming.
 * - UPI ID is preserved even when UPI is disabled, allowing re-enable without re-entry.
 * - Settings affect future payments only; do NOT snapshot into bills.
 * - No optimistic concurrency in V1; last-writer-wins.
 */

export const organizationPaymentSettingsResponseSchema = z.object({
  cashEnabled: z.boolean().describe('Accept cash payments at the counter'),
  upiEnabled: z.boolean().describe('Accept payments via UPI'),
  upiId: z
    .string()
    .nullable()
    .describe('UPI/VPA ID (e.g., restaurant@hdfc). Preserved when UPI is disabled.'),
  upiReferenceRequired: z
    .boolean()
    .describe('Require UTR (Unique Transaction Reference) for UPI payments'),
});

export type OrganizationPaymentSettings = z.infer<typeof organizationPaymentSettingsResponseSchema>;

export const organizationSettingsResponseSchema = z.object({
  data: organizationPaymentSettingsResponseSchema,
});

export type OrganizationSettingsResponse = z.infer<typeof organizationSettingsResponseSchema>;

/**
 * PATCH semantics: all fields optional.
 * Business rules applied to FINAL merged state, not just submitted fields.
 */
export const patchOrganizationPaymentSettingsRequestSchema = z
  .object({
    cashEnabled: z.boolean().optional(),
    upiEnabled: z.boolean().optional(),
    upiId: z.string().nullable().optional(),
    upiReferenceRequired: z.boolean().optional(),
  })
  .strict()
  .describe(
    'Partial update of organization payment settings. Validation applied to final merged state.',
  );

export type PatchOrganizationPaymentSettingsRequest = z.infer<
  typeof patchOrganizationPaymentSettingsRequestSchema
>;
