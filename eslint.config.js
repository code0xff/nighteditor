import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      // INV-2 · no whole-document re-serialization (docs/rules.md).
      //
      // Everywhere, not just core/. core/ cannot reach the DOM at all (INV-6), so
      // there this could never fire; the code that *can* re-serialize is
      // preview/agent.ts and store/editor.ts, and until now neither was watched.
      // Reading one block's innerHTML stays allowed — the invariant is about the
      // whole document.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='outerHTML']",
          message: 'INV-2: no whole-document re-serialization',
        },
        {
          selector: "CallExpression[callee.name='serialize']",
          message: 'INV-2: never re-serialize the document with parse5.serialize',
        },
        {
          selector: "NewExpression[callee.name='XMLSerializer']",
          message: 'INV-2: never re-serialize the document with XMLSerializer',
        },
      ],
    },
  },
  {
    // The icon generator runs directly in Node
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
  {
    // INV-6 · core/ knows nothing of browser APIs (docs/rules.md)
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'INV-6: core/ cannot reference browser APIs' },
        { name: 'window', message: 'INV-6: core/ cannot reference browser APIs' },
        { name: 'navigator', message: 'INV-6: core/ cannot reference browser APIs' },
        // Web Encoding globals — these leaked into core/zip.ts once, caught in the 15th review.
        { name: 'TextDecoder', message: 'INV-6: core/ cannot reference Web Encoding globals' },
        { name: 'TextEncoder', message: 'INV-6: core/ cannot reference Web Encoding globals' },
      ],
    },
  }
);
