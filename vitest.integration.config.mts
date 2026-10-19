import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Runs against the linked Supabase dev project. Never point this at production:
// it creates and deletes throwaway users.
try {
  process.loadEnvFile(".env");
} catch {
  // Fall back to variables already present in the environment (e.g. CI secrets).
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
