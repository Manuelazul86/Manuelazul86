import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      /*
       * `server-only` resolves to a module that throws outside the React
       * Server Component graph. Vitest is neither, so point it at the
       * package's own no-op build — the same file Next uses on the
       * server. This keeps the import guard real in the app while
       * letting the tests import server modules directly.
       */
      "server-only": new URL(
        "./node_modules/server-only/empty.js",
        import.meta.url,
      ).pathname,
    },
  },
});
