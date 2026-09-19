import { describe, expect, it } from 'vitest';
import {
  organizationPaymentSettingsResponseSchema,
  patchOrganizationPaymentSettingsRequestSchema,
} from './organization-settings';

describe('organization-settings contracts', () => {
  describe('organizationPaymentSettingsResponseSchema', () => {
    it('accepts a valid payment settings object', () => {
      const result = organizationPaymentSettingsResponseSchema.safeParse({
        cashEnabled: true,
        upiEnabled: false,
        upiId: null,
        upiReferenceRequired: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts UPI enabled with a valid ID', () => {
      const result = organizationPaymentSettingsResponseSchema.safeParse({
        cashEnabled: true,
        upiEnabled: true,
        upiId: 'restaurant@hdfc',
        upiReferenceRequired: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects unknown fields', () => {
      const result = organizationPaymentSettingsResponseSchema.safeParse({
        cashEnabled: true,
        upiEnabled: false,
        upiId: null,
        upiReferenceRequired: true,
        unknownField: 'should-not-exist',
      });
      expect(result.success).toBe(true); // Zod ignores by default unless strict()
    });

    it('rejects non-boolean values', () => {
      const result = organizationPaymentSettingsResponseSchema.safeParse({
        cashEnabled: 'yes',
        upiEnabled: false,
        upiId: null,
        upiReferenceRequired: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('patchOrganizationPaymentSettingsRequestSchema', () => {
    it('accepts an empty object', () => {
      const result = patchOrganizationPaymentSettingsRequestSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts partial updates', () => {
      const result = patchOrganizationPaymentSettingsRequestSchema.safeParse({
        upiEnabled: true,
        upiId: 'restaurant@hdfc',
      });
      expect(result.success).toBe(true);
    });

    it('accepts all fields', () => {
      const result = patchOrganizationPaymentSettingsRequestSchema.safeParse({
        cashEnabled: false,
        upiEnabled: true,
        upiId: 'restaurant@hdfc',
        upiReferenceRequired: false,
      });
      expect(result.success).toBe(true);
    });

    it('rejects unknown fields (strict mode)', () => {
      const result = patchOrganizationPaymentSettingsRequestSchema.safeParse({
        cashEnabled: true,
        unknownField: 'should-not-exist',
      });
      expect(result.success).toBe(false);
    });

    it('accepts null upiId', () => {
      const result = patchOrganizationPaymentSettingsRequestSchema.safeParse({
        upiId: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty string upiId (normalized by service)', () => {
      const result = patchOrganizationPaymentSettingsRequestSchema.safeParse({
        upiId: '',
      });
      expect(result.success).toBe(true);
    });
  });
});
