import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tempDir } from '../helpers/tmp'

// The clipboard module keeps its own state, so every test loads a fresh copy.
async function load() {
  vi.resetModules()
  vi.useFakeTimers()
  const mocks = await import('../mocks/electron')
  const clipboardModule = await import('../../electron/clipboard')
  const { openDatabase } = await import('../../electron/db')
  const { attachWebContents } = await import('../../electron/bus')
  const dir = tempDir()
  const db = openDatabase(dir)
  const sent: [string, unknown][] = []
  attachWebContents({ isDestroyed: () => false, send: (c: string, p: unknown) => sent.push([c, p]) } as never)
  const png = (seed = 1) => Buffer.from([seed, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, seed])
  return {
    ...mocks,
    ...clipboardModule,
    db,
    dir,
    sent,
    png,
    /** Let the running poll finish. */
    flush: () => vi.advanceTimersByTimeAsync(0),
    /** Advance one polling interval. */
    tick: () => vi.advanceTimersByTimeAsync(700)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('polling text', () => {
  it('records a new copy right away and announces the list', async () => {
    const c = await load()
    c.electronState.clipboardText = 'hello   world\n  again'
    c.startClipboard(c.db, c.dir)
    await c.flush()
    const [clip] = c.listClips()
    expect(clip).toMatchObject({ kind: 'text', text: 'hello   world\n  again', preview: 'hello world again', favorite: false, thumb: null })
    expect(c.sent.at(-1)).toEqual(['clips:changed', c.listClips()])
    c.stopClipboard()
  })

  it('creates the preview directory', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(existsSync(join(c.dir, 'clips'))).toBe(true)
    c.stopClipboard()
  })

  it('keeps polling every 700 ms and picks up later copies', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.listClips()).toEqual([])
    c.electronState.clipboardText = 'second'
    await c.tick()
    expect(c.listClips().map((x) => x.text)).toEqual(['second'])
    c.stopClipboard()
  })

  it('does not add the same unchanged text twice', async () => {
    const c = await load()
    c.electronState.clipboardText = 'same'
    c.startClipboard(c.db, c.dir)
    await c.flush()
    await c.tick()
    await c.tick()
    expect(c.listClips()).toHaveLength(1)
    c.stopClipboard()
  })

  it('moves an older identical copy to the top instead of duplicating it', async () => {
    const c = await load()
    vi.setSystemTime(1_000)
    c.electronState.clipboardText = 'first'
    c.startClipboard(c.db, c.dir)
    await c.flush()
    vi.setSystemTime(2_000)
    c.electronState.clipboardText = 'second'
    await c.tick()
    vi.setSystemTime(3_000)
    c.electronState.clipboardText = 'first'
    await c.tick()
    // Advancing the fake clock for each poll adds 700 ms, so compare ordering, not exact times.
    const [first, second, ...rest] = c.listClips()
    expect([first.text, second.text, rest]).toEqual(['first', 'second', []])
    expect(first.createdAt).toBeGreaterThan(second.createdAt)
    expect(first.createdAt).toBeGreaterThanOrEqual(3_000)
    c.stopClipboard()
  })

  it('ignores empty clipboards and enormous text', async () => {
    const c = await load()
    c.electronState.clipboardText = 'x'.repeat(1_000_001)
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.listClips()).toEqual([])
    c.stopClipboard()
  })

  it('truncates the preview to 180 characters', async () => {
    const c = await load()
    c.electronState.clipboardText = 'w'.repeat(500)
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.listClips()[0].preview).toHaveLength(180)
    c.stopClipboard()
  })

  it('keeps only the 50 newest non-favourite items and always keeps favourites', async () => {
    const c = await load()
    c.electronState.clipboardText = 'keep me'
    vi.setSystemTime(1)
    c.startClipboard(c.db, c.dir)
    await c.flush()
    c.toggleFavorite(c.listClips()[0].id)
    for (let i = 0; i < 55; i += 1) {
      vi.setSystemTime(100 + i)
      c.electronState.clipboardText = `item ${i}`
      await c.tick()
    }
    const clips = c.listClips()
    expect(clips).toHaveLength(51)
    expect(clips[0]).toMatchObject({ text: 'keep me', favorite: true })
    expect(clips.some((x) => x.text === 'item 0')).toBe(false)
    expect(clips.some((x) => x.text === 'item 54')).toBe(true)
    c.stopClipboard()
  })

  it('survives a busy clipboard and recovers on the next poll', async () => {
    const c = await load()
    c.clipboard.readText.mockRejectedValueOnce(new Error('busy'))
    c.startClipboard(c.db, c.dir)
    await c.flush()
    c.electronState.clipboardText = 'recovered'
    await c.tick()
    expect(c.listClips().map((x) => x.text)).toEqual(['recovered'])
    c.stopClipboard()
  })

  it('never runs two polls at once', async () => {
    const c = await load()
    let release: (text: string) => void = () => undefined
    c.clipboard.readText.mockImplementationOnce(() => new Promise<string>((resolve) => (release = resolve)))
    c.startClipboard(c.db, c.dir)
    await c.tick() // the interval fires while the first poll is still waiting
    expect(c.clipboard.readText).toHaveBeenCalledTimes(1)
    c.electronState.clipboardText = 'late'
    release('late')
    await c.flush()
    expect(c.listClips().map((x) => x.text)).toEqual(['late'])
    c.stopClipboard()
  })

  it('stops polling after stopClipboard, and stopping twice is harmless', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    await c.flush()
    c.stopClipboard()
    c.stopClipboard()
    const calls = c.clipboard.readText.mock.calls.length
    await c.tick()
    expect(c.clipboard.readText.mock.calls.length).toBe(calls)
  })
})

describe('password managers and other private copies', () => {
  const PRIVATE = ['org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType', 'org.nspasteboard.AutoGeneratedType']

  it.each(PRIVATE)('never records text marked %s', async (type) => {
    const c = await load()
    c.electronState.clipboardText = 'hunter2'
    c.electronState.clipboardFormats = [type]
    c.startClipboard(c.db, c.dir)
    await c.flush()
    await c.tick()
    expect(c.listClips()).toEqual([])
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM clips').get()).toEqual({ n: 0 })
    c.stopClipboard()
  })

  it('never records an image marked concealed', async () => {
    const c = await load()
    c.electronState.clipboardImage = c.png()
    c.electronState.clipboardFormats = ['org.nspasteboard.ConcealedType']
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.listClips()).toEqual([])
    expect(readdirSync(join(c.dir, 'clips'))).toEqual([])
    c.stopClipboard()
  })

  it('records the next normal copy after a password, even if it repeats an older clip', async () => {
    const c = await load()
    c.electronState.clipboardText = 'normal'
    c.startClipboard(c.db, c.dir)
    await c.flush()
    c.electronState.clipboardText = 'hunter2'
    c.electronState.clipboardFormats = ['org.nspasteboard.ConcealedType']
    await c.tick()
    c.electronState.clipboardText = 'normal'
    c.electronState.clipboardFormats = []
    vi.setSystemTime(Date.now() + 10_000)
    await c.tick()
    expect(c.listClips().map((x) => x.text)).toEqual(['normal'])
    expect(c.listClips()[0].createdAt).toBeGreaterThanOrEqual(Date.now() - 1_000)
    c.stopClipboard()
  })

  it('does not record a password when a normal copy replaces it mid-poll', async () => {
    const c = await load()
    c.electronState.clipboardText = 'hunter2'
    c.electronState.clipboardFormats = ['org.nspasteboard.ConcealedType']
    c.clipboard.readText.mockImplementationOnce(async () => {
      const text = c.electronState.clipboardText
      c.electronState.clipboardText = 'normal'
      c.electronState.clipboardFormats = []
      return text
    })
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.listClips().map((x) => x.text)).not.toContain('hunter2')
    await c.tick()
    expect(c.listClips().map((x) => x.text)).toEqual(['normal'])
    c.stopClipboard()
  })

  it('does not record a password whose marker is cleared mid-poll', async () => {
    const c = await load()
    c.electronState.clipboardText = 'hunter2'
    c.electronState.clipboardFormats = ['org.nspasteboard.ConcealedType']
    c.clipboard.readText.mockImplementationOnce(async () => {
      const text = c.electronState.clipboardText
      c.electronState.clipboardText = ''
      c.electronState.clipboardFormats = []
      return text
    })
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.listClips()).toEqual([])
    c.stopClipboard()
  })

  it('records the same text when it is copied again without the private marker', async () => {
    const c = await load()
    c.electronState.clipboardText = 'shared'
    c.electronState.clipboardFormats = ['org.nspasteboard.TransientType']
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.listClips()).toEqual([])
    c.electronState.clipboardFormats = []
    await c.tick()
    expect(c.listClips().map((x) => x.text)).toEqual(['shared'])
    c.stopClipboard()
  })
})

describe('polling images', () => {
  it('stores a copied image with its preview file and thumbnail', async () => {
    const c = await load()
    c.electronState.clipboardImage = c.png()
    c.startClipboard(c.db, c.dir)
    await c.flush()
    const [clip] = c.listClips()
    expect(clip).toMatchObject({ kind: 'image', preview: 'Image', text: null })
    expect(clip.thumb).toMatch(/^data:image\/png;base64,/)
    expect(readdirSync(join(c.dir, 'clips'))).toHaveLength(1)
    c.stopClipboard()
  })

  it('does not store the same image twice, but stores a different one', async () => {
    const c = await load()
    c.electronState.clipboardImage = c.png(1)
    c.startClipboard(c.db, c.dir)
    await c.flush()
    await c.tick()
    expect(c.listClips()).toHaveLength(1)
    c.electronState.clipboardImage = c.png(9)
    await c.tick()
    expect(c.listClips()).toHaveLength(2)
    c.stopClipboard()
  })

  it('stores two different images of the same size that share their first and last bytes', async () => {
    const c = await load()
    const a = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 1, 1, 1, 0xae, 0x42, 0x60, 0x82])
    const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 2, 2, 2, 2, 0xae, 0x42, 0x60, 0x82])
    c.electronState.clipboardImage = a
    c.startClipboard(c.db, c.dir)
    await c.flush()
    c.electronState.clipboardImage = b
    await c.tick()
    expect(c.listClips()).toHaveLength(2)
    expect(readdirSync(join(c.dir, 'clips'))).toHaveLength(2)
    c.stopClipboard()
  })

  it('does nothing when the clipboard has neither text nor an image', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.clipboard.read).not.toHaveBeenCalled()
    c.stopClipboard()
  })

  it('skips clipboard items that are not PNG, or whose data is not a Blob', async () => {
    const c = await load()
    c.electronState.clipboardImage = c.png()
    c.clipboard.has.mockImplementation(async (type: string) => type === 'image/png')
    c.clipboard.read.mockResolvedValue([
      { types: ['text/html'], getType: async () => new Blob(['x']) },
      { types: ['image/png'], getType: async () => 'not a blob' }
    ] as never)
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.listClips()).toEqual([])
    c.stopClipboard()
  })

  it('ignores tiny blobs, undecodable images, and images that are too small, too big or too heavy', async () => {
    const c = await load()
    c.electronState.clipboardImage = Buffer.from([1, 2, 3])
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.listClips()).toEqual([])

    c.electronState.clipboardImage = c.png(2)
    c.nativeImage.createFromBuffer.mockReturnValueOnce(new c.FakeImage(true) as never)
    await c.tick()
    c.nativeImage.createFromBuffer.mockReturnValueOnce(new c.FakeImage(false, 1, 50) as never)
    c.electronState.clipboardImage = c.png(3)
    await c.tick()
    c.nativeImage.createFromBuffer.mockReturnValueOnce(new c.FakeImage(false, 5000, 5000) as never)
    c.electronState.clipboardImage = c.png(4)
    await c.tick()
    c.nativeImage.createFromBuffer.mockReturnValueOnce(new c.FakeImage(false, 100, 100, Buffer.alloc(4_000_001)) as never)
    c.electronState.clipboardImage = c.png(5)
    await c.tick()
    expect(c.listClips()).toEqual([])
    c.stopClipboard()
  })

  it('downsizes very large screenshots before storing them', async () => {
    const c = await load()
    c.electronState.clipboardImage = c.png()
    c.nativeImage.createFromBuffer.mockReturnValueOnce(new c.FakeImage(false, 2000, 1100) as never)
    c.startClipboard(c.db, c.dir)
    await c.flush()
    expect(c.listClips()).toHaveLength(1)
    c.stopClipboard()
  })

  it('removes the oldest image files when history is trimmed', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    for (let i = 0; i < 52; i += 1) {
      vi.setSystemTime(1000 + i)
      c.electronState.clipboardImage = c.png(i)
      await c.tick()
    }
    expect(c.listClips()).toHaveLength(50)
    expect(readdirSync(join(c.dir, 'clips'))).toHaveLength(50)
    c.stopClipboard()
  })
})

describe('copyClip', () => {
  it('writes a text clip back to the clipboard without recording it again', async () => {
    const c = await load()
    c.electronState.clipboardText = 'from history'
    c.startClipboard(c.db, c.dir)
    await c.flush()
    c.electronState.clipboardText = 'something else'
    await c.tick()
    const old = c.listClips().find((x) => x.text === 'from history')!
    const before = old.createdAt
    vi.setSystemTime(Date.now() + 5_000)
    await c.copyClip(old.id)
    expect(c.clipboard.writeText).toHaveBeenCalledWith('from history')
    await c.tick()
    expect(c.listClips().find((x) => x.id === old.id)?.createdAt).toBe(before)
    // A genuinely new copy still gets recorded afterwards.
    c.electronState.clipboardText = 'brand new'
    await c.tick()
    expect(c.listClips().map((x) => x.text)).toContain('brand new')
    c.stopClipboard()
  })

  it('writes an image clip back as PNG', async () => {
    const c = await load()
    c.electronState.clipboardImage = c.png()
    c.startClipboard(c.db, c.dir)
    await c.flush()
    c.stopClipboard()
    await c.copyClip(c.listClips()[0].id)
    expect(c.clipboard.write).toHaveBeenCalledTimes(1)
    const [items] = c.clipboard.write.mock.calls[0] as [InstanceType<typeof c.ClipboardItem>[]]
    expect(items[0].types).toEqual(['image/png'])
  })

  it('does nothing for an unknown id or an image file that cannot be read', async () => {
    const c = await load()
    c.electronState.clipboardImage = c.png()
    c.startClipboard(c.db, c.dir)
    await c.flush()
    c.stopClipboard()
    await c.copyClip('nope')
    c.nativeImage.createFromPath.mockReturnValueOnce(new c.FakeImage(true) as never)
    await c.copyClip(c.listClips()[0].id)
    expect(c.clipboard.write).not.toHaveBeenCalled()
    expect(c.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('copies empty text for an image row that lost its file path', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    c.stopClipboard()
    c.db.prepare(`INSERT INTO clips VALUES ('x', 'image', NULL, NULL, 'Image', 0, 1)`).run()
    await c.copyClip('x')
    expect(c.clipboard.writeText).toHaveBeenCalledWith('')
  })
})

describe('favourites, deleting and clearing', () => {
  it('toggles a favourite on and off, favourites sort first, and the list is announced', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    c.stopClipboard()
    c.db.prepare(`INSERT INTO clips VALUES ('a', 'text', 'a', NULL, 'a', 0, 1)`).run()
    c.db.prepare(`INSERT INTO clips VALUES ('b', 'text', 'b', NULL, 'b', 0, 2)`).run()
    expect(c.listClips().map((x) => x.id)).toEqual(['b', 'a'])
    expect(c.toggleFavorite('a').map((x) => [x.id, x.favorite])).toEqual([
      ['a', true],
      ['b', false]
    ])
    expect(c.sent.at(-1)?.[0]).toBe('clips:changed')
    expect(c.toggleFavorite('a').map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('deletes one clip and its preview file; a stuck preview file does not block deletion', async () => {
    const c = await load()
    c.electronState.clipboardImage = c.png()
    c.startClipboard(c.db, c.dir)
    await c.flush()
    c.stopClipboard()
    const [image] = c.listClips()
    const [file] = readdirSync(join(c.dir, 'clips'))
    expect(c.deleteClip(image.id)).toEqual([])
    expect(existsSync(join(c.dir, 'clips', file))).toBe(false)

    // A directory where the file should be makes rmSync throw; the row must still go.
    const stuck = join(c.dir, 'clips', 'stuck.png')
    mkdirSync(stuck)
    c.db.prepare(`INSERT INTO clips VALUES ('s', 'image', NULL, ?, 'Image', 0, 5)`).run(stuck)
    expect(c.deleteClip('s')).toEqual([])
    expect(c.deleteClip('unknown')).toEqual([])
  })

  it('clears history but keeps favourites, removing image files', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    c.stopClipboard()
    const keepFile = join(c.dir, 'clips', 'keep.png')
    const dropFile = join(c.dir, 'clips', 'drop.png')
    writeFileSync(keepFile, 'k')
    writeFileSync(dropFile, 'd')
    c.db.prepare(`INSERT INTO clips VALUES ('fav', 'image', NULL, ?, 'Image', 1, 1)`).run(keepFile)
    c.db.prepare(`INSERT INTO clips VALUES ('img', 'image', NULL, ?, 'Image', 0, 2)`).run(dropFile)
    c.db.prepare(`INSERT INTO clips VALUES ('txt', 'text', 't', NULL, 't', 0, 3)`).run()
    const stuck = join(c.dir, 'clips', 'stuck.png')
    mkdirSync(stuck)
    c.db.prepare(`INSERT INTO clips VALUES ('stuck', 'image', NULL, ?, 'Image', 0, 4)`).run(stuck)
    expect(c.clearHistory().map((x) => x.id)).toEqual(['fav'])
    expect(existsSync(keepFile)).toBe(true)
    expect(existsSync(dropFile)).toBe(false)
  })
})

describe('deleted clips leave no trace on disk', () => {
  const onDisk = (dir: string, marker: string) =>
    ['pullshelf.db', 'pullshelf.db-wal']
      .map((name) => join(dir, name))
      .filter((path) => existsSync(path))
      .some((path) => readFileSync(path).includes(marker))

  it.each([
    ['deleteClip', (c: Awaited<ReturnType<typeof load>>) => c.deleteClip(c.listClips()[0].id)],
    ['clearHistory', (c: Awaited<ReturnType<typeof load>>) => c.clearHistory()]
  ])('%s removes the text from the database file and its WAL', async (_name, remove) => {
    const c = await load()
    const marker = 'SECRET-MARKER-7f3a9c'
    c.electronState.clipboardText = marker
    c.startClipboard(c.db, c.dir)
    await c.flush()
    c.stopClipboard()
    expect(onDisk(c.dir, marker)).toBe(true)
    remove(c)
    expect(onDisk(c.dir, marker)).toBe(false)
  })
})

describe('clipText and thumbnails', () => {
  it('returns text for text clips, and null for images or unknown ids', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    c.stopClipboard()
    c.db.prepare(`INSERT INTO clips VALUES ('t', 'text', 'body', NULL, 'body', 0, 1)`).run()
    c.db.prepare(`INSERT INTO clips VALUES ('i', 'image', NULL, '/p.png', 'Image', 0, 2)`).run()
    expect(c.clipText('t')).toBe('body')
    expect(c.clipText('i')).toBeNull()
    expect(c.clipText('nope')).toBeNull()
  })

  it('rebuilds a missing thumbnail from the saved file, and caches it', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    c.stopClipboard()
    c.db.prepare(`INSERT INTO clips VALUES ('i', 'image', NULL, '/some/p.png', 'Image', 0, 2)`).run()
    expect(c.listClips()[0].thumb).toMatch(/^data:image/)
    c.listClips()
    expect(c.nativeImage.createFromPath).toHaveBeenCalledTimes(1)
  })

  it('has no thumbnail for an unreadable image or one without a path', async () => {
    const c = await load()
    c.startClipboard(c.db, c.dir)
    c.stopClipboard()
    c.db.prepare(`INSERT INTO clips VALUES ('nopath', 'image', NULL, NULL, 'Image', 0, 1)`).run()
    c.db.prepare(`INSERT INTO clips VALUES ('bad', 'image', NULL, '/bad.png', 'Image', 0, 2)`).run()
    c.nativeImage.createFromPath.mockReturnValue(new c.FakeImage(true) as never)
    expect(c.listClips().map((x) => x.thumb)).toEqual([null, null])
  })
})

describe('before startClipboard is called', () => {
  it('is inert instead of throwing', async () => {
    const c = await load()
    expect(c.listClips()).toEqual([])
    expect(c.clearHistory()).toEqual([])
    expect(c.clipText('x')).toBeNull()
    expect(c.toggleFavorite('x')).toEqual([])
    expect(c.deleteClip('x')).toEqual([])
    await expect(c.copyClip('x')).resolves.toBeUndefined()
  })
})
