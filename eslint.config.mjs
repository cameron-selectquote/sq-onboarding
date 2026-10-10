// ESLint 9 flat config. eslint-config-next 15 still ships legacy configs, so
// bridge them with FlatCompat.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  { ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts", "mockups/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
