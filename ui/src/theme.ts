/* Theme (dark default) persisted to localStorage; applied as data-theme on <html>. */
import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'hadr-theme'

function initial(): Theme {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
  return saved === 'light' ? 'light' : 'dark'
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initial)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return [theme, toggle]
}
