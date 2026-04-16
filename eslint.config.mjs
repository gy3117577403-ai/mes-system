import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    // 舊版參考源碼，不參與 ESLint
    "_legacy_code/**",
    // Electron 入口與 Node 腳本（非 Next 編譯目標）
    "main.js",
    "scripts/**",
  ]),
]);

export default eslintConfig;
