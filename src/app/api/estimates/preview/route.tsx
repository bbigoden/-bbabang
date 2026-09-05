/**
 * 저장하지 않고 미리보기만 그린다.
 *
 * 화면에서 단가를 만질 때마다 저장을 눌러야 미리보기가 따라오는 게 번거로웠다.
 * 여기는 화면이 보낸 값을 그대로 렌더해 돌려줄 뿐 DB 는 건드리지 않는다.
 * 자기가 보낸 내용을 자기가 돌려받는 구조라 남의 자료가 샐 일은 없다.
 *
 * 직인만 서버에서 붙인다 — 경로(stamp_path)는 화면이 보내지만, 서명 URL 은
 * 로그인한 본인의 권한으로 만들어야 하기 때문.
 */

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { EstimateDocument } from '@/lib/estimate-pdf'
import { checkRateLimit } from '@/lib/rate-limit'
import type { Estimate, EstimateCompany, EstimateItem } from '@/lib/estimate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STAMP_BUCKET = 'estimate-stamps'

interface Body {
  estimate?: Estimate
  items?: EstimateItem[]
  company?: Partial<EstimateCompany> | null
}

export async function POST(req: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

  // 입력을 멈출 때마다 도는 자리라 렌더가 몰리지 않게만 막는다 (넉넉히)
  if (!await checkRateLimit(`user:${user.id}:estimate-preview`, 120, 60)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const { estimate, items, company }: Body = await req.json().catch(() => ({}))
  if (!estimate) return NextResponse.json({ error: '내용이 없습니다' }, { status: 400 })

  let stampUrl: string | null = null
  if (company?.stamp_path) {
    const { data } = await supabase.storage
      .from(STAMP_BUCKET).createSignedUrl(company.stamp_path, 120)
    stampUrl = data?.signedUrl ?? null
  }

  const buffer = await renderToBuffer(
    <EstimateDocument
      estimate={estimate}
      items={items ?? []}
      company={company ?? null}
      stampUrl={stampUrl}
    />
  )

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store',
    },
  })
}
