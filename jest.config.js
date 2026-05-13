module.exports = {
  testEnvironment: 'node',
  coverageProvider: 'v8',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup-globals.js'],
  collectCoverageFrom: [
    'shared/storage.js',
    'shared/constants.js',
    'content/modules/*.js',
    'content/observer.js',
    'background.js',
    'background.firefox.js',
  ],
};
