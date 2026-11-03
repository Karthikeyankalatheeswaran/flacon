import { useStore } from '@/store'

export function Toasts(): JSX.Element {
  const toast = useStore((s) => s.toast)
  return <div className="appToast-wrap" role="status" aria-live="polite">{toast && <div className="appToast">{toast}</div>}</div>
}
