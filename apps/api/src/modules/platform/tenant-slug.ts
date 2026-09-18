/**
 * Deterministic server-side slug generation for self-service signup
 * (docs/IMPLEMENTATION_STATUS.md "Onboarding" section, architecture's own
 * `createTenantRequestSchema` slug shape: lowercase letters, digits,
 * hyphens only). The owner never types a slug — `SignupService` calls
 * `baseSlugFrom(name)` once, then retries `nextSlugCandidate` on a real
 * `tenant_slug_unique` collision (see signup.service.ts) rather than
 * guessing availability with a separate SELECT that could race.
 */
export function baseSlugFrom(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug.slice(0, 60) : 'restaurant';
}

export function nextSlugCandidate(baseSlug: string, attempt: number): string {
  return attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
}
