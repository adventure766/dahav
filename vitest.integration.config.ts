import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
