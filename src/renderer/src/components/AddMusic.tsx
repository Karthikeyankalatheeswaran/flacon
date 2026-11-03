import { useStore } from '@/store'
import { Icon } from './icons'

/** The one place to bring music in: folder (kept and scanned) or loose files (played now). Also accepts drops anywhere. */
export function AddMusic({ primary = false }: { primary?: boolean }): JSX.Element {
  const addFolder = useStore((s) => s.addFolder)
  const openFiles = useStore((s) => s.openFiles)
  return (
    <span className="add-music">
      <button type="button" className={primary ? 'primary' : 'ghost-btn'} onClick={() => void addFolder()}>
        <Icon name="plus" size={16} /> Add music folder
      </button>
      <button type="button" className="ghost-btn" onClick={() => void openFiles()}>Play files…</button>
    </span>
  )
}
