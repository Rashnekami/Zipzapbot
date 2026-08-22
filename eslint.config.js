// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'data/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Um projeto só para o lint, que enxerga também os arquivos de teste —
        // os tsconfig de build os excluem de propósito, para não irem para dist.
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Requisito de segurança do briefing: entrada de usuário nunca vai para o shell.
      'no-restricted-properties': [
        'error',
        {
          object: 'child_process',
          property: 'exec',
          message: 'Use spawn(bin, [args]). exec() passa pelo shell — proibido no projeto.',
        },
        {
          object: 'child_process',
          property: 'execSync',
          message: 'Use spawn(bin, [args]). execSync() passa pelo shell — proibido no projeto.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'fluent-ffmpeg',
              message:
                'Proibido: monta linha de comando por string. Use spawn com array de argumentos.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    files: ['eslint.config.js', 'vitest.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
