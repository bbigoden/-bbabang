import { describe, it, expect } from 'vitest'
import { mapLimit } from '@/lib/map-limit'

// 매물 사진을 3장씩 함께 올릴 때 — 늦게 끝난 장이 있어도 결과는 고른 순서 그대로여야 한다
describe('mapLimit', () => {
  it('끝나는 순서와 상관없이 넣은 순서대로 돌려준다', async () => {
    const waits = [50, 10, 30, 5, 20]
    const out = await mapLimit(waits, 3, async (ms, i) => { await new Promise(r => setTimeout(r, ms)); return `사진${i}` })
    expect(out).toEqual(['사진0', '사진1', '사진2', '사진3', '사진4'])
  })

  it('한 번에 정해진 수까지만 돈다', async () => {
    let now = 0, peak = 0
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      now++; peak = Math.max(peak, now)
      await new Promise(r => setTimeout(r, 5))
      now--
    })
    expect(peak).toBe(3)
  })
})
