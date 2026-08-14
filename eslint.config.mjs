import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // A missing import is invisible until a teacher taps the thing. `payCents`
  // was exported from lib/hours/rates.js but never imported into HoursApp, so
  // the Ad-hoc / OT pay preview threw at render time and took the whole Work
  // hours page down — the build and the default Next lint both stayed green.
  // no-undef is what catches that before it ships.
  {
    files: ["**/*.{js,mjs,jsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.serviceworker },
    },
    rules: { "no-undef": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
