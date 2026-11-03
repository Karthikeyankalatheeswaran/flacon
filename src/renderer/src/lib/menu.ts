import type { LibrarySong } from '@shared/library'
import type { IconName } from '@/components/icons'

export interface MenuItem {
  label: string
  icon?: IconName
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  /** Draw a divider above this item. */
  divider?: boolean
}

export type SongLike = Pick<LibrarySong, 'path' | 'favorite' | 'offline'> & { title?: string }
