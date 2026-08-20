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
    },
  },
  {
    // INV-6 · core/ 는 브라우저 API를 모른다 (docs/rules.md)
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'INV-6: core/ 는 브라우저 API를 참조할 수 없다' },
        { name: 'window', message: 'INV-6: core/ 는 브라우저 API를 참조할 수 없다' },
        { name: 'navigator', message: 'INV-6: core/ 는 브라우저 API를 참조할 수 없다' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='outerHTML']",
          message: 'INV-2: 전체 재직렬화 금지',
        },
        {
          selector: "CallExpression[callee.name='serialize']",
          message: 'INV-2: parse5.serialize 로 문서를 재직렬화하지 않는다',
        },
      ],
    },
  }
);
