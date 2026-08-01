import type { Metadata } from 'next'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { Building2, BedDouble, Car, Compass, CalendarDays } from 'lucide-react'

// 추천 매물 보고서 — 고객이 카톡 링크로 여는 공개 페이지 (로그인 불필요).
// 데이터는 get_shared_report RPC(DEFINER)가 공개 필드만 선별 반환:
// 내부 메모·임대인 연락처·정확한 번지는 서버에서부터 나가지 않는다.
export const dynamic = 'force-dynamic'

interface ReportProperty {
  seq_no: number | null
  deal_type: string | null
  room_type: string | null
  region: string | null
  price: number | null
  monthly_rent: number | null
  management_fee: number | null
  premium: number | null
  size_pyeong: string | null
  area_supplied: number | null
  area_type: string | null
  area_unit: string | null
  floor: number | null
  total_floors: string | null
  options: string[] | null
  images: string[] | null
  move_in_date: string | null
  rooms_bathrooms: string | null
  direction: string | null
  parking: string | null
  approval_date: string | null
  status: string
}

interface Report {
  title: string
  office_name: string | null
  created_at: string
  properties: ReportProperty[]
}

// cache(): generateMetadata와 본문이 같은 요청에서 RPC를 두 번 부르지 않게
// (안 하면 열람 1회가 view_count 2로 잡힘)
const loadReport = cache(async (id: string): Promise<Report | null> => {
  // UUID 형식이 아니면 RPC 호출 자체를 생략 (에러 노이즈 방지)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_shared_report', { p_id: id })
  return (data as Report | null) ?? null
})

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const report = await loadReport(id)
  return {
    title: report ? `${report.title} | ${report.office_name ?? '부소장'}` : '추천 매물',
    robots: { index: false, follow: false },
    openGraph: report ? {
      title: report.title,
      description: `${report.office_name ?? ''} 추천 매물 ${report.properties.length}건`,
      images: report.properties.find(p => p.images?.length)?.images?.slice(0, 1),
    } : undefined,
  }
}

const fmtAmount = (v: number) => {
  if (v >= 10000) {
    const uk = Math.floor(v / 10000)
    const man = v % 10000
    return `${uk}억${man > 0 ? ' ' + man.toLocaleString() + '만' : ''}`
  }
  return `${v.toLocaleString()}만`
}

const fmtPrice = (p: ReportProperty) => {
  const isWolse = (p.deal_type ?? '').includes('월세')
  if (isWolse) return `보증금 ${p.price != null ? fmtAmount(p.price) : '협의'} / 월 ${p.monthly_rent != null ? p.monthly_rent.toLocaleString() + '만' : '협의'}`
  return p.price != null ? fmtAmount(p.price) : '가격 협의'
}

export default async function SharedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const report = await loadReport(id)

  if (!report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="text-center">
          <Building2 className="mx-auto h-10 w-10 text-gray-300" />
          <h1 className="mt-4 text-lg font-bold text-gray-800">보고서를 찾을 수 없어요</h1>
          <p className="mt-2 text-sm text-gray-500">링크가 만료되었거나 잘못된 주소예요.<br />담당 중개사무소에 다시 요청해주세요.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-blue-600 text-white px-5 pt-8 pb-6">
        <div className="mx-auto max-w-lg">
          <p className="text-xs font-semibold text-blue-200">{report.office_name ?? '중개사무소'}</p>
          <h1 className="mt-1 text-xl font-black leading-snug">{report.title}</h1>
          <p className="mt-1.5 text-xs text-blue-200">
            추천 매물 {report.properties.length}건 · {new Date(report.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 작성
          </p>
        </div>
      </div>

      {/* 매물 카드 */}
      <div className="mx-auto max-w-lg px-4 py-5 space-y-4">
        {report.properties.map((p, i) => (
          <div key={i} className="rounded-2xl bg-white border border-gray-100 overflow-hidden shadow-sm">
            {p.images && p.images.length > 0 && (
              <div className="flex gap-1 overflow-x-auto">
                {p.images.slice(0, 4).map((src, j) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={j} src={src} alt={`매물 사진 ${j + 1}`}
                    className={`h-44 object-cover flex-shrink-0 ${p.images!.length === 1 ? 'w-full' : 'w-4/5'}`} />
                ))}
              </div>
            )}
            <div className="p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">{p.deal_type ?? '매물'}</span>
                {p.room_type && <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{p.room_type}</span>}
                {p.status === 'contracted' && <span className="rounded-md bg-gray-200 px-2 py-0.5 text-xs font-bold text-gray-500">계약완료</span>}
              </div>
              <p className="mt-2 text-lg font-black text-gray-900">{fmtPrice(p)}</p>
              {(p.management_fee != null || p.premium != null) && (
                <p className="mt-0.5 text-xs text-gray-500">
                  {p.management_fee != null && `관리비 ${p.management_fee.toLocaleString()}만`}
                  {p.management_fee != null && p.premium != null && ' · '}
                  {p.premium != null && `권리금 ${fmtAmount(p.premium)}`}
                </p>
              )}
              <p className="mt-1.5 text-sm font-medium text-gray-700">{p.region ?? '위치는 문의해주세요'}</p>

              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-gray-600">
                {(p.size_pyeong || p.area_supplied != null) && (
                  <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-gray-400" />
                    {p.size_pyeong ? `${p.size_pyeong}평` : `${p.area_supplied}${p.area_unit ?? 'm²'}`}{p.area_type ? ` (${p.area_type})` : ''}
                  </span>
                )}
                {p.floor != null && (
                  <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-gray-400" />{p.floor}층{p.total_floors ? ` / ${p.total_floors}층` : ''}</span>
                )}
                {p.rooms_bathrooms && (
                  <span className="flex items-center gap-1.5"><BedDouble className="h-3.5 w-3.5 text-gray-400" />방/욕실 {p.rooms_bathrooms}</span>
                )}
                {p.parking && (
                  <span className="flex items-center gap-1.5"><Car className="h-3.5 w-3.5 text-gray-400" />주차 {p.parking}</span>
                )}
                {p.direction && (
                  <span className="flex items-center gap-1.5"><Compass className="h-3.5 w-3.5 text-gray-400" />{p.direction}</span>
                )}
                {p.move_in_date && (
                  <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-gray-400" />입주 {p.move_in_date}</span>
                )}
              </div>

              {p.options && p.options.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.options.map(o => (
                    <span key={o} className="rounded-full bg-gray-50 border border-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{o}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        <p className="pt-2 pb-8 text-center text-xs text-gray-400">
          자세한 위치와 임장 문의는 {report.office_name ?? '담당 중개사무소'}로 연락해주세요.
        </p>
      </div>
    </div>
  )
}
