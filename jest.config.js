module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleNameMapper: {
    '^client/lazy-app/util/(.*)$': '<rootDir>/src/client/lazy-app/util/$1',
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
};
