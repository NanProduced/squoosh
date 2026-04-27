module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        target: 'ES2020',
        module: 'CommonJS',
        moduleResolution: 'node',
        esModuleInterop: true,
      },
    }],
  },
};
