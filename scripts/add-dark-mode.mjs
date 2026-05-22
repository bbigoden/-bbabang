#!/usr/bin/env node
/**
 * 다크모드 클래스 일괄 추가 (P1-2).
 *
 * 모든 src/app/**\/page.tsx와 src/components/**\/*.tsx에서
 * 자주 쓰이는 라이트 톤 클래스에 dark 변형을 자동 추가한다.
 *
 * 안전 장치:
 *  - 이미 dark: 변형이 같은 className 안에 있으면 건드리지 않음
 *  - bg-white/95 처럼 / suffix가 붙은 건 제외
 *  - text-gray-500 같은 중간 톤은 그대로 (다크에서도 잘 보임)
 */
import fs from 'node:fs'
import path from 'node:path'

// 내장 fs로 재귀 탐색 (glob 의존성 회피)
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full, exts, out)
    else if (exts.some(e => ent.name.endsWith(e))) out.push(full)
  }
  return out
}

const ROOT = path.resolve(process.cwd(), 'src')

// 치환 규칙: [원본 패턴, 추가할 dark 클래스, 라벨]
// 패턴은 단어 경계 + 부정 lookahead로 안전하게.
const RULES = [
  // 배경
  [/(?<![\w-])bg-white(?![\w\/-])(?!.*dark:bg-)/, 'bg-white dark:bg-gray-900', 'bg-white'],
  [/(?<![\w-])bg-gray-50(?![\w\/-])(?!.*dark:bg-)/, 'bg-gray-50 dark:bg-gray-950', 'bg-gray-50'],
  [/(?<![\w-])bg-gray-100(?![\w\/-])(?!.*dark:bg-)/, 'bg-gray-100 dark:bg-gray-800', 'bg-gray-100'],
  // 텍스트
  [/(?<![\w-])text-gray-900(?![\w-])(?!.*dark:text-)/, 'text-gray-900 dark:text-white', 'text-gray-900'],
  [/(?<![\w-])text-gray-800(?![\w-])(?!.*dark:text-)/, 'text-gray-800 dark:text-gray-100', 'text-gray-800'],
  [/(?<![\w-])text-gray-700(?![\w-])(?!.*dark:text-)/, 'text-gray-700 dark:text-gray-300', 'text-gray-700'],
  [/(?<![\w-])text-gray-600(?![\w-])(?!.*dark:text-)/, 'text-gray-600 dark:text-gray-400', 'text-gray-600'],
  // 보더
  [/(?<![\w-])border-gray-200(?![\w-])(?!.*dark:border-)/, 'border-gray-200 dark:border-gray-800', 'border-gray-200'],
  [/(?<![\w-])border-gray-100(?![\w-])(?!.*dark:border-)/, 'border-gray-100 dark:border-gray-800', 'border-gray-100'],
  [/(?<![\w-])border-gray-300(?![\w-])(?!.*dark:border-)/, 'border-gray-300 dark:border-gray-700', 'border-gray-300'],
  // 호버 배경 (인터랙티브 영역)
  [/(?<![\w-])hover:bg-gray-50(?![\w\/-])(?!.*dark:hover:bg-)/, 'hover:bg-gray-50 dark:hover:bg-gray-800', 'hover:bg-gray-50'],
  [/(?<![\w-])hover:bg-gray-100(?![\w\/-])(?!.*dark:hover:bg-)/, 'hover:bg-gray-100 dark:hover:bg-gray-800', 'hover:bg-gray-100'],
]

// className=""(또는 ``) 안의 토큰을 라인 단위로 보고, 같은 클래스 그룹 내에서만 dark 검사
function transformLine(line) {
  // className="..." 또는 className={`...`} 또는 className={'...'} 추출
  const matches = [...line.matchAll(/className=(?:"([^"]*)"|{`([^`]*)`}|{'([^']*)'})/g)]
  if (matches.length === 0) return { line, changed: 0 }

  let newLine = line
  let changed = 0

  for (const m of matches) {
    const original = m[1] ?? m[2] ?? m[3] ?? ''
    let transformed = original

    for (const [pattern, replacement] of RULES) {
      // 같은 className 안에 dark: 변형이 이미 있으면 스킵
      const baseClass = replacement.split(' ')[0]
      const darkClass = replacement.split(' ').slice(1).join(' ')
      // baseClass가 있는데 darkClass가 없으면 추가
      const baseRe = new RegExp(`(?<![\\w-])${baseClass.replace('/', '\\/')}(?![\\w\\/-])`)
      if (baseRe.test(transformed) && !transformed.includes(darkClass)) {
        transformed = transformed.replace(baseRe, `${baseClass} ${darkClass}`)
        changed++
      }
    }

    if (transformed !== original) {
      const quoteStart = m[0].indexOf(original)
      const before = m[0].slice(0, quoteStart)
      const after = m[0].slice(quoteStart + original.length)
      const replacement = before + transformed + after
      newLine = newLine.replace(m[0], replacement)
    }
  }

  return { line: newLine, changed }
}

const targets = [
  ...walk('src/app', ['page.tsx', 'layout.tsx', 'loading.tsx', 'not-found.tsx', 'error.tsx']),
  ...walk('src/components', ['.tsx']),
]

let totalFiles = 0
let totalChanges = 0
const report = []

for (const file of targets) {
  const abs = path.resolve(file)
  const src = fs.readFileSync(abs, 'utf8')
  const lines = src.split('\n')
  let fileChanges = 0
  const newLines = lines.map(line => {
    const { line: newLine, changed } = transformLine(line)
    fileChanges += changed
    return newLine
  })
  if (fileChanges > 0) {
    fs.writeFileSync(abs, newLines.join('\n'), 'utf8')
    totalFiles++
    totalChanges += fileChanges
    report.push(`${file}: ${fileChanges}`)
  }
}

console.error(`다크모드 변환 완료: ${totalFiles}개 파일, ${totalChanges}건 치환`)
for (const r of report.slice(0, 30)) console.error(`  ${r}`)
if (report.length > 30) console.error(`  ... 외 ${report.length - 30}개`)
