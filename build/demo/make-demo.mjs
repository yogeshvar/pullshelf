// `npm run demo`: render the website demo clip from the real UI and encode it.
// Needs ffmpeg on the PATH. Outputs go to docs/assets/.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const bin = (name) => resolve(root, 'node_modules/.bin', name)
const work = join(tmpdir(), 'pullshelf-demo')
const frames = join(work, 'frames')
const assets = resolve(root, 'docs/assets')

const run = (command, args, label) => {
  const result = spawnSync(command, args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] })
  if (result.status !== 0) {
    console.error(`${label} failed (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.error('ffmpeg is required (brew install ffmpeg).')
  process.exit(1)
}

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
mkdirSync(assets, { recursive: true })

console.log('Building the UI…')
run(bin('electron-vite'), ['build', '--outDir', join(work, 'build')], 'build')

console.log('Rendering frames…')
run(bin('electron'), [resolve(root, 'build/demo/stage.cjs'), join(work, 'build/renderer'), frames], 'render')
if (!existsSync(join(frames, '0001.png'))) {
  console.error('no frames were produced')
  process.exit(1)
}

const input = ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(frames, '%04d.png')]
console.log('Encoding…')
run('ffmpeg', [...input, '-vf', 'scale=1280:-2,format=yuv420p', '-c:v', 'libx264', '-crf', '27', '-preset', 'slow', '-movflags', '+faststart', '-an', join(assets, 'pullshelf-demo.mp4')], 'mp4')
run('ffmpeg', [...input, '-vf', 'scale=1280:-2,format=yuv420p', '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-row-mt', '1', '-an', join(assets, 'pullshelf-demo.webm')], 'webm')
run('ffmpeg', [...input, '-vf', 'fps=15,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', join(assets, 'pullshelf-demo.gif')], 'gif')
// Poster: a frame near the middle of the story, when every pane has content.
const duration = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(assets, 'pullshelf-demo.mp4')], { encoding: 'utf8' }).stdout)
const poster = Number(process.env.DEMO_POSTER_AT ?? (duration * 0.45).toFixed(2))
run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(poster), '-framerate', '30', '-i', join(frames, '%04d.png'), '-frames:v', '1', '-vf', 'scale=1280:-2', join(assets, 'pullshelf-demo-poster.png')], 'poster')

for (const name of ['pullshelf-demo.mp4', 'pullshelf-demo.webm', 'pullshelf-demo.gif', 'pullshelf-demo-poster.png']) {
  console.log(`${name.padEnd(24)} ${(statSync(join(assets, name)).size / 1024).toFixed(0)} KB`)
}
rmSync(work, { recursive: true, force: true })
