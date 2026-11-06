import { mapLimit } from '@/lib/map-limit'

/**
 * fetchAllPaged 를 몇 개씩 같이 받는 판. 먼저 몇 행인지 묻고(count head) 1000행 묶음을
 * `limit` 개씩 동시에 받는다. 2.4만 행을 한 묶음씩 차례로 받으면 폰에서 스무 번 왕복을 기다렸다.
 *
 * - order 는 겹치지 않는 열(기본키 포함)로 끝나야 묶음 사이에 행이 빠지거나 겹치지 않는다.
 * - 세는 사이에 늘어난 행은 마지막 묶음이 꽉 차 있으면 이어서 받는다.
 */
export async function fetchAllParallel<T>(
  count: () => PromiseLike<{ count: number | null; error: any }>,
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  limit = 4,
  pageSize = 1000,
): Promise<T[]> {
  const { count: n, error } = await count()
  if (error) throw error
  const pages = Math.max(1, Math.ceil((n ?? 0) / pageSize))
  const page = async (p: number) => {
    const { data, error: e } = await build(p * pageSize, p * pageSize + pageSize - 1)
    if (e) throw e
    return data ?? []
  }
  const chunks = await mapLimit(Array.from({ length: pages }, (_, p) => p), limit, page)
  for (let p = pages; chunks[chunks.length - 1].length === pageSize && p < 100; p++) chunks.push(await page(p))
  return chunks.flat()
}
