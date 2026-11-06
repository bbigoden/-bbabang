'use client'

import { createClient } from '@/lib/supabase/client'

// broker_profiles.col_settings 를 한 곳에서 읽고 쓴다.
// 시트 화면(고객·일지·매물)은 칸 설정·새 행 방향·유입 선택지를 한 번에 열어서, 훅마다 따로 받으면
// 같은 값을 2~3번 받았다(폰에서 왕복마다 수백 ms). 같은 id 는 짧은 동안 한 번만 받는다.
// 저장도 훅마다 '읽고→합쳐서 쓰기'를 따로 하면 둘이 겹칠 때 한쪽이 덮이므로 id 별로 줄 세워 한다.

type Json = Record<string, any>

const FRESH_MS = 10_000
const cache = new Map<string, { at: number; value: Promise<Json> }>()
const writing = new Map<string, Promise<unknown>>()

async function fetchColSettings(id: string): Promise<Json> {
  const { data } = await createClient().from('broker_profiles').select('col_settings').eq('id', id).single()
  return ((data as { col_settings?: Json | null } | null)?.col_settings ?? {}) as Json
}

export function getColSettings(id: string): Promise<Json> {
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.value
  const value = fetchColSettings(id).catch(() => { cache.delete(id); return {} as Json })
  cache.set(id, { at: Date.now(), value })
  return value
}

/** 최신 값을 읽어 mutate 결과로 저장한다. 같은 id 의 저장은 차례로 처리된다. */
export function patchColSettings(id: string, mutate: (existing: Json) => Json): Promise<void> {
  const prev = writing.get(id) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(async () => {
    const next = mutate(await fetchColSettings(id))
    cache.set(id, { at: Date.now(), value: Promise.resolve(next) })
    await createClient().from('broker_profiles').update({ col_settings: next }).eq('id', id)
  })
  writing.set(id, run)
  run.finally(() => { if (writing.get(id) === run) writing.delete(id) })
  return run
}
