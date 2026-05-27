import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Storybook vitest 통합은 stories에 play 함수 없으면 "No test suite found" 실패 →
// vitest 전체가 exit code 1 반환 → CI 차단 위험.
// 단위·컴포넌트 테스트만 실행. Storybook 자체는 `npm run storybook`으로 별도 띄움.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
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