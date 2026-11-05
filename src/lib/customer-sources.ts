// 고객 '유입' 기본 선택지 — 고객목록과 업무일지가 같이 쓴다.
// 화면마다 따로 적어 두었다가 한쪽만 고쳐져 '네이버블로그'·'특톡'이 갈라진 일이 있어(2026-11-01) 하나로 모았다.
// 11-05부터 대표가 화면(유입 칼럼 머리글)에서 고치면 사무실 공통 목록으로 저장된다(use-office-sources.ts).
// 여기 목록은 대표가 아직 한 번도 고치지 않은 사무실의 기본값이다.
// 사람별 칼럼 설정(col_settings[page].options.source)의 유입 선택지는 쓰지 않는다.
export const SOURCE_OPTIONS = ['부소장', '당근', '플레이스', '네이버광고', '블로그', '카페', '인스타', '공동', '지인', '톡톡', '다방', '워킹', '기타']

export const SOURCE_COLORS: Record<string, string> = {
  '부소장': 'bg-blue-100 text-blue-700', '빠방': 'bg-blue-100 text-blue-700', '당근': 'bg-orange-100 text-orange-700',
  '플레이스': 'bg-sky-100 text-sky-700', '네이버광고': 'bg-green-100 text-green-700',
  '블로그': 'bg-emerald-100 text-emerald-700', '카페': 'bg-lime-100 text-lime-700',
  '인스타': 'bg-fuchsia-100 text-fuchsia-700',
  '공동': 'bg-purple-100 text-purple-700', '지인': 'bg-pink-100 text-pink-700',
  '톡톡': 'bg-yellow-100 text-yellow-700', '다방': 'bg-teal-100 text-teal-700',
  '워킹': 'bg-indigo-100 text-indigo-700', '기타': 'bg-gray-100 text-gray-600',
}
