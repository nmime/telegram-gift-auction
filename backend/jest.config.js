const path = require('path');

module.exports = {
  rootDir: path.resolve(__dirname),
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
  ],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  collectCoverage: false,
  testTimeout: 300000,
  maxWorkers: process.env.CI ? 2 : '50%',
  testPathIgnorePatterns: process.env.SKIP_INTEGRATION_TESTS ? ['/integration/'] : [],
};
