/**
 * A/B 실험 정의 파일.
 *
 * 실험 추가 방법:
 *   1. EXPERIMENTS 배열에 항목 추가 (active: true)
 *   2. 각 variant의 weight 합계가 100이 되도록 설정
 *   3. 컴포넌트에서 useAb('experiment_id') 훅으로 variant 읽기
 *   4. 전환 이벤트는 trackAb() 유틸로 기록
 *
 * variant id 규칙: 'control' = 기존, 'treatment_*' = 실험군
 */

export type AbVariant = {
  id: string  // 'control' | 'treatment_a' | ...
  weight: number  // 0~100, 전체 합계 = 100
}

export type AbExperiment = {
  id: string       // 고유 식별자 (쿠키명: ab_<id>)
  active: boolean  // false면 미들웨어가 건너뜀
  variants: AbVariant[]
  description?: string
}

/** 실험 목록 — 비어있으면 인프라만 준비된 상태 */
export const EXPERIMENTS: AbExperiment[] = [
  // 실험 예시 (비활성):
  // {
  //   id: 'home_cta_v1',
  //   active: false,
  //   description: '홈 CTA 문구 테스트',
  //   variants: [
  //     { id: 'control',   weight: 50 },
  //     { id: 'treatment', weight: 50 },
  //   ],
  // },
]

/** 가중치에 따라 variant를 무작위 선택 */
export function pickVariant(exp: AbExperiment): string {
  const total = exp.variants.reduce((s, v) => s + v.weight, 0)
  let rand = Math.random() * total
  for (const v of exp.variants) {
    rand -= v.weight
    if (rand <= 0) return v.id
  }
  return exp.variants.at(-1)?.id ?? 'control'
}

export const AB_COOKIE_PREFIX = 'ab_'
export const AB_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  // 30일
