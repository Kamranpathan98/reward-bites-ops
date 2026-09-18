import { hashPassword, verifyPassword } from './password';

describe('password hashing (Argon2id)', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('a-real-password-123');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'a-real-password-123')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('a-real-password-123');
    await expect(verifyPassword(hash, 'the-wrong-password')).resolves.toBe(false);
  });

  it('produces a different hash for the same password each time (random salt)', async () => {
    const hashA = await hashPassword('same-password');
    const hashB = await hashPassword('same-password');
    expect(hashA).not.toBe(hashB);
  });
});
