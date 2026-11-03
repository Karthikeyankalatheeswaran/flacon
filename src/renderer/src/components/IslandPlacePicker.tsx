import type { AppSettings } from '@shared/ipc'
import { useStore } from '@/store'

type Edge = AppSettings['islandEdge']
type Align = AppSettings['islandAlign']
const EDGES: Edge[] = ['top', 'bottom']
const ALIGNS: Align[] = ['left', 'center', 'right']
const NAME: Record<Align, string> = { left: 'left', center: 'centre', right: 'right' }

/** Where the island sits, shown on a miniature screen: the black pill previews the chosen spot live. */
export function IslandPlacePicker(): JSX.Element | null {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  if (!settings) return null
  return (
    <div role="radiogroup" aria-label="Island position" className="place">
      <div className="place-screen" aria-hidden>
        <span className="place-pill" data-edge={settings.islandEdge} data-align={settings.islandAlign} />
      </div>
      {EDGES.flatMap((edge) => ALIGNS.map((align) => {
        const on = settings.islandEdge === edge && settings.islandAlign === align
        return (
          <button key={`${edge}-${align}`} type="button" role="radio" aria-checked={on} className="place-spot" data-edge={edge} data-align={align}
            aria-label={`${edge === 'top' ? 'Top' : 'Bottom'} ${NAME[align]}`} title={`${edge === 'top' ? 'Top' : 'Bottom'} ${NAME[align]}`}
            onClick={() => void update({ islandEdge: edge, islandAlign: align })} />
        )
      }))}
    </div>
  )
}
