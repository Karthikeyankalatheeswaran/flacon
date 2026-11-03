import { existsSync, renameSync } from 'node:fs'
import Database from 'better-sqlite3'

export type Db = Database.Database

const MIGRATIONS: string[] = [
  // v1
  `
  create table folders (path text primary key);
  create table albums (
    id integer primary key, key text not null unique, title text not null, album_artist text not null,
    year integer not null default 0, art text, tint text not null, quality text not null,
    ceiling real not null default 0, minutes integer not null default 0, track_count integer not null default 0,
    added_at integer not null, offline integer not null default 0
  );
  create table tracks (
    id integer primary key, path text not null unique, size integer not null, mtime integer not null,
    title text not null, artist text not null, album_artist text not null, album text not null, composer text not null default '',
    album_id integer not null references albums(id) on delete cascade,
    disc integer not null default 0, disc_total integer not null default 0, track integer not null default 0, track_total integer not null default 0,
    year integer not null default 0, genre text not null default '', duration real not null default 0,
    sample_rate integer not null default 0, bit_depth integer, channels integer not null default 2, codec text not null default '',
    lossless integer not null default 0, quality text not null, play_count integer not null default 0,
    added_at integer not null, missing integer not null default 0
  );
  create index tracks_album on tracks(album_id, disc, track);
  create index tracks_match on tracks(size, title, album);
  create virtual table tracks_fts using fts5(title, artist, album, composer, tokenize = 'unicode61 remove_diacritics 2');
  `,
  // v2: CUE sheets — a track may be a slice [cue_start, cue_end) of an audio file (path is then a virtual path, see shared/cue.ts)
  `
  alter table tracks add column cue_start real;
  alter table tracks add column cue_end real;
  `
]

/**
 * Open the library DB. A corrupt file is moved aside (never deleted) and replaced with a fresh one;
 * `recovered` tells the caller to notify the user and rescan.
 */
export function openDb(path: string): { db: Db; recovered: string | null } {
  let recovered: string | null = null
  const attempt = (): Db => {
    const db = new Database(path)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('integrity check failed')
    return db
  }
  let db: Db
  try {
    db = attempt()
  } catch {
    if (existsSync(path)) {
      recovered = `${path}.corrupt-${Date.now()}`
      renameSync(path, recovered)
    }
    db = attempt()
  }
  migrate(db)
  return { db, recovered }
}

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}
