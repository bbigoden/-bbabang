import { cn } from '@/lib/utils'

/**
 * 로딩 스피너 공용 컴포넌트.
 *
 * 같은 모양이 34개 파일에 65번 인라인으로 복붙돼 있었고, 테두리 색이
 * border-blue-600(25회)과 border-blue-500(27회)로 갈려 있었다. globals.css의
 * @theme에서 blue-600만 브랜드 네이비(#14274e)로 치환되므로 둘은 실제로
 * 다른 색으로 렌더된다. 여기로 모아 브랜드 색으로 통일한다.
 *
 * 접근성: 스피너만 있고 텍스트가 없으면 스크린리더는 아무 일도 일어나지 않는
 * 것처럼 읽는다. role="status"와 sr-only 라벨을 기본으로 붙인다.
 * 옆에 이미 "불러오는 중" 같은 문구가 있으면 label={null}로 중복을 없앤다.
 */
const SIZES = {
  xs: 'h-4 w-4 border-2',
  sm: 'h-5 w-5 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-[3px]',
  xl: 'h-12 w-12 border-4',
} as const

export type SpinnerSize = keyof typeof SIZES

export function Spinner({
  size = 'md',
  tone = 'brand',
  label = '불러오는 중',
  className,
}: {
  size?: SpinnerSize
  /** brand: 페트롤 네이비 / white: 컬러 버튼 위 / current: 부모 글자색 */
  tone?: 'brand' | 'white' | 'current'
  /** 스크린리더용 설명. 옆에 같은 뜻의 문구가 이미 있으면 null */
  label?: string | null
  className?: string
}) {
  const toneClass =
    tone === 'white' ? 'border-white' : tone === 'current' ? 'border-current' : 'border-blue-600'

  return (
    <span
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
      className={cn('inline-block animate-spin rounded-full border-t-transparent', SIZES[size], toneClass, className)}
    >
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
