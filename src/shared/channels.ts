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
  librarySongs: 'flacon:library-songs',
  libraryAddFolder: 'flacon:library-add-folder',
  libraryPlayAlbum: 'flacon:library-play-album',
  libraryGetProgress: 'flacon:library-get-progress',
  libraryProgress: 'flacon:library-progress',
  libraryChanged: 'flacon:library-changed',
  libraryFolders: 'flacon:library-folders',
  libraryRemoveFolder: 'flacon:library-remove-folder',
  settingsGet: 'flacon:settings-get',
  settingsSet: 'flacon:settings-set',
  // fetcher
  fetchSearch: 'flacon:fetch-search',
  fetchEnqueue: 'flacon:fetch-enqueue',
  fetchControl: 'flacon:fetch-control',
  fetchGet: 'flacon:fetch-get',
  fetchState: 'flacon:fetch-state',
  fetchSettingsGet: 'flacon:fetch-settings-get',
  fetchSettingsSet: 'flacon:fetch-settings-set'
} as const
