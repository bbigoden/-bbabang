/**
 * 견적서 PDF 문서 (@react-pdf/renderer).
 * 서버 라우트에서만 import 한다 — 한글 폰트를 파일시스템에서 읽기 때문.
 */

import path from 'path'
import {
  Document, Page, Text, View, Image, StyleSheet, Font,
} from '@react-pdf/renderer'
import {
  fmtComma, koreanAmount, validUntil,
  type Estimate, type EstimateCompany, type EstimateItem,
} from './estimate'

const FONT_DIR = path.join(process.cwd(), 'public', 'fonts')

Font.register({
  family: 'NanumGothic',
  fonts: [
    { src: path.join(FONT_DIR, 'NanumGothic-Regular.ttf'), fontWeight: 'normal' },
    { src: path.join(FONT_DIR, 'NanumGothic-Bold.ttf'), fontWeight: 'bold' },
  ],
})

// 한글은 단어 사이 공백이 없어 긴 문장이 셀 밖으로 넘친다.
// 글자 단위로 끊어 줄바꿈되도록 한다.
Font.registerHyphenationCallback(word =>
  /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(word) ? word.split('') : [word]
)

const C = {
  line: '#d4d4d8',
  lineStrong: '#3f3f46',
  head: '#f4f4f5',
  sub: '#71717a',
  text: '#18181b',
  accent: '#14274e',
}

const s = StyleSheet.create({
  page: {
    fontFamily: 'NanumGothic',
    fontSize: 8,
    color: C.text,
    paddingTop: 32,
    paddingBottom: 44,
    paddingHorizontal: 32,
  },

  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', letterSpacing: 8, marginBottom: 4 },
  titleRule: { borderBottomWidth: 2, borderBottomColor: C.lineStrong, width: 120, alignSelf: 'center', marginBottom: 12 },

  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 },
  metaText: { fontSize: 8, color: C.sub },

  cols: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  col: { flex: 1 },

  boxTitle: { fontSize: 8, fontWeight: 'bold', color: C.sub, marginBottom: 3 },
  box: { borderWidth: 1, borderColor: C.line, borderRadius: 2, padding: 7 },

  kv: { flexDirection: 'row', marginBottom: 2.5 },
  k: { width: 46, color: C.sub },
  v: { flex: 1 },

  toName: { fontSize: 12, fontWeight: 'bold', marginBottom: 5 },

  stampWrap: { position: 'absolute', right: 6, bottom: 6, width: 46, height: 46 },
  stamp: { width: 46, height: 46, objectFit: 'contain' },

  totalBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: C.accent, borderRadius: 2,
    paddingVertical: 8, paddingHorizontal: 12, marginBottom: 10,
  },
  totalLabel: { fontSize: 9, fontWeight: 'bold', color: C.accent },
  totalKor: { fontSize: 12, fontWeight: 'bold' },
  totalNum: { fontSize: 12, fontWeight: 'bold', color: C.accent },

  overview: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: C.line, marginBottom: 10 },
  ovCell: { flexDirection: 'row', width: '50%', borderBottomWidth: 0.5, borderBottomColor: C.line },
  ovK: { width: 62, backgroundColor: C.head, paddingVertical: 4, paddingHorizontal: 6, color: C.sub, fontWeight: 'bold' },
  ovV: { flex: 1, paddingVertical: 4, paddingHorizontal: 6 },

  th: { flexDirection: 'row', backgroundColor: C.head, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.lineStrong },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.line },
  trHead: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.line, backgroundColor: '#fafafa' },
  cell: { paddingVertical: 4, paddingHorizontal: 4 },
  cellHead: { paddingVertical: 4, paddingHorizontal: 4, fontWeight: 'bold', textAlign: 'center' },

  sumWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  sumTable: { width: 220 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 6 },
  sumRowLast: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 5, paddingHorizontal: 6,
    borderTopWidth: 1, borderTopColor: C.lineStrong, marginTop: 2,
  },

  notes: { marginTop: 14, borderWidth: 1, borderColor: C.line, borderRadius: 2, padding: 8 },
  notesTitle: { fontWeight: 'bold', marginBottom: 4, color: C.sub },
  notesBody: { lineHeight: 1.6 },

  footer: {
    position: 'absolute', bottom: 20, left: 32, right: 32,
    flexDirection: 'row', justifyContent: 'space-between',
    fontSize: 7, color: C.sub,
    borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 5,
  },
})

// 내역 테이블 컬럼 폭 (합 531pt = A4 폭 - 좌우 여백)
const W = { no: 24, cat: 70, name: 130, spec: 70, unit: 30, qty: 36, price: 60, amount: 70, remark: 41 }

const A = { right: 'right' as const, center: 'center' as const }

interface Props {
  estimate: Estimate
  items: EstimateItem[]
  company: Partial<EstimateCompany> | null
}

export function EstimateDocument({ estimate: e, items, company }: Props) {
  const rows = items.filter(it => it.is_header || it.name || it.amount)

  return (
    <Document
      title={`견적서_${e.estimate_no}`}
      author={company?.name ?? ''}
      subject={e.project_name ?? '견적서'}
    >
      <Page size="A4" style={s.page}>
        <Text style={s.title}>견 적 서</Text>
        <View style={s.titleRule} />

        <View style={s.metaRow}>
          <Text style={s.metaText}>견적번호 {e.estimate_no}    발행일 {e.issue_date}</Text>
        </View>

        {/* 수신 / 공급자 */}
        <View style={s.cols}>
          <View style={s.col}>
            <Text style={s.boxTitle}>수 신</Text>
            <View style={[s.box, { minHeight: 96 }]}>
              <Text style={s.toName}>{e.client_name || ''} 귀중</Text>
              {e.client_contact ? (
                <View style={s.kv}><Text style={s.k}>담당자</Text><Text style={s.v}>{e.client_contact}</Text></View>
              ) : null}
              {e.client_phone ? (
                <View style={s.kv}><Text style={s.k}>연락처</Text><Text style={s.v}>{e.client_phone}</Text></View>
              ) : null}
              {e.site_address ? (
                <View style={s.kv}><Text style={s.k}>현 장</Text><Text style={s.v}>{e.site_address}</Text></View>
              ) : null}
              <Text style={{ marginTop: 8, color: C.sub }}>아래와 같이 견적서를 제출합니다.</Text>
            </View>
          </View>

          <View style={s.col}>
            <Text style={s.boxTitle}>공 급 자</Text>
            <View style={[s.box, { minHeight: 96, position: 'relative' }]}>
              <View style={s.kv}><Text style={s.k}>등록번호</Text><Text style={s.v}>{company?.biz_no ?? ''}</Text></View>
              <View style={s.kv}><Text style={s.k}>상  호</Text><Text style={[s.v, { fontWeight: 'bold' }]}>{company?.name ?? ''}</Text></View>
              <View style={s.kv}><Text style={s.k}>대표자</Text><Text style={s.v}>{company?.ceo ?? ''}</Text></View>
              <View style={s.kv}><Text style={s.k}>소재지</Text><Text style={s.v}>{company?.address ?? ''}</Text></View>
              <View style={s.kv}><Text style={s.k}>업태/종목</Text><Text style={s.v}>{[company?.biz_type, company?.biz_item].filter(Boolean).join(' / ')}</Text></View>
              <View style={s.kv}><Text style={s.k}>연락처</Text><Text style={s.v}>{[company?.phone, company?.fax ? `FAX ${company.fax}` : ''].filter(Boolean).join('  ')}</Text></View>
              {company?.email ? (
                <View style={s.kv}><Text style={s.k}>이메일</Text><Text style={s.v}>{company.email}</Text></View>
              ) : null}
              {company?.stamp_url ? (
                <View style={s.stampWrap}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image src={company.stamp_url} style={s.stamp} />
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* 합계 금액 */}
        <View style={s.totalBox}>
          <Text style={s.totalLabel}>합계금액</Text>
          <Text style={s.totalKor}>{koreanAmount(e.total)}</Text>
          <Text style={s.totalNum}>₩{fmtComma(e.total)}</Text>
        </View>

        {/* 공사 개요 */}
        <View style={s.overview}>
          <View style={s.ovCell}><Text style={s.ovK}>공사명</Text><Text style={s.ovV}>{e.project_name ?? ''}</Text></View>
          <View style={s.ovCell}><Text style={s.ovK}>공사기간</Text><Text style={s.ovV}>{e.period ?? ''}</Text></View>
          <View style={[s.ovCell, { borderBottomWidth: 0 }]}><Text style={s.ovK}>유효기간</Text>
            <Text style={s.ovV}>{e.issue_date} ~ {validUntil(e.issue_date, e.valid_days)} ({e.valid_days}일)</Text>
          </View>
          <View style={[s.ovCell, { borderBottomWidth: 0 }]}><Text style={s.ovK}>결제조건</Text><Text style={s.ovV}>{e.payment_terms ?? ''}</Text></View>
        </View>

        {/* 내역 — 페이지가 넘어가도 머리글 반복 */}
        <View style={s.th} fixed>
          <Text style={[s.cellHead, { width: W.no }]}>No</Text>
          <Text style={[s.cellHead, { width: W.cat }]}>공종</Text>
          <Text style={[s.cellHead, { width: W.name }]}>품명</Text>
          <Text style={[s.cellHead, { width: W.spec }]}>규격</Text>
          <Text style={[s.cellHead, { width: W.unit }]}>단위</Text>
          <Text style={[s.cellHead, { width: W.qty }]}>수량</Text>
          <Text style={[s.cellHead, { width: W.price }]}>단가</Text>
          <Text style={[s.cellHead, { width: W.amount }]}>금액</Text>
          <Text style={[s.cellHead, { width: W.remark }]}>비고</Text>
        </View>

        {rows.map((it, i, arr) => {
          // 표시용 번호는 공종 구분줄을 빼고 센다
          const no = arr.slice(0, i + 1).filter(r => !r.is_header).length
          return it.is_header ? (
            <View key={i} style={s.trHead} wrap={false}>
              <Text style={[s.cell, { width: W.no }]}> </Text>
              <Text style={[s.cell, { flex: 1, fontWeight: 'bold' }]}>{it.name ?? it.category ?? ''}</Text>
            </View>
          ) : (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={[s.cell, { width: W.no, textAlign: A.center, color: C.sub }]}>{no}</Text>
              <Text style={[s.cell, { width: W.cat }]}>{it.category ?? ''}</Text>
              <Text style={[s.cell, { width: W.name }]}>{it.name ?? ''}</Text>
              <Text style={[s.cell, { width: W.spec }]}>{it.spec ?? ''}</Text>
              <Text style={[s.cell, { width: W.unit, textAlign: A.center }]}>{it.unit ?? ''}</Text>
              <Text style={[s.cell, { width: W.qty, textAlign: A.right }]}>{trimNum(it.qty)}</Text>
              <Text style={[s.cell, { width: W.price, textAlign: A.right }]}>{fmtComma(it.unit_price)}</Text>
              <Text style={[s.cell, { width: W.amount, textAlign: A.right, fontWeight: 'bold' }]}>{fmtComma(it.amount)}</Text>
              <Text style={[s.cell, { width: W.remark }]}>{it.remark ?? ''}</Text>
            </View>
          )
        })}

        {/* 정산 */}
        <View style={s.sumWrap} wrap={false}>
          <View style={s.sumTable}>
            <SumRow label="소　계" value={e.subtotal} />
            {e.overhead_amount > 0 && <SumRow label={`경비 (${(e.overhead_rate * 100).toFixed(1)}%)`} value={e.overhead_amount} />}
            {e.discount > 0 && <SumRow label="할　인" value={-e.discount} />}
            <SumRow label="공급가액" value={e.supply_amount} />
            <SumRow label={e.vat_mode === 'none' ? '부가세 (없음)' : '부가세 (10%)'} value={e.vat} />
            <View style={s.sumRowLast}>
              <Text style={{ fontWeight: 'bold', fontSize: 10 }}>합　계</Text>
              <Text style={{ fontWeight: 'bold', fontSize: 10, color: C.accent }}>{fmtComma(e.total)} 원</Text>
            </View>
          </View>
        </View>

        {/* 특기사항 */}
        {(e.notes || company?.bank_account) ? (
          <View style={s.notes} wrap={false}>
            {e.notes ? (
              <>
                <Text style={s.notesTitle}>특기사항</Text>
                <Text style={s.notesBody}>{e.notes}</Text>
              </>
            ) : null}
            {company?.bank_account ? (
              <Text style={[s.notesBody, { marginTop: e.notes ? 6 : 0 }]}>
                <Text style={{ fontWeight: 'bold' }}>입금계좌 </Text>{company.bank_account}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>{company?.name ?? ''}{company?.phone ? `  ${company.phone}` : ''}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

function SumRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.sumRow}>
      <Text style={{ color: C.sub }}>{label}</Text>
      <Text style={{ fontWeight: 'bold' }}>{fmtComma(value)}</Text>
    </View>
  )
}

/** 12.00 → "12",  12.50 → "12.5" */
function trimNum(n: number): string {
  const v = Number(n) || 0
  return Number.isInteger(v) ? fmtComma(v) : String(v).replace(/0+$/, '').replace(/\.$/, '')
}
