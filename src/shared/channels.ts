// Kept free of runtime imports so the sandboxed preload can bundle it without pulling in zod.
export const Channels = {
  getState: 'flacon:get-state',
  setTheme: 'flacon:set-theme',
  island: 'flacon:island',
  state: 'flacon:state',
  // playback: UI → main (commands), main → UI (state)
  playbackCommand: 'flacon:playback-command',
  playbackState: 'flacon:playback-state',
  getPlayback: 'flacon:get-playback',
  openFiles: 'flacon:open-files',
  // engine window ↔ main
  engineCommand: 'flacon:engine-command',
  engineState: 'flacon:engine-state',
  decoderPort: 'flacon:decoder-port',
  // library
  libraryAlbums: 'flacon:library-albums',
  librarySearch: 'flacon:library-search',
  libraryAddFolder: 'flacon:library-add-folder',
  libraryPlayAlbum: 'flacon:library-play-album',
  libraryGetProgress: 'flacon:library-get-progress',
  libraryProgress: 'flacon:library-progress',
  libraryChanged: 'flacon:library-changed'
} as const
