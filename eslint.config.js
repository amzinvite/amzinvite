import globals from "globals";

export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        AmzinvitePopupState: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        chrome: "writable",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
];
