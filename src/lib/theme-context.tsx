'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'
type FontSize = 'sm' | 'md' | 'lg' | 'xl'

interface State {
  theme: Theme
  setTheme: (t: Theme) => void
  fontSize: FontSize
  setFontSize: (s: FontSize) => void
}

const Ctx = createContext<State | null>(null)
const THEME_KEY = 'bbabang_theme'
const FONT_KEY = 'bbabang_font_size'

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  let effective: 'light' | 'dark'
  if (theme === 'system') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } else {
    effective = theme
  }
  root.classList.toggle('dark', effective === 'dark')
}

function applyFontSize(size: FontSize) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  ;(['font-sm', 'font-md', 'font-lg', 'font-xl'] as const).forEach(c => root.classList.remove(c))
  root.classList.add(`font-${size}`)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')
  const [fontSize, setFontSizeState] = useState<FontSize>('md')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const savedTheme = (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'system'
    const savedFont = (localStorage.getItem(FONT_KEY) as FontSize | null) ?? 'md'
    setThemeState(savedTheme)
    setFontSizeState(savedFont)
    applyTheme(savedTheme)
    applyFontSize(savedFont)

    // system 선택 시 OS 변경 감지
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (localStorage.getItem(THEME_KEY) === 'system' || !localStorage.getItem(THEME_KEY)) {
        applyTheme('system')
      }
    }
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem(THEME_KEY, t)
    applyTheme(t)
  }
  const setFontSize = (s: FontSize) => {
    setFontSizeState(s)
    localStorage.setItem(FONT_KEY, s)
    applyFontSize(s)
  }

  return <Ctx.Provider value={{ theme, setTheme, fontSize, setFontSize }}>{children}</Ctx.Provider>
}

export function useTheme(): State {
  const v = useContext(Ctx)
  if (v) return v
  return { theme: 'system', setTheme: () => {}, fontSize: 'md', setFontSize: () => {} }
}
