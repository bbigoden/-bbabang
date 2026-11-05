import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPaged } from '@/lib/fetch-all-paged'

/**
 * 매물사진(property-images) 정리 (2026-11-05)
 *
 * 1) 고아 사진 — 매물 사진 칸에서 ✕ 로 빼면 매물에서는 빠지지만 파일은 그대로 남았다(155MB).
 *    어느 매물(지운 매물 포함)에도 안 걸린 파일을 지운다. 방금 올리고 [저장] 전인 사진을 지우지 않게
 *    minAgeDays 보다 오래된 것만.
 *    매물 '복사'가 사진 주소를 같이 가져가도 둘 중 하나라도 걸려 있으면 남는다.
 * 2) 큰 사진 줄이기 — 줄이기 전에 원본으로 올라간 사진을 긴 변 1600px JPEG 로 다시 구워
 *    **같은 경로에 덮어쓴다**. 주소가 그대로라 매물·광고에 걸린 링크는 안 바뀐다
 *    (CDN 이 옛 파일을 한 시간쯤 더 보여 줄 수 있다).
 */

export const PHOTO_BUCKET = 'property-images'
const SHRINK_OVER = 600 * 1024
const SIDE = 1600
const QUALITY = 82

type Obj = { path: string; size: number; created: number; mime: string }

async function listAll(supa: SupabaseClient): Promise<Obj[]> {
  const out: Obj[] = []
  const walk = async (prefix: string) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supa.storage.from(PHOTO_BUCKET).list(prefix, { limit: 1000, offset })
      if (error) throw error
      if (!data?.length) break
      for (const o of data) {
        const path = prefix ? `${prefix}/${o.name}` : o.name
        if (o.id == null) await walk(path)       // 폴더(올린 사람 id)
        else out.push({
          path,
          size: Number(o.metadata?.size ?? 0),
          created: Date.parse(o.created_at ?? '') || 0,
          mime: String(o.metadata?.mimetype ?? ''),
        })
      }
      if (data.length < 1000) break
    }
  }
  await walk('')
  return out
}

async function referencedPaths(supa: SupabaseClient): Promise<Set<string>> {
  const rows = await fetchAllPaged<{ images: string[] | null }>((from, to) =>
    supa.from('broker_properties').select('images').not('images', 'is', null).range(from, to))
  const marker = `/${PHOTO_BUCKET}/`
  const set = new Set<string>()
  for (const r of rows) for (const u of r.images ?? []) {
    const i = u.indexOf(marker)
    if (i >= 0) set.add(decodeURIComponent(u.slice(i + marker.length).split('?')[0]))
  }
  return set
}

export async function deleteOrphanPhotos(supa: SupabaseClient, { dry, minAgeDays }: { dry: boolean; minAgeDays: number }) {
  const [objs, used] = await Promise.all([listAll(supa), referencedPaths(supa)])
  // 걸린 사진이 하나도 안 잡히면 주소 형식이 바뀐 것 — 다 지워 버리지 않게 멈춘다
  if (used.size === 0) throw new Error('매물에 걸린 사진을 하나도 못 찾았습니다 — 지우지 않고 멈춥니다')
  const cutoff = Date.now() - minAgeDays * 864e5
  const orphans = objs.filter(o => !used.has(o.path) && o.created && o.created < cutoff)
  const bytes = orphans.reduce((n, o) => n + o.size, 0)
  if (!dry) {
    for (let i = 0; i < orphans.length; i += 100) {
      const { error } = await supa.storage.from(PHOTO_BUCKET).remove(orphans.slice(i, i + 100).map(o => o.path))
      if (error) throw error
    }
  }
  return { total: objs.length, used: used.size, orphans: orphans.length, orphanMB: +(bytes / 1048576).toFixed(1), deleted: !dry }
}

export async function shrinkBigPhotos(supa: SupabaseClient, { dry, limit }: { dry: boolean; limit: number }) {
  const sharp = (await import('sharp')).default
  const objs = await listAll(supa)
  const big = objs.filter(o => o.size > SHRINK_OVER && o.mime !== 'image/gif').sort((a, b) => b.size - a.size)
  const report = { remaining: big.length, remainingMB: +(big.reduce((n, o) => n + o.size, 0) / 1048576).toFixed(1), done: 0, savedMB: 0, skipped: [] as string[] }
  if (dry) return report
  let saved = 0
  for (const o of big.slice(0, limit)) {
    try {
      const { data, error } = await supa.storage.from(PHOTO_BUCKET).download(o.path)
      if (error || !data) throw error ?? new Error('download')
      const out = await sharp(Buffer.from(await data.arrayBuffer()))
        .rotate()   // EXIF 방향을 픽셀에 굽는다 — 메타데이터를 버리므로 안 하면 옆으로 눕는다
        .resize({ width: SIDE, height: SIDE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer()
      if (out.length > o.size * 0.8) { report.skipped.push(o.path); continue }
      const { error: upErr } = await supa.storage.from(PHOTO_BUCKET)
        .upload(o.path, out, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' })
      if (upErr) throw upErr
      saved += o.size - out.length
      report.done++
    } catch {
      report.skipped.push(o.path)
    }
  }
  report.savedMB = +(saved / 1048576).toFixed(1)
  return report
}
