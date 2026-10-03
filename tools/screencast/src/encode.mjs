// Frames → files. Each output is one or more ffmpeg passes; the GIF lane uses a
// per-clip palette with diff-based stats so the static UI chrome does not
// steal colours from the moving scene.
//
// Captured frames are NOT all the same size: the virtual zoom camera hands
// CDP a fractional clip and Chromium rounds the bitmap to 1279×719, 1280×719…
// on ~1 frame in 9 (no clip arithmetic avoids it — measured). A size change
// mid-stream makes ffmpeg rebuild the filter graph, and on ffmpeg 6.1
// paletteuse does not survive the rebuild: the graph stops early *with exit 0*
// (README hero shipped as 23 of 238 frames — a 1.5 s title card that looked
// like a still) or dies with "Internal bug". So:
//   1. every lane scales to an explicit W×H (`-2` would let H drift per frame);
//   2. the GIF lane first normalises to a uniform-size lossless intermediate,
//      and only then builds/uses the palette — the palette graph never sees a
//      size change;
//   3. every output is probed afterwards: a short file is an error, never a
//      silent success.
import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const QUALITY = {
  gif:  { draft: { colors: 128, dither: 'bayer:bayer_scale=3' }, standard: { colors: 256, dither: 'sierra2_4a' }, high: { colors: 256, dither: 'sierra2_4a' } },
  mp4:  { draft: 28, standard: 20, high: 16 },
  webm: { draft: 40, standard: 32, high: 26 },
}

/** Output height for a target width, kept even (yuv420p) and fixed for the whole clip. */
export function outputHeight(width, srcWidth, srcHeight) {
  return Math.round(srcHeight * width / srcWidth / 2) * 2
}

/** @returns {string[][]} ffmpeg argument lists, run in order */
export function ffmpegPasses(out, { framesDir, ext, fps, srcWidth, srcHeight }) {
  const q = out.quality ?? 'standard'
  const fpsOut = out.fps ?? fps
  const width = out.width ?? srcWidth
  const height = outputHeight(width, srcWidth, srcHeight)
  const head = ['-y', '-loglevel', 'error']
  const input = ['-framerate', String(fps), '-i', join(framesDir, `%05d.${ext}`)]
  const scale = `fps=${fpsOut},scale=${width}:${height}:flags=lanczos,setsar=1`
  if (out.format === 'gif') {
    const g = QUALITY.gif[q]
    const stem = join(framesDir, basename(out.path))
    const norm = `${stem}.norm.mkv`, palette = `${stem}.palette.png`
    return [
      [...head, ...input, '-vf', scale, '-c:v', 'ffv1', '-pix_fmt', 'bgr0', norm],
      [...head, '-i', norm, '-vf', `palettegen=max_colors=${g.colors}:stats_mode=diff`, '-update', '1', '-frames:v', '1', palette],
      [...head, '-i', norm, '-i', palette, '-lavfi', `[0:v][1:v]paletteuse=dither=${g.dither}:diff_mode=rectangle`, '-loop', '0', out.path],
    ]
  }
  if (out.format === 'mp4') {
    return [[...head, ...input, '-vf', `${scale},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(QUALITY.mp4[q]),
      '-tune', 'animation', '-movflags', '+faststart', out.path]]
  }
  return [[...head, ...input, '-vf', `${scale},format=yuv420p`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(QUALITY.webm[q]), '-row-mt', '1', out.path]]
}

/**
 * Seconds the output must last. Duration, not frame count: the GIF muxer folds
 * identical consecutive frames into one longer delay, so a full GIF legitimately
 * holds fewer frames than were captured.
 */
export function expectedSeconds(count, fps) {
  return count / fps
}

function probe(path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffprobe failed for ${path} (exit ${r.status})`)
  const j = JSON.parse(r.stdout)
  return { width: j.streams[0].width, height: j.streams[0].height, seconds: Number(j.format.duration) }
}

export function encode(outputs, frameInfo, log = () => {}) {
  return outputs.map(out => {
    mkdirSync(dirname(out.path), { recursive: true })
    for (const args of ffmpegPasses(out, frameInfo)) {
      const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] })
      if (r.status !== 0) throw new Error(`ffmpeg failed for ${out.path} (exit ${r.status})`)
    }
    const width = out.width ?? frameInfo.srcWidth
    const height = outputHeight(width, frameInfo.srcWidth, frameInfo.srcHeight)
    const want = expectedSeconds(frameInfo.count, frameInfo.fps)
    const got = probe(out.path)
    // one output frame of slack: fps resampling and GIF's centisecond delays round
    if (Math.abs(got.seconds - want) > 1 / (out.fps ?? frameInfo.fps) + 0.01) {
      throw new Error(`${out.path}: ${got.seconds.toFixed(2)} s encoded, expected ${want.toFixed(2)} s — output is truncated`)
    }
    if (got.width !== width || got.height !== height) throw new Error(`${out.path}: ${got.width}×${got.height}, expected ${width}×${height}`)
    const bytes = statSync(out.path).size
    log(`wrote ${out.path}  ${got.seconds.toFixed(2)} s ${width}×${height}  ${(bytes / 1024 / 1024).toFixed(2)} MB`)
    return { ...out, bytes, seconds: got.seconds }
  })
}
