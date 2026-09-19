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

    it('ignores unknown fields on the (non-strict) response schema', () => {
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

    describe('upiId rules (trim, max 100, no control characters, no invented VPA grammar)', () => {
      const parse = (upiId: unknown) =>
        patchOrganizationPaymentSettingsRequestSchema.safeParse({ upiId });

      it('trims surrounding whitespace', () => {
        const r = parse('  shop@upi  ');
        expect(r.success && r.data.upiId).toBe('shop@upi');
      });

      it('turns a whitespace-only value into an empty string (the service maps it to "missing")', () => {
        const r = parse('   ');
        expect(r.success && r.data.upiId).toBe('');
      });

      it('accepts exactly 100 characters, and 100 characters plus surrounding whitespace', () => {
        expect(parse('a'.repeat(100)).success).toBe(true);
        const padded = parse(`  ${'a'.repeat(100)}  `);
        expect(padded.success && padded.data.upiId).toBe('a'.repeat(100));
      });

      it('rejects 101 characters', () => {
        expect(parse('a'.repeat(101)).success).toBe(false);
      });

      it.each([
        ['NUL', 'shop\u0000@upi'],
        ['newline', 'shop\n@upi'],
        ['tab', 'shop\t@upi'],
        ['DEL', 'shop\u007f@upi'],
      ])('rejects a control character (%s)', (_name, value) => {
        expect(parse(value).success).toBe(false);
      });

      it.each([123, true, {}, [], ['a@b']])(
        'rejects a non-string, non-null value (%j)',
        (value) => {
          expect(parse(value).success).toBe(false);
        },
      );

      it('does not impose a VPA grammar: unusual but printable strings pass through', () => {
        for (const v of [
          'no-at-sign',
          'a@b@c',
          '<script>alert(1)</script>',
          "x'; DROP TABLE t; --",
        ]) {
          const r = parse(v);
          expect(r.success && r.data.upiId).toBe(v);
        }
      });
    });
  });
});
