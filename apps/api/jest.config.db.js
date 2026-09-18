/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  preset: 'ts-jest',
  // A glob, not a regex: `testRegex` with a literal '/test/db/' never
  // matches on Windows, where Jest resolves paths with backslashes —
  // discovered by actually running this suite on Windows for the first
  // time (every prior session had no database to run it against at all).
  // `testMatch` globs are normalised cross-platform internally.
  testMatch: ['<rootDir>/test/db/**/*.(spec|test).ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
};
