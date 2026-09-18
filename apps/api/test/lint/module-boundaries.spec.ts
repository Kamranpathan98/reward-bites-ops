/**
 * Proves the module-boundary `no-restricted-imports` mechanism (root
 * eslint.config.cjs, Implementation Blueprint section 4) actually fails
 * lint on a forbidden cross-module import, and does not false-positive on
 * a permitted one. Runs the real ESLint `Linter` against in-memory
 * fixtures — no source file on disk ever contains the violation.
 *
 * Uses `Linter.verify()` with the config array required directly from
 * eslint.config.cjs, rather than `ESLint.lintText()` with
 * `overrideConfigFile`: ESLint's config-file loader always resolves flat
 * configs via a dynamic `import()` internally, which Jest cannot satisfy
 * without --experimental-vm-modules. Requiring the same config module and
 * feeding it to `Linter` directly exercises the exact same rule set
 * without going through that file-loading machinery.
 */
import path from 'node:path';
import { Linter, type Linter as LinterTypes } from 'eslint';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const flatConfig: LinterTypes.Config[] = require(path.join(repoRoot, 'eslint.config.cjs'));

const linter = new Linter({ configType: 'flat' });

function lint(relativeFilePath: string, code: string) {
  // Flat-config `files` globs (e.g. `apps/api/src/modules/menu/**/*.ts`) are
  // matched against the filename as given — the low-level `Linter` class,
  // unlike the `ESLint` class, does no cwd-relative resolution. Passing the
  // repo-root-relative path (not an absolute one) is what makes the glob
  // patterns in eslint.config.cjs actually match.
  return linter.verify(code, flatConfig, { filename: relativeFilePath });
}

describe('module boundary lint rule (no-restricted-imports)', () => {
  it('flags menu importing from orders (forbidden: menu must not know an order exists)', () => {
    const messages = lint(
      'apps/api/src/modules/menu/__fixture_violation__.ts',
      `import { OrdersService } from '../orders/orders.service';\nexport const x = OrdersService;\n`,
    );

    expect(messages.find((m) => m.ruleId === 'no-restricted-imports')).toBeDefined();
  });

  it('flags payments importing from orders directly (forbidden: payments only touches a bill)', () => {
    const messages = lint(
      'apps/api/src/modules/payments/__fixture_violation__.ts',
      `import { OrdersRepository } from '../orders/orders.repository';\nexport const x = OrdersRepository;\n`,
    );

    expect(messages.find((m) => m.ruleId === 'no-restricted-imports')).toBeDefined();
  });

  it('flags any non-platform module importing from platform', () => {
    const messages = lint(
      'apps/api/src/modules/expenses/__fixture_violation__.ts',
      `import { PlatformService } from '../platform/platform.service';\nexport const x = PlatformService;\n`,
    );

    expect(messages.find((m) => m.ruleId === 'no-restricted-imports')).toBeDefined();
  });

  it('flags a module importing `pg` directly instead of going through common/db', () => {
    const messages = lint(
      'apps/api/src/modules/expenses/__fixture_violation__.ts',
      `import { Pool } from 'pg';\nexport const x = Pool;\n`,
    );

    expect(messages.find((m) => m.ruleId === 'no-restricted-imports')).toBeDefined();
  });

  it('does not flag menu importing from tenancy (a permitted upstream dependency)', () => {
    const messages = lint(
      'apps/api/src/modules/menu/__fixture_ok__.ts',
      `import { TenancyService } from '../tenancy/tenancy.service';\nexport const x = TenancyService;\n`,
    );

    expect(messages.find((m) => m.ruleId === 'no-restricted-imports')).toBeUndefined();
  });
});
