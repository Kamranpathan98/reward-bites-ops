import { baseSlugFrom, nextSlugCandidate } from './tenant-slug';

describe('baseSlugFrom', () => {
  it('lowercases and hyphenates a normal restaurant name', () => {
    expect(baseSlugFrom('Restaurant Name')).toBe('restaurant-name');
  });

  it('is deterministic for the same input', () => {
    expect(baseSlugFrom('Restaurant Name')).toBe(baseSlugFrom('Restaurant Name'));
  });

  it('strips punctuation and collapses whitespace', () => {
    expect(baseSlugFrom("Ada's  Café  & Grill!!")).toBe('ada-s-cafe-grill');
  });

  it('never produces leading/trailing hyphens', () => {
    expect(baseSlugFrom('---Weird Name---')).toBe('weird-name');
  });

  it('falls back to a safe default for a name with no ASCII letters/digits', () => {
    expect(baseSlugFrom('!!!')).toBe('restaurant');
  });

  it('caps length so it never produces an unreasonably long slug', () => {
    const long = 'a'.repeat(200);
    expect(baseSlugFrom(long).length).toBeLessThanOrEqual(60);
  });
});

describe('nextSlugCandidate', () => {
  it('attempt 0 is the base slug itself, unmodified', () => {
    expect(nextSlugCandidate('restaurant-name', 0)).toBe('restaurant-name');
  });

  it('later attempts append a deterministic numeric suffix', () => {
    expect(nextSlugCandidate('restaurant-name', 1)).toBe('restaurant-name-2');
    expect(nextSlugCandidate('restaurant-name', 2)).toBe('restaurant-name-3');
  });
});
