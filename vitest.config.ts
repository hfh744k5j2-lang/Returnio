import { defineConfig } from "vitest/config";
import path from "path";
import { loadTestEnv } from "./tests/load-env";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    env: { ...loadTestEnv(), EMAIL_DEV_OUTBOX: "1", EMAIL_SILENT: "1" },
    globalSetup: ["tests/unit/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
