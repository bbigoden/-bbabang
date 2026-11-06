// 자료실 휴지통 — 되살리기·영구삭제. 휴지통 화면(/broker/trash 의 '자료실' 탭)과
// 자료실의 30일 자동 비우기가 같이 쓴다. 2026-11-06 자료실 안 휴지통을 바깥 휴지통으로 합쳤다.
// 지우기(휴지통으로 옮기기)는 자료실 화면에 그대로 있다 — deleted_at 만 채운다.
import type { SupabaseClient } from '@supabase/supabase-js'

export const RESOURCE_BUCKET = 'office-resources'
export const RESOURCE_TRASH_DAYS = 30

export interface TrashResource {
  id: string
  uploader_broker_id: string | null
  kind: 'folder' | 'memo'
  parent_id: string | null
  title: string
  deleted_at: string | null
}
export interface TrashFile {
  id: string
  resource_id: string | null
  uploader_broker_id: string | null
  storage_path: string
  file_name: string
  deleted_at: string | null
}

export type ResourceKey = string // 'r:<id>' 폴더·메모 / 'f:<id>' 파일

/** 위 폴더 중 하나라도 휴지통에 있으면 true — 위 폴더가 안 보이면(볼 수 없는 폴더) 맨 위로 본다 */
export function makeAncestorTrashed(rList: TrashResource[]) {
  const byId = new Map(rList.map(r => [r.id, r]))
  return (id: string | null): boolean => {
    for (let i = 0, cur = id; cur && i < 50; i++) {
      const r = byId.get(cur)
      if (!r) return false
      if (r.deleted_at) return true
      cur = r.parent_id && byId.has(r.parent_id) ? r.parent_id : null
    }
    return false
  }
}

/** 휴지통에 보일 것 — 정리할 수 있는 것 중 맨 위 것만(지운 폴더 안 것은 폴더와 함께 간다) */
export function trashTop<R extends TrashResource, F extends TrashFile>(rList: R[], fList: F[], canManage: (uploader: string | null) => boolean) {
  const byId = new Map(rList.map(r => [r.id, r]))
  const ancestorTrashed = makeAncestorTrashed(rList)
  const parentOf = (pid: string | null) => (pid && byId.has(pid) ? pid : null)
  return {
    res: rList.filter(r => r.deleted_at && !ancestorTrashed(parentOf(r.parent_id)) && canManage(r.uploader_broker_id)),
    files: fList.filter(f => f.deleted_at && !ancestorTrashed(parentOf(f.resource_id)) && canManage(f.uploader_broker_id)),
  }
}

/** 되살리기 — 원래 있던 폴더가 없어졌거나 휴지통에 있으면 맨 위로 */
export async function restoreResourceKeys(supabase: SupabaseClient, keys: ResourceKey[], rList: TrashResource[], fList: TrashFile[]) {
  const resById = new Map(rList.map(r => [r.id, r]))
  const fileById = new Map(fList.map(f => [f.id, f]))
  const ancestorTrashed = makeAncestorTrashed(rList)
  const lost = (pid: string | null) => !!pid && (!resById.has(pid) || !!resById.get(pid)!.deleted_at || ancestorTrashed(pid))
  const rPatch = keys.filter(k => k.startsWith('r:')).map(k => k.slice(2))
    .map(id => { const pid = resById.get(id)?.parent_id ?? null; return { id, parent_id: lost(pid) ? null : pid } })
  const fPatch = keys.filter(k => k.startsWith('f:')).map(k => k.slice(2))
    .map(id => { const pid = fileById.get(id)?.resource_id ?? null; return { id, resource_id: lost(pid) ? null : pid } })
  const results = await Promise.all([
    ...rPatch.map(p => supabase.from('office_resources').update({ deleted_at: null, parent_id: p.parent_id }).eq('id', p.id)),
    ...fPatch.map(p => supabase.from('office_resource_files').update({ deleted_at: null, resource_id: p.resource_id }).eq('id', p.id)),
  ])
  return { error: results.find(r => r.error)?.error ?? null }
}

/**
 * 영구삭제 — 폴더면 그 안의 것도 함께(대표는 전부, 직원은 본인 것).
 * 직원이 못 지우는 남의 것은 DB 가 맨 위로 꺼내 놓는다.
 * fList 에는 지운 폴더 안의 살아 있는 파일도 들어 있어야 저장소에서 같이 지워진다.
 */
export async function purgeResourceKeys(
  supabase: SupabaseClient, keys: ResourceKey[], rList: TrashResource[], fList: TrashFile[],
  canManage: (uploader: string | null) => boolean,
) {
  const rMap = new Map(rList.map(r => [r.id, r]))
  const inside = (pid: string | null, anc: string) => {
    for (let i = 0, cur = pid; cur && i < 50; i++) { if (cur === anc) return true; cur = rMap.get(cur)?.parent_id ?? null }
    return false
  }
  const topR = keys.filter(k => k.startsWith('r:')).map(k => k.slice(2))
  const rIds = new Set(topR)
  rList.forEach(r => { if (canManage(r.uploader_broker_id) && topR.some(t => inside(r.parent_id, t))) rIds.add(r.id) })
  const fIds = new Set(keys.filter(k => k.startsWith('f:')).map(k => k.slice(2)))
  fList.forEach(f => { if (canManage(f.uploader_broker_id) && topR.some(t => inside(f.resource_id, t))) fIds.add(f.id) })
  const paths = fList.filter(f => fIds.has(f.id)).map(f => f.storage_path)
  if (paths.length) await supabase.storage.from(RESOURCE_BUCKET).remove(paths)
  const [a, b] = await Promise.all([
    fIds.size ? supabase.from('office_resource_files').delete().in('id', [...fIds]) : Promise.resolve({ error: null }),
    rIds.size ? supabase.from('office_resources').delete().in('id', [...rIds]) : Promise.resolve({ error: null }),
  ])
  return { rIds, fIds, error: a.error || b.error || null }
}
