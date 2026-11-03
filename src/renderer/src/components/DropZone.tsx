import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/store'
import { Icon } from './icons'

const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')

/** Whole-window drop target: music folders join the library, audio files play. In-app drags (albums, queue rows) carry no files and are ignored. */
export function DropZone(): JSX.Element | null {
  const addDropped = useStore((s) => s.addDropped)
  const [over, setOver] = useState(false)
  const depth = useRef(0) // dragenter/leave fire for every child element

  useEffect(() => {
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth.current++
      setOver(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    }
    const overFn = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault() // required for drop to fire
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length) void addDropped(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [addDropped])

  if (!over) return null
  return (
    <div className="dropzone" role="presentation" aria-hidden>
      <div className="dropzone-card">
        <Icon name="plus" size={28} />
        <h2 className="t-title">Drop to add your music</h2>
        <p className="ink-2">Folders join your library. Audio files play right away.</p>
      </div>
    </div>
  )
}
