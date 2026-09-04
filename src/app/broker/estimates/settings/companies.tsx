'use client'

/** 견적서 발행 명의 회사 관리 (여러 개 등록해두고 견적마다 선택) */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { Plus, Trash2, Star, Upload, X, Building2 } from 'lucide-react'
import type { EstimateCompany } from '@/lib/estimate'

const FIELD = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white'
const LABEL = 'mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400'

const STAMP_BUCKET = 'estimate-stamps'
const STAMP_TTL = 60 * 60   // 미리보기용 서명 URL 수명(초)

export function CompaniesTab({ brokerId }: { brokerId: string }) {
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<EstimateCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<EstimateCompany> | null>(null)
  const [saving, setSaving] = useState(false)
  // 직인 버킷은 비공개라 미리보기도 서명 URL이 필요하다 (stamp_path → URL)
  const [stampUrls, setStampUrls] = useState<Record<string, string>>({})
  const [editingStamp, setEditingStamp] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const signStamp = useCallback(async (path: string) => {
    const { data } = await supabase.storage.from(STAMP_BUCKET).createSignedUrl(path, STAMP_TTL)
    return data?.signedUrl ?? null
  }, [supabase])

  const load = useCallback(async () => {
    const { data } = await supabase.from('estimate_companies')
      .select('*').eq('owner_broker_id', brokerId)
      .order('is_default', { ascending: false }).order('sort_order')
    const list = (data as EstimateCompany[]) ?? []
    setRows(list)

    const paths = list.filter(c => c.stamp_path).map(c => c.stamp_path as string)
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(STAMP_BUCKET).createSignedUrls(paths, STAMP_TTL)
      const map: Record<string, string> = {}
      for (const c of list) {
        const hit = signed?.find(x => x.path === c.stamp_path)
        if (hit?.signedUrl) map[c.id] = hit.signedUrl
      }
      setStampUrls(map)
    } else {
      setStampUrls({})
    }
    setLoading(false)
  }, [brokerId, supabase])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!editing?.name?.trim()) { toast.error('상호를 입력하세요'); return }
    setSaving(true)
    const { id, ...rest } = editing
    const payload = { ...rest, owner_broker_id: brokerId, name: editing.name.trim() }
    const res = id
      ? await supabase.from('estimate_companies').update(payload).eq('id', id)
      : await supabase.from('estimate_companies').insert(payload)
    setSaving(false)
    if (res.error) { toast.error('저장하지 못했습니다'); return }
    toast.success('저장했습니다')
    setEditing(null)
    load()
  }

  const remove = async (row: EstimateCompany) => {
    if (!confirm(`"${row.name}" 회사를 삭제할까요?\n이미 발행한 견적서의 내용은 그대로 남습니다.`)) return
    const { error } = await supabase.from('estimate_companies').delete().eq('id', row.id)
    if (error) { toast.error('삭제하지 못했습니다'); return }
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  const makeDefault = async (row: EstimateCompany) => {
    await supabase.from('estimate_companies').update({ is_default: false }).eq('owner_broker_id', brokerId)
    await supabase.from('estimate_companies').update({ is_default: true }).eq('id', row.id)
    load()
  }

  const uploadStamp = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('이미지 파일만 올릴 수 있습니다'); return }
    if (file.size > 2 * 1024 * 1024) { toast.error('2MB 이하 이미지를 사용하세요'); return }
    // Storage 키에 한글이 들어가면 거부당한다 — 확장자도 ASCII 만 받는다
    const ext = (file.name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '.png').toLowerCase()
    const path = `${brokerId}/stamp-${Date.now()}${ext}`
    const { error } = await supabase.storage.from(STAMP_BUCKET).upload(path, file, { contentType: file.type })
    if (error) { toast.error('직인을 올리지 못했습니다'); return }
    setEditing(prev => ({ ...prev, stamp_path: path }))
    setEditingStamp(await signStamp(path))
    toast.success('직인을 등록했습니다')
  }

  if (loading) return <p className="py-8 text-center text-sm text-gray-500">불러오는 중…</p>

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          견적서에 찍힐 발행 명의입니다. 회사가 여러 곳이면 모두 등록해두고 견적마다 골라 쓰세요.
        </p>
        <button onClick={() => { setEditing({ is_default: rows.length === 0, sort_order: rows.length }); setEditingStamp(null) }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" />회사 추가
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center dark:border-gray-800">
          <Building2 className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-700" />
          <p className="text-sm text-gray-500">등록된 회사가 없습니다.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map(c => (
            <div key={c.id} className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="font-bold text-gray-900 dark:text-white">{c.name}</h2>
                {c.is_default && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">기본</span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  {!c.is_default && (
                    <button onClick={() => makeDefault(c)} title="기본 회사로" aria-label="기본 회사로 지정"
                      className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-amber-500 dark:hover:bg-gray-800">
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => { setEditing(c); setEditingStamp(stampUrls[c.id] ?? null) }}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10">
                    수정
                  </button>
                  <button onClick={() => remove(c)} title="삭제" aria-label="회사 삭제"
                    className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <dl className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                <Line k="등록번호" v={c.biz_no} />
                <Line k="대표자" v={c.ceo} />
                <Line k="소재지" v={c.address} />
                <Line k="연락처" v={c.phone} />
                <Line k="담당자" v={[c.manager_name, c.manager_phone].filter(Boolean).join(' ') || null} />
              </dl>
              {c.stamp_path && (
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                  {stampUrls[c.id] && (
                    <Image src={stampUrls[c.id]} alt="직인" width={32} height={32} className="rounded border border-gray-100 object-contain dark:border-gray-800" unoptimized />
                  )}
                  직인 등록됨
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 편집 모달 */}
      {editing && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setEditing(null)}>
          <div onClick={e => e.stopPropagation()}
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-gray-900 sm:rounded-2xl">
            <div className="mb-4 flex items-center">
              <h2 className="text-base font-black text-gray-900 dark:text-white">
                {editing.id ? '회사 수정' : '회사 추가'}
              </h2>
              <button onClick={() => setEditing(null)} aria-label="닫기" className="ml-auto rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="상호 *" value={editing.name} onChange={v => setEditing(p => ({ ...p, name: v }))} />
              <Field label="사업자등록번호" value={editing.biz_no} onChange={v => setEditing(p => ({ ...p, biz_no: v }))} placeholder="000-00-00000" />
              <Field label="대표자" value={editing.ceo} onChange={v => setEditing(p => ({ ...p, ceo: v }))} />
              <Field label="전화" value={editing.phone} onChange={v => setEditing(p => ({ ...p, phone: v }))} />
              <div className="sm:col-span-2">
                <Field label="사업장 소재지" value={editing.address} onChange={v => setEditing(p => ({ ...p, address: v }))} />
              </div>
              <Field label="업태" value={editing.biz_type} onChange={v => setEditing(p => ({ ...p, biz_type: v }))} placeholder="건설업" />
              <Field label="종목" value={editing.biz_item} onChange={v => setEditing(p => ({ ...p, biz_item: v }))} placeholder="실내건축공사" />
              <Field label="팩스" value={editing.fax} onChange={v => setEditing(p => ({ ...p, fax: v }))} />
              <Field label="이메일" value={editing.email} onChange={v => setEditing(p => ({ ...p, email: v }))} />
              <Field label="담당자" value={editing.manager_name} onChange={v => setEditing(p => ({ ...p, manager_name: v }))}
                placeholder="현장 담당자 (대표자와 다를 때)" />
              <Field label="담당자 연락처" value={editing.manager_phone} onChange={v => setEditing(p => ({ ...p, manager_phone: v }))} />
              <div className="sm:col-span-2">
                <Field label="입금계좌" value={editing.bank_account} onChange={v => setEditing(p => ({ ...p, bank_account: v }))}
                  placeholder="국민 000000-00-000000 (예금주)" />
              </div>

              <div className="sm:col-span-2">
                <span className={LABEL}>직인 이미지</span>
                <div className="flex items-center gap-3">
                  {editing.stamp_path && editingStamp ? (
                    <Image src={editingStamp} alt="직인 미리보기" width={56} height={56}
                      className="rounded-lg border border-gray-200 object-contain dark:border-gray-800" unoptimized />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-gray-200 text-xs text-gray-500 dark:border-gray-800">없음</div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadStamp(f); e.target.value = '' }} />
                  <button onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                    <Upload className="h-4 w-4" />이미지 올리기
                  </button>
                  {editing.stamp_path && (
                    <button onClick={() => { setEditing(p => ({ ...p, stamp_path: null })); setEditingStamp(null) }}
                      className="text-xs text-gray-500 hover:text-red-600">
                      제거
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">배경이 투명한 PNG를 쓰면 견적서에 깔끔하게 찍힙니다. (2MB 이하)</p>
              </div>

              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor="c-notes">기본 특기사항</label>
                <textarea id="c-notes" rows={4} value={editing.default_notes ?? ''}
                  onChange={e => setEditing(p => ({ ...p, default_notes: e.target.value }))}
                  placeholder={'- 상기 금액은 부가세 별도입니다.\n- 자재 변경 시 단가가 조정될 수 있습니다.'}
                  className={`${FIELD} resize-y font-mono text-xs leading-relaxed`} />
                <p className="mt-1 text-xs text-gray-500">이 회사로 새 견적을 만들면 특기사항에 자동으로 들어갑니다.</p>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                취소
              </button>
              <button onClick={save} disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Line({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null
  return (
    <div className="flex gap-2">
      <dt className="w-14 shrink-0">{k}</dt>
      <dd className="flex-1 text-gray-700 dark:text-gray-300">{v}</dd>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: {
  label: string
  value: string | null | undefined
  onChange: (v: string) => void
  placeholder?: string
}) {
  const id = `cf-${label.replace(/\s|\*/g, '')}`
  return (
    <div>
      <label className={LABEL} htmlFor={id}>{label}</label>
      <input id={id} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={FIELD} />
    </div>
  )
}
