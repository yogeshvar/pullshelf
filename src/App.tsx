import { useEffect } from 'react'
import { Shelf } from './shelf/Shelf'

export function App() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A menu or field that just used this Escape should not also hide the shelf.
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement && target.classList.contains('xterm-helper-textarea')) return
      window.pullshelf.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <Shelf />
}
