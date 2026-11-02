// better-sqlite3 is built for Electron's ABI and cannot load under plain Node.
// Node's built-in SQLite runs the app's real SQL instead.
import { DatabaseSync } from 'node:sqlite'

type Statement = {
  run: (...args: never[]) => unknown
  get: (...args: never[]) => unknown
  all: (...args: never[]) => unknown
}

export default class Database {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
  }

  // Same contract as better-sqlite3: rows by default, the first column of the first row with { simple: true }.
  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.db.prepare(`PRAGMA ${source}`).all() as Record<string, unknown>[]
    if (!options.simple) return rows
    const [first] = rows
    return first ? Object.values(first)[0] : undefined
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): Statement {
    const statement = this.db.prepare(sql)
    return {
      run: (...args) => statement.run(...(args as never[])),
      get: (...args) => statement.get(...(args as never[])),
      all: (...args) => statement.all(...(args as never[]))
    }
  }

  close(): void {
    this.db.close()
  }
}
