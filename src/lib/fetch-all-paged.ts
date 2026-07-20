// PostgREST(Supabase)는 한 번의 select에서 최대 1000행만 돌려주고,
// 초과분은 **에러 없이 조용히 잘린다**. 그래서 "전건이 필요한 조회"를 그냥
// .select()로 하면 데이터가 1000건을 넘는 순간 화면에서 소리 없이 사라진다.
// 전건 조회는 반드시 이 헬퍼로 감싸 페이지를 이어받을 것.
//
//   const rows = await fetchAllPaged((from, to) =>
//     supabase.from('broker_customers').select('*').in('broker_id', ids).range(from, to))
//
// build 콜백은 반드시 인자로 받은 from/to를 .range()에 넘겨야 한다.
// (안 넘기면 매번 같은 1000행이 와서 진전이 없다 — MAX_PAGES로 폭주만 막는다)

const PAGE_SIZE = 1000
const MAX_PAGES = 100 // 10만 행 안전장치 — .range() 누락 등으로 인한 무한 루프 차단

export async function fetchAllPaged<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) return all
  }
  if (all.length >= MAX_PAGES * pageSize) {
    console.warn(`[fetchAllPaged] ${MAX_PAGES}페이지 상한에 도달했습니다. range 누락이거나 데이터가 과도합니다.`)
  }
  return all
}
