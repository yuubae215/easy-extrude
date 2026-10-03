// Frames → files. One ffmpeg invocation per output; the GIF lane uses a
// per-clip palette with diff-based stats so the static UI chrome does not
// steal colours from the moving scene.
import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const QUALITY = {
  gif:  { draft: { colors: 128, dither: 'bayer:bayer_scale=3' }, standard: { colors: 256, dither: 'sierra2_4a' }, high: { colors: 256, dither: 'sierra2_4a' } },
  mp4:  { draft: 28, standard: 20, high: 16 },
  webm: { draft: 40, standard: 32, high: 26 },
}

export function ffmpegArgs(out, { framesDir, ext, fps, srcWidth }) {
  const q = out.quality ?? 'standard'
  const fpsOut = out.fps ?? fps
  const width = out.width ?? srcWidth
  const input = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(framesDir, `%05d.${ext}`)]
  const scale = `fps=${fpsOut},scale=${width}:-2:flags=lanczos`
  if (out.format === 'gif') {
    const g = QUALITY.gif[q]
    return [...input, '-filter_complex',
      `[0:v]${scale},split[a][b];[a]palettegen=max_colors=${g.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${g.dither}:diff_mode=rectangle`,
      '-loop', '0', out.path]
  }
  if (out.format === 'mp4') {
    return [...input, '-vf', `${scale},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(QUALITY.mp4[q]),
      '-tune', 'animation', '-movflags', '+faststart', out.path]
  }
  return [...input, '-vf', `${scale},format=yuv420p`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(QUALITY.webm[q]), '-row-mt', '1', out.path]
}

export function encode(outputs, frameInfo, log = () => {}) {
  return outputs.map(out => {
    mkdirSync(dirname(out.path), { recursive: true })
    const args = ffmpegArgs(out, frameInfo)
    const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] })
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${out.path} (exit ${r.status})`)
    const bytes = statSync(out.path).size
    log(`wrote ${out.path}  ${(bytes / 1024 / 1024).toFixed(2)} MB`)
    return { ...out, bytes }
  })
}
