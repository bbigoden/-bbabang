// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/worktrees/**", // 작업 worktree 사본은 lint 제외
    "scripts/**",            // 일회성 운영 스크립트는 lint 제외
  ]),
  {
    rules: {
      // any 타입 → 광범위 사용 중, 점진적 개선 예정 (warn으로 하향)
      "@typescript-eslint/no-explicit-any": "warn",

      // 미사용 변수 → _ 접두사 패턴 허용 (warn)
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],

      // React Compiler 규칙 — React Compiler 미사용 환경이므로 비활성
      // (이 규칙들은 React Compiler 최적화를 위한 것으로, 일반 React 코드에서는 불필요)
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",

      // Next.js Image 마이그레이션 중 (warn)
      "@next/next/no-img-element": "warn",

      // supabase client는 컴포넌트 외부에서 안정화 예정 (warn)
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  ...storybook.configs["flat/recommended"]
]);

export default eslintConfig;
