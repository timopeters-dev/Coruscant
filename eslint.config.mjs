import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "drizzle/**", "data/**", "coverage/**"]),
  {
    files: ["src/lib/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message: "Domain layer must not import React.",
            },
            {
              name: "react-dom",
              message: "Domain layer must not import React DOM.",
            },
            {
              name: "better-sqlite3",
              message: "Domain layer must not import SQLite.",
            },
            {
              name: "drizzle-orm",
              message: "Domain layer must not import Drizzle ORM.",
            },
            {
              name: "node:fs",
              message: "Domain layer must not perform filesystem I/O.",
            },
            {
              name: "fs",
              message: "Domain layer must not perform filesystem I/O.",
            },
          ],
          patterns: [
            {
              group: ["next", "next/*", "drizzle-orm/*", "@/db/*"],
              message:
                "Domain layer (src/lib/domain/) must stay isolated from Next.js and DB layers.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
