// ESLint flat config.
//
// `npm run lint` previously had no config to find, so it dropped into the
// interactive "How would you like to configure ESLint?" prompt and hung —
// which meant it never ran in CI or in a non-tty shell.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  // magic-teams/ holds unrelated cloned apps (Remix/Shopify, Vite, Turborepo
  // monorepos) that are not part of this project's build.
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "magic-teams/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // The db client is an intentional `any` at the export boundary (a union
      // of PrismaClient and the in-memory fallback) — see lib/db.ts. Warn so it
      // stays visible without failing the build.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default config;
