/**
 * 한꺼번에 n개씩만 돌리는 Promise.all.
 *
 * 행마다 요청을 하나씩 보내야 할 때(여러 줄을 서로 다른 값으로 고치기 등) 수십 개를
 * 한 번에 쏘면 폰에서 줄이 막힌다. 돌려주는 순서는 넣은 순서 그대로.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => PromiseLike<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
  return out
}
