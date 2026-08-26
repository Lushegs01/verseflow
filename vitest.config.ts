import { defineConfig } from "vitest/config";
import path from "node:path";

const SQLITE_SHIM = "\0verseflow:node-sqlite";

export default defineConfig({
  plugins: [
    {
      /**
       * Vite does not recognise `node:sqlite` (Node 22.5+) as a builtin, so it
       * tries to resolve it from disk and fails. Marking it external is not
       * enough either, because the vitest module runner still attempts to load
       * it.
       *
       * Instead, resolve it to a tiny virtual module that pulls the real builtin
       * in through `createRequire` at runtime. Confined to the test config --
       * application code keeps a plain static import, which webpack externalizes
       * via `next.config.ts`.
       */
      name: "verseflow-node-sqlite",
      enforce: "pre",
      resolveId(id) {
        if (id === "node:sqlite" || id === "sqlite") return SQLITE_SHIM;
        return null;
      },
      load(id) {
        if (id !== SQLITE_SHIM) return null;
        return [
          `import { createRequire } from "node:module";`,
          `const require_ = createRequire(process.cwd() + "/package.json");`,
          `const sqlite = require_("node:sqlite");`,
          `export const DatabaseSync = sqlite.DatabaseSync;`,
          `export default sqlite;`,
        ].join("\n");
      },
    },
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    pool: "forks",
  },
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
});
