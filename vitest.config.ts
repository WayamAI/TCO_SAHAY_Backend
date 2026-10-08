import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests share one Postgres database; running files in
    // parallel races beforeEach() truncation against concurrent requests.
    fileParallelism: false,
  },
});
