import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Schichten (siehe docs/ARCHITECTURE.md):
 *   app/        Next.js-Routing – verdrahtet frontend/ und backend/
 *   frontend/   React-Oberfläche – vom Backend nur Typen
 *   backend/    Server: DB, Integrationen, Jobs, Speicher
 *   validation/ zod-Schemas (API-Verträge, KI-Outputs, Formulare)
 *   domain/     reine Berechnungen – kein I/O, kein Framework (darf zod-Schemas nutzen)
 */
const msg = (layer, target) => `${layer} darf ${target} nicht importieren.`;

const DB_LIBS = {
  paths: [
    { name: "better-sqlite3", message: "SQLite-Zugriff gehört nach src/backend/db/." },
    { name: "drizzle-orm", message: "Drizzle-Zugriff gehört nach src/backend/db/." },
  ],
  patterns: [{ group: ["drizzle-orm/*"], message: "Drizzle-Zugriff gehört nach src/backend/db/." }],
};

function layerRule(layer, { forbid = [], typesOnly = [], db = false, extraPaths = [] }) {
  const patterns = [
    ...forbid.map((group) => ({ group: [group], message: msg(layer, group) })),
    ...typesOnly.map((group) => ({
      group: [group],
      allowTypeImports: true,
      message: `${msg(layer, group)} Erlaubt sind nur \`import type\`.`,
    })),
    ...(db ? [] : DB_LIBS.patterns),
  ];
  return {
    "no-restricted-imports": "off",
    "@typescript-eslint/no-restricted-imports": [
      "error",
      { paths: [...(db ? [] : DB_LIBS.paths), ...extraPaths], patterns },
    ],
  };
}

const NO_IO_GLOBALS = ["fetch", "localStorage", "sessionStorage", "indexedDB"].map((name) => ({
  name,
  message: "Kein Netzwerk-/Speicherzugriff in dieser Schicht.",
}));

const GEMINI_LITERAL = "Gemini-Modell nicht hartcodieren: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL (gemini-transport.ts).";
const NO_HARDCODED_MODEL = [
  { selector: "Literal[value=/^gemini-\\d/]", message: GEMINI_LITERAL },
  { selector: "TemplateElement[value.raw=/^gemini-\\d/]", message: GEMINI_LITERAL },
];
const LOCAL_ONLY = [
  { selector: "ExpressionStatement[directive='use server']", message: "Rein lokale Oberfläche: keine Server Actions." },
  {
    selector: "CallExpression[callee.object.name='router'][callee.property.name=/^(push|refresh)$/]",
    message: "Rein lokale Oberfläche: keine Router-Mutationen.",
  },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "drizzle/**", "data/**", "coverage/**"]),
  {
    files: ["src/app/**/*.{ts,tsx}", "src/instrumentation.ts"],
    rules: layerRule("app/", {}),
  },
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    rules: layerRule("frontend/", {
      forbid: ["@/app/*"],
      typesOnly: ["@/backend/*"],
      extraPaths: [
        { name: "node:fs", message: msg("frontend/", "node:fs") },
        { name: "next/server", message: msg("frontend/", "next/server") },
      ],
    }),
  },
  {
    files: ["src/backend/**/*.ts"],
    rules: layerRule("backend/", { forbid: ["@/app/*", "@/frontend/*", "react", "react-dom"] }),
  },
  {
    files: ["src/backend/db/**/*.ts"],
    rules: layerRule("backend/db/", { forbid: ["@/app/*", "@/frontend/*", "react", "react-dom"], db: true }),
  },
  {
    files: ["src/validation/**/*.ts"],
    rules: layerRule("validation/", {
      forbid: ["@/app/*", "@/frontend/*", "@/backend/*", "react", "react-dom", "next", "next/*"],
    }),
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      ...layerRule("domain/", {
        forbid: ["@/app/*", "@/frontend/*", "@/backend/*", "react", "react-dom", "next", "next/*"],
        extraPaths: ["fs", "node:fs", "fs/promises", "node:fs/promises"].map((name) => ({
          name,
          message: "Die Domäne macht kein Dateisystem-I/O.",
        })),
      }),
      "no-restricted-globals": ["error", ...NO_IO_GLOBALS],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/backend/integrations/gemini-transport.ts"],
    rules: { "no-restricted-syntax": ["error", ...NO_HARDCODED_MODEL] },
  },
  {
    // Planung und Berater-Bericht rechnen rein lokal: kein Netzwerk, kein
    // Browser-Speicher, keine Server Actions (einzige Ausnahme: Fragen-Check).
    files: [
      "src/frontend/planung/{free-money-panel,loan-comparison-table,salary-panel,planung-workspace}.tsx",
      "src/frontend/planung/{planning-*,property-vs-etf-*,recommendation-text}.{ts,tsx}",
      "src/frontend/vertraege/{loan-adjustment-simulator,payment-split-section}.tsx",
      "src/frontend/charts/**/*.{ts,tsx}",
      "src/frontend/bericht/**/*.{ts,tsx}",
    ],
    ignores: ["src/frontend/bericht/use-advisor-question-check.ts"],
    rules: {
      "no-restricted-globals": ["error", ...NO_IO_GLOBALS],
      "no-restricted-syntax": ["error", ...NO_HARDCODED_MODEL, ...LOCAL_ONLY],
    },
  },
]);
