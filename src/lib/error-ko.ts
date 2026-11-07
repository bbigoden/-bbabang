/**
 * 에러 알림용 — 브라우저가 내는 영어 에러 문구에 한글 설명을 붙이고, 시험 화면(localhost)에서 난 건 가려낸다.
 * 사장님 폰 알림에 "showSubItem is not defined" 처럼 영어만 떠서 무슨 일인지 몰랐다(11-07).
 */

/** 사장님 PC 의 시험 화면(next dev)에서 난 에러 — 코드를 고치는 도중에 잠깐 나는 게 대부분이라 알리지 않는다 */
export function isDevErrorUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
  } catch {
    return false
  }
}

const RULES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/ChunkLoadError|Loading (?:CSS )?chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i,
    () => '새 버전 배포 뒤 옛 화면 파일을 못 불러옴'],
  [/^(?:ReferenceError: )?([\w$.]+) is not defined/, m => `코드에서 '${m[1]}'을(를) 못 찾음`],
  [/Cannot read propert(?:y|ies) of (?:undefined|null)(?: \(reading '([^']+)'\))?/,
    m => m[1] ? `빈 값에서 '${m[1]}'을(를) 읽으려 함` : '빈 값을 읽으려 함'],
  [/undefined is not an object \(evaluating '([^']+)'\)/, m => `빈 값에서 '${m[1]}'을(를) 읽으려 함`],
  [/([\w$.]+) is not a function/, m => `'${m[1]}'이(가) 함수가 아님`],
  [/Hydration|hydrat/i, () => '화면 첫 그림이 서버와 다름'],
  [/Minified React error #(\d+)/, m => `React 오류 #${m[1]}`],
  [/JWT expired|Invalid Refresh Token|Refresh Token Not Found/i, () => '로그인이 만료됨'],
  [/timed? ?out|timeout/i, () => '응답 시간 초과'],
  [/Failed to fetch|NetworkError|Load failed|network error/i, () => '서버 연결 실패(인터넷 끊김 등)'],
  [/QuotaExceeded/i, () => '폰 저장공간(브라우저 저장소) 가득 참'],
]

/** 알려진 에러면 한글 설명, 모르면 null */
export function describeErrorKo(message: string): string | null {
  for (const [re, fn] of RULES) {
    const m = message.match(re)
    if (m) return fn(m)
  }
  return null
}

/** 알림 한 줄 — "한글 설명 (원문)" 또는 원문 그대로 */
export function errorLineKo(message: string): string {
  const ko = describeErrorKo(message)
  return ko ? `${ko} (${message})` : message
}
