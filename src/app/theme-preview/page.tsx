'use client'

const TONES = [
  {
    key: 'slate-950',
    name: '잘톤 (slate-950)',
    desc: '거의 검정. 극도로 진한 다크네이비. 명소 다크모드 느낌.',
    primary: '#020617',
    hover: '#0f172a',
    ring: '#1e293b',
    bgLight: '#f1f5f9',
    textOnLight: '#020617',
  },
  {
    key: 'slate-900',
    name: '딥네이비 (slate-900)',
    desc: '검정에 가장 가까운 실용 네이비. 고급 금융·사무소 톤. 가장 추천.',
    primary: '#0f172a',
    hover: '#1e293b',
    ring: '#334155',
    bgLight: '#f1f5f9',
    textOnLight: '#0f172a',
  },
  {
    key: 'blue-950',
    name: '잘키 네이비 (blue-950)',
    desc: '검정보다 파랑이 살아있어 포인트·링크가 잘 보임.',
    primary: '#172554',
    hover: '#1e3a8a',
    ring: '#1e40af',
    bgLight: '#eff6ff',
    textOnLight: '#172554',
  },
  {
    key: 'blue-900',
    name: '정통 네이비 (blue-900)',
    desc: '해군·정장 느낌의 전통 남색. 채도가 남아 \'파란색\'이라는 게 느껴짐.',
    primary: '#1e3a8a',
    hover: '#1e40af',
    ring: '#3b82f6',
    bgLight: '#dbeafe',
    textOnLight: '#1e3a8a',
  },

  // ─── 옵션 3 (#172554) 주변 톤들 ───
  {
    key: 'indigo-950',
    name: '잉크 네이비 (indigo-950)',
    desc: '옵션 3보다 보라 기운 살짝 추가. 더 차분·고급, 살짝 럭셔리한 느낌.',
    primary: '#1e1b4b',
    hover: '#312e81',
    ring: '#4338ca',
    bgLight: '#eef2ff',
    textOnLight: '#1e1b4b',
  },
  {
    key: 'midnight',
    name: '미드나잇 (#0a1929)',
    desc: 'MUI 다크 블루. 옵션 3보다 한 단계 더 어둡고 파랑이 깊음. 미니멀·기술 톤.',
    primary: '#0a1929',
    hover: '#0f2845',
    ring: '#1e3a8a',
    bgLight: '#e7eef7',
    textOnLight: '#0a1929',
  },
  {
    key: 'oxford',
    name: '옥스퍼드 블루 (#14213d)',
    desc: '명품·금융 브랜드가 자주 쓰는 \'옥스퍼드 블루\'. 옵션 3보다 살짝 채도 낮고 안정적.',
    primary: '#14213d',
    hover: '#1d3557',
    ring: '#2c5282',
    bgLight: '#e8ecf3',
    textOnLight: '#14213d',
  },
  {
    key: 'royal-deep',
    name: '딥 로얄 (#1a237e)',
    desc: '머터리얼 indigo-900. 옵션 3보다 채도가 진해 \'로얄 블루\' 느낌. 화려·자신감 톤.',
    primary: '#1a237e',
    hover: '#283593',
    ring: '#3949ab',
    bgLight: '#e8eaf6',
    textOnLight: '#1a237e',
  },
]

export default function ThemePreviewPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-gray-900">다크네이비 미리보기</h1>
        <p className="text-sm text-gray-600 mb-6">
          4가지 톤을 실제 빠방 UI 요소(버튼·카드·링크·뱃지)에 입혀 비교합니다. 마음에 드는 톤 번호를 알려주세요.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {TONES.map((t, idx) => (
            <div key={t.key} className="bg-white rounded-2xl shadow-md overflow-hidden border border-gray-200">
              {/* 색상 헤더 */}
              <div
                className="px-6 py-5 text-white"
                style={{ backgroundColor: t.primary }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs opacity-80 mb-1">옵션 {idx + 1}</div>
                    <div className="text-xl font-bold">{t.name}</div>
                  </div>
                  <div className="text-right text-xs font-mono opacity-90">
                    <div>{t.primary}</div>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                <p className="text-sm text-gray-700">{t.desc}</p>

                {/* 버튼 샘플 */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-2">버튼</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
                      style={{ backgroundColor: t.primary }}
                      onMouseOver={(e) => (e.currentTarget.style.backgroundColor = t.hover)}
                      onMouseOut={(e) => (e.currentTarget.style.backgroundColor = t.primary)}
                    >
                      매물 등록
                    </button>
                    <button
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors"
                      style={{ borderColor: t.primary, color: t.primary }}
                    >
                      취소
                    </button>
                    <button
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                      style={{ backgroundColor: t.bgLight, color: t.textOnLight }}
                    >
                      보조 버튼
                    </button>
                  </div>
                </div>

                {/* 링크 + 텍스트 */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-2">텍스트·링크</div>
                  <p className="text-sm text-gray-800">
                    안녕하세요, <span style={{ color: t.primary, fontWeight: 600 }}>김용유</span>님.
                    <span className="mx-1">·</span>
                    <a style={{ color: t.primary, textDecoration: 'underline' }} href="#">정산 내역 보기</a>
                  </p>
                </div>

                {/* 뱃지 */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-2">뱃지·태그</div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className="px-2.5 py-1 rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: t.primary }}
                    >
                      진행중
                    </span>
                    <span
                      className="px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: t.bgLight, color: t.textOnLight }}
                    >
                      신규
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                      완료
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                      대기
                    </span>
                  </div>
                </div>

                {/* 미니 카드 (사이드바/헤더 느낌) */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-2">상단바·사이드바</div>
                  <div className="rounded-xl overflow-hidden border border-gray-200">
                    <div
                      className="px-4 py-3 text-white text-sm font-semibold flex items-center justify-between"
                      style={{ backgroundColor: t.primary }}
                    >
                      <span>빠방 · 플러스불당</span>
                      <span className="text-xs opacity-80">대표</span>
                    </div>
                    <div className="bg-white p-3 text-xs text-gray-600 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.primary }} />
                        <span style={{ color: t.primary, fontWeight: 600 }}>대시보드</span>
                      </div>
                      <div className="flex items-center gap-2 pl-3">
                        <span>매물 관리</span>
                      </div>
                      <div className="flex items-center gap-2 pl-3">
                        <span>정산</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 포커스 링 데모 */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-2">입력창 포커스</div>
                  <input
                    type="text"
                    placeholder="클릭해서 포커스 링 확인"
                    className="w-full px-3 py-2.5 rounded-lg border-2 border-gray-200 text-sm outline-none transition-colors"
                    onFocus={(e) => (e.currentTarget.style.borderColor = t.primary)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = '#e5e7eb')}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 p-5 rounded-xl bg-white border border-gray-200 text-sm text-gray-700">
          <div className="font-semibold text-gray-900 mb-2">고르는 법</div>
          <ul className="list-disc list-inside space-y-1">
            <li><b>옵션 1 (잘톤)</b> — 사실상 검정. 차분·시크 끝판왕이지만 &lsquo;네이비 같지 않다&rsquo;는 인상 가능.</li>
            <li><b>옵션 2 (딥네이비)</b> — 검정 느낌 + 약간의 파랑. 가장 실용적·고급스러움. <b>일반 추천</b>.</li>
            <li><b>옵션 3 (잘키 네이비)</b> — 어둡지만 &lsquo;파랑&rsquo; 식별성이 좋음. 링크·뱃지 가독성 ↑.</li>
            <li><b>옵션 4 (정통 네이비)</b> — 전통 남색. 가장 &lsquo;파랑&rsquo;스러움. 다크네이비 중에선 가장 밝음.</li>
          </ul>
          <div className="mt-3 text-gray-600">
            결정되면 <code className="bg-gray-100 px-1.5 py-0.5 rounded">옵션 2</code> 처럼 알려주세요. 전 페이지의 blue-600 계열을 일괄 교체합니다.
          </div>
        </div>
      </div>
    </div>
  )
}
