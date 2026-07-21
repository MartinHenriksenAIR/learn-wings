import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import i18next from "eslint-plugin-i18next";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist", ".claude"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Legacy Lovable-era codebase carries ~1500 `any`s; keep them visible as
      // warnings without failing the lint gate. New code should still type properly.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // ── Community i18n gate (#207) ───────────────────────────────────────────
  // Every user-facing string under the community feature must be translated.
  // `i18next/no-literal-string` in `jsx-only` mode flags hard-coded strings that
  // render in the UI; the tuning below narrows it to *user-facing* copy only (JSX
  // text, placeholder, title, aria-label) by excluding the callees, object-property
  // keys and JSX attributes that carry code, not prose — so the rule is signal, not
  // noise. (Toast copy lives outside JSX and is swept by hand — see the mode note.) Runs in `npm run lint` for these files and, on
  // its own, via `npm run lint:community-i18n`. Tests are excluded: their
  // strings aren't user-facing. See issue #207.
  {
    files: [
      "src/pages/community/**/*.{ts,tsx}",
      "src/components/community/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.{ts,tsx}"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          framework: "react",
          // `jsx-only` validates literals that render in the UI — JSX text and
          // JSX attribute values (placeholder, title, aria-label) — while
          // leaving code-level literals (status discriminants, className maps,
          // zod messages, config objects) alone. That is the "signal not noise"
          // line the parenthetical in #207 draws. Toast copy lives outside JSX
          // and so is swept by hand, not by this rule.
          mode: "jsx-only",
          "jsx-attributes": {
            exclude: [
              // shadcn/Radix & DOM plumbing — not user-facing prose.
              "className",
              "class",
              "style",
              "styleName",
              "type",
              "variant",
              "size",
              "key",
              "id",
              "name",
              "role",
              "width",
              "height",
              "href",
              "to",
              "target",
              "rel",
              "value",
              "htmlFor",
              "tabIndex",
              "align",
              "side",
              "sideOffset",
              "orientation",
              "autoComplete",
              "data-testid",
              "data-.*",
              "aria-hidden",
              // Custom props that carry a className/id reference, not prose.
              "fallbackClassName",
              "list",
            ],
          },
          callees: {
            // Args to these carry keys/paths/ids/classnames — not prose.
            exclude: [
              "i18n(ext)?",
              "t",
              "require",
              "addEventListener",
              "removeEventListener",
              "postMessage",
              "getElementById",
              "querySelector",
              "dispatch",
              "commit",
              "includes",
              "indexOf",
              "endsWith",
              "startsWith",
              "split",
              "join",
              "replace",
              "replaceAll",
              "match",
              "test",
              "callApi",
              "callApiRaw",
              "navigate",
              "useState",
              "useRef",
              "useSearchParams",
              "cn",
              "cva",
              "clsx",
              "twMerge",
              "setItem",
              "getItem",
              "removeItem",
              "getAttribute",
              "setAttribute",
              "format",
              "parseISO",
              "createElement",
              "setValue",
              "getValues",
              "watch",
              "register",
              "setError",
              "clearErrors",
              "z",
              // Any `setX(...)` state setter — args are code, never prose.
              "set[A-Z].*",
              // This codebase's flash-state helpers take an internal flag key.
              "flash",
              "flashed",
            ],
          },
          "object-properties": {
            exclude: [
              "[A-Z_-]+",
              "variant",
              "size",
              "type",
              "className",
              "id",
              "name",
              "role",
              "href",
              "to",
              "path",
              "key",
              "hrefKey",
              "queryKey",
              "mutationKey",
              "testId",
              "data-testid",
              "method",
              "mode",
              "status",
              "value",
              "align",
              "side",
            ],
          },
        },
      ],
    },
  },
);
