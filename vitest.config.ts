import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    // 제외:
    // - .claude/worktrees/* : 스테일 git worktree의 테스트 복사본이 섞여 거짓 실패 내는 것 방지
    // - tests/**            : Playwright(visual) 테스트 — `npm run inspect:visual`로 별도 실행,
    //                         vitest가 수집하면 test.describe() 충돌로 실패
    exclude: [...configDefaults.exclude, '**/.claude/**', 'tests/**'],
    environmentMatchGlobs: [
      ['src/__tests__/component.test.tsx', 'jsdom'],
      ['src/__tests__/**', 'node'],
    ],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**', 'src/components/ui/**'],
    },
  },
});