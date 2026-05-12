'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Plus, FileText, Trash2, ChevronLeft, Save, Calendar } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface DiaryEntry {
  id: string
  title: string
  content: string
  date: string
  created_at: string
  updated_at: string
}

function formatDisplayDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function BrokerDiaryPage() {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const router = useRouter()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [selected, setSelected] = useState<DiaryEntry | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [date, setDate] = useState(todayStr())
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    init()
  }, [])

  const init = async () => {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { router.push('/auth/login'); return }
    setUser(u)
    const { data: bp } = await supabase.from('broker_profiles').select('*').eq('user_id', u.id).single()
    if (!bp) { router.push('/dashboard/broker'); return }
    setBroker(bp)
    await loadEntries(bp.id)
    setLoading(false)
  }

  const loadEntries = async (brokerId: string) => {
    const { data } = await supabase
      .from('broker_diary')
      .select('*')
      .eq('broker_id', brokerId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    setEntries(data ?? [])
    return data ?? []
  }

  const selectEntry = (entry: DiaryEntry) => {
    setSelected(entry)
    setTitle(entry.title)
    setContent(entry.content)
    setDate(entry.date)
    setSaveStatus('saved')
  }

  const newEntry = async () => {
    if (!broker) return
    const { data } = await supabase.from('broker_diary').insert({
      broker_id: broker.id,
      title: '',
      content: '',
      date: todayStr(),
    }).select().single()
    if (!data) return
    setEntries(prev => [data, ...prev])
    selectEntry(data)
    setTimeout(() => contentRef.current?.focus(), 50)
  }

  // 자동 저장 (디바운스 1.5초)
  const triggerSave = useCallback((newTitle: string, newContent: string, newDate: string) => {
    setSaveStatus('unsaved')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveEntry(newTitle, newContent, newDate)
    }, 1500)
  }, [selected])

  const saveEntry = async (t: string, c: string, d: string) => {
    if (!selected || !broker) return
    setSaveStatus('saving')
    await supabase.from('broker_diary').update({
      title: t,
      content: c,
      date: d,
      updated_at: new Date().toISOString(),
    }).eq('id', selected.id)
    setEntries(prev => prev.map(e => e.id === selected.id ? { ...e, title: t, content: c, date: d } : e))
    setSaveStatus('saved')
  }

  const handleTitleChange = (v: string) => {
    setTitle(v)
    triggerSave(v, content, date)
  }

  const handleContentChange = (v: string) => {
    setContent(v)
    triggerSave(title, v, date)
  }

  const handleDateChange = (v: string) => {
    setDate(v)
    triggerSave(title, content, v)
  }

  const deleteEntry = async (id: string) => {
    await supabase.from('broker_diary').delete().eq('id', id)
    const next = entries.filter(e => e.id !== id)
    setEntries(next)
    if (selected?.id === id) {
      setSelected(null)
      setTitle(''); setContent(''); setDate(todayStr())
    }
    setDeleteConfirm(null)
  }

  // 텍스트 영역 자동 높이
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-400">불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header user={user} role="broker" />

      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 57px)' }}>

        {/* 사이드바 */}
        <div className={`${sidebarOpen ? 'w-64' : 'w-0'} flex-shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col transition-all duration-200 overflow-hidden`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-bold text-gray-700">업무일지</span>
            <button
              onClick={newEntry}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              새 일지
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {entries.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-gray-400">
                아직 작성된 일지가 없어요
              </div>
            ) : (
              entries.map(entry => (
                <div
                  key={entry.id}
                  onClick={() => selectEntry(entry)}
                  className={`group relative mx-2 mb-1 cursor-pointer rounded-lg px-3 py-2.5 transition-colors ${
                    selected?.id === entry.id
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-gray-100'
                  }`}
                >
                  <p className={`text-sm font-medium truncate ${selected?.id === entry.id ? 'text-blue-700' : 'text-gray-800'}`}>
                    {entry.title || '제목 없음'}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">{entry.date}</p>
                  {entry.content && (
                    <p className="mt-0.5 text-xs text-gray-400 truncate">{entry.content.slice(0, 30)}</p>
                  )}

                  {/* 삭제 버튼 */}
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteConfirm(entry.id) }}
                    className="absolute right-2 top-2 hidden group-hover:flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 메인 에디터 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
                <FileText className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-lg font-semibold text-gray-600">일지를 선택하거나 새로 작성하세요</p>
              <p className="mt-1 text-sm text-gray-400">업무 내용, 메모, 할 일을 자유롭게 기록하세요</p>
              <button
                onClick={newEntry}
                className="mt-6 flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                새 일지 작성
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {/* 에디터 헤더 */}
              <div className="flex items-center justify-between border-b border-gray-100 px-6 py-3">
                <button
                  onClick={() => setSidebarOpen(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <ChevronLeft className={`h-4 w-4 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} />
                  {sidebarOpen ? '사이드바 닫기' : '사이드바 열기'}
                </button>
                <div className="flex items-center gap-3">
                  {saveStatus === 'saving' && (
                    <span className="text-xs text-gray-400">저장 중...</span>
                  )}
                  {saveStatus === 'unsaved' && (
                    <span className="text-xs text-orange-400">저장 안됨</span>
                  )}
                  {saveStatus === 'saved' && (
                    <span className="flex items-center gap-1 text-xs text-green-500">
                      <Save className="h-3 w-3" /> 저장됨
                    </span>
                  )}
                </div>
              </div>

              {/* 날짜 */}
              <div className="flex items-center gap-2 px-10 pt-8 pb-2">
                <Calendar className="h-4 w-4 text-gray-300" />
                <input
                  type="date"
                  value={date}
                  onChange={e => handleDateChange(e.target.value)}
                  className="text-sm text-gray-400 border-none outline-none bg-transparent cursor-pointer hover:text-gray-600"
                />
              </div>

              {/* 제목 */}
              <div className="px-10 pt-2 pb-4">
                <textarea
                  value={title}
                  onChange={e => { handleTitleChange(e.target.value); autoResize(e.target) }}
                  placeholder="제목을 입력하세요"
                  rows={1}
                  className="w-full resize-none border-none outline-none text-3xl font-bold text-gray-900 placeholder-gray-200 bg-transparent leading-tight overflow-hidden"
                  style={{ minHeight: '44px' }}
                  onInput={e => autoResize(e.currentTarget)}
                />
              </div>

              {/* 구분선 */}
              <div className="mx-10 border-t border-gray-100 mb-6" />

              {/* 본문 */}
              <div className="px-10 pb-32">
                <textarea
                  ref={contentRef}
                  value={content}
                  onChange={e => { handleContentChange(e.target.value); autoResize(e.target) }}
                  placeholder="내용을 입력하세요..."
                  className="w-full resize-none border-none outline-none text-base text-gray-700 placeholder-gray-300 bg-transparent leading-relaxed overflow-hidden"
                  style={{ minHeight: '400px' }}
                  onInput={e => autoResize(e.currentTarget)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 삭제 확인 모달 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">일지를 삭제할까요?</h3>
            <p className="text-sm text-gray-500 mb-6">삭제하면 복구할 수 없어요.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >취소</button>
              <button
                onClick={() => deleteEntry(deleteConfirm)}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600"
              >삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
