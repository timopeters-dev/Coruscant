import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "drizzle/**", "data/**", "coverage/**"]),
  {
    // DB-Libs nur in src/db/ (Tests ausgenommen). Der Domain-Block unten
    // überschreibt diese Regel für src/lib/domain/ mit der strengeren Fassung.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/db/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "better-sqlite3",
              message: "SQLite-Zugriff gehört nach src/db/.",
            },
            {
              name: "drizzle-orm",
              message: "Drizzle-Zugriff gehört nach src/db/.",
            },
          ],
          patterns: [
            {
              group: ["drizzle-orm/*"],
              message: "Drizzle-Zugriff gehört nach src/db/.",
            },
          ],
        },
      ],
    },
  },
  {
    // KI-Modellnamen nie hartcodieren: nur die Defaults in gemini-transport.ts.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/integrations/gemini-transport.ts",
      "**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^gemini-\\d/]",
          message:
            "Gemini-Modell nicht hartcodieren: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL (gemini-transport.ts).",
        },
        {
          selector: "TemplateElement[value.raw=/^gemini-\\d/]",
          message:
            "Gemini-Modell nicht hartcodieren: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL (gemini-transport.ts).",
        },
      ],
    },
  },
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
              name: "@/db",
              message:
                "Domain layer (src/lib/domain/) must stay isolated from the DB layer.",
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
