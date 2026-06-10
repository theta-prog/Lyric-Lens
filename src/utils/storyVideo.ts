import type { CameraOffInteractionSnapshot, CaptureItem } from '../types'

export interface StoryFrame {
  capture: CaptureItem
  dataUrl: string
  index: number
}

export interface StoryRenderFrame {
  capture: CaptureItem
  image: HTMLImageElement
  sourceIndex: number
  duration: number
}

export interface StoryVideoResult {
  blob: Blob
  filename: string
  mimeType: string
  durationMs: number
  frameCount: number
}

interface StoryRenderOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

const STORY_WIDTH = 1080
const STORY_HEIGHT = 1920
const STORY_FPS = 30
const MAX_STORY_FRAMES = 12
const MAX_STORY_DURATION = 15_000

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function wait(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]

  return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? ''
}

function getStoryFilename(mimeType: string) {
  const extension = mimeType.includes('webm') ? 'webm' : 'mp4'
  return `lyric-lens-story-${new Date().toISOString().slice(0, 10)}.${extension}`
}

function scoreCapture(capture: CaptureItem, index: number, total: number) {
  const phrase = capture.phrase.toLowerCase()
  let score = 1

  if (capture.isChorus) score += 1.6
  score += clamp(capture.vocalIntensity ?? 0, 0, 1) * 1.2
  if (capture.chordName) score += 0.24
  if (capture.tintHue !== undefined) score += 0.18
  if (/(シャッター|チャンス|光|声|音|未来|世界|幕|ステージ|問い|答え|フォーカス|ピント)/.test(phrase)) {
    score += 0.55
  }
  if (index === 0 || index === total - 1) score += 0.4

  return score
}

export function selectStoryFrames(captures: CaptureItem[]) {
  if (captures.length <= MAX_STORY_FRAMES) return captures

  const selectedIds = new Set(
    captures
      .map((capture, index) => ({
        id: capture.id,
        score: scoreCapture(capture, index, captures.length),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_STORY_FRAMES)
      .map(item => item.id),
  )

  return captures.filter(capture => selectedIds.has(capture.id))
}

function getFrameDuration(capture: CaptureItem) {
  const beatMs = capture.bpm && capture.bpm > 0 ? 60_000 / capture.bpm : 560
  const beats = capture.isChorus ? 2 : 2.5
  const vocalBoost = clamp(capture.vocalIntensity ?? 0, 0, 1) * 180

  return clamp(Math.round(beatMs * beats + vocalBoost), 850, 1700)
}

function normalizeDurations(frames: StoryRenderFrame[]) {
  const total = frames.reduce((sum, frame) => sum + frame.duration, 0)
  if (total <= MAX_STORY_DURATION) return frames

  const scale = MAX_STORY_DURATION / total
  return frames.map(frame => ({
    ...frame,
    duration: Math.max(720, Math.round(frame.duration * scale)),
  }))
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Story image could not be loaded.'))
    image.src = dataUrl
  })
}

async function prepareFrames(storyFrames: StoryFrame[]) {
  const frames = await Promise.all(
    storyFrames.map(async frame => ({
      capture: frame.capture,
      image: await loadImage(frame.dataUrl),
      sourceIndex: frame.index,
      duration: getFrameDuration(frame.capture),
    })),
  )

  return normalizeDurations(frames)
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  scaleBoost: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * scaleBoost
  const sw = image.naturalWidth * scale
  const sh = image.naturalHeight * scale
  ctx.drawImage(image, (width - sw) / 2, (height - sh) / 2, sw, sh)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  scaleBoost: number,
) {
  const maxWidth = STORY_WIDTH * 0.88
  const maxHeight = STORY_HEIGHT * 0.58
  const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight) * scaleBoost
  const sw = image.naturalWidth * scale
  const sh = image.naturalHeight * scale
  const x = (STORY_WIDTH - sw) / 2
  const y = STORY_HEIGHT * 0.44 - sh / 2

  ctx.save()
  ctx.filter = 'blur(26px) saturate(120%) brightness(72%)'
  drawCoverImage(ctx, image, STORY_WIDTH, STORY_HEIGHT, 1.08)
  ctx.restore()

  ctx.save()
  ctx.fillStyle = 'rgba(26, 26, 31, 0.24)'
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)'
  ctx.shadowBlur = 28
  ctx.shadowOffsetY = 16
  roundRect(ctx, x - 10, y - 10, sw + 20, sh + 20, 14)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.drawImage(image, x, y, sw, sh)
  ctx.strokeStyle = 'rgba(26, 26, 31, 0.82)'
  ctx.lineWidth = 4
  ctx.strokeRect(x, y, sw, sh)
  ctx.restore()
}

function drawStoryImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  scaleBoost: number,
) {
  const imageAspect = image.naturalWidth / image.naturalHeight
  const storyAspect = STORY_WIDTH / STORY_HEIGHT
  const shouldContain = imageAspect > storyAspect * 1.35

  if (shouldContain) {
    drawContainedImage(ctx, image, Math.min(scaleBoost, 1.045))
    return
  }

  drawCoverImage(ctx, image, STORY_WIDTH, STORY_HEIGHT, scaleBoost)
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const chars = [...text]
  const lines: string[] = []
  let line = ''

  for (const char of chars) {
    const nextLine = `${line}${char}`
    if (ctx.measureText(nextLine).width > maxWidth && line) {
      lines.push(line)
      line = char
    } else {
      line = nextLine
    }

    if (lines.length === maxLines) break
  }

  if (line && lines.length < maxLines) lines.push(line)

  lines.forEach((lineText, index) => {
    ctx.fillText(lineText, x, y + index * lineHeight)
  })
}

function drawCapturedEffect(
  ctx: CanvasRenderingContext2D,
  frame: StoryRenderFrame,
  localProgress: number,
) {
  const effect = frame.capture.shutterEffect
  if (!effect || effect === 'default') return

  const pulse = Math.sin(localProgress * Math.PI)
  const tintHue = frame.capture.tintHue ?? (frame.capture.isChorus ? 48 : 190)

  ctx.save()
  if (effect === 'finder' || effect === 'frame' || effect === 'answer-scan') {
    ctx.globalAlpha = 0.34 + pulse * 0.32
    ctx.strokeStyle = effect === 'answer-scan' ? '#f5c842' : '#3dd6e8'
    ctx.lineWidth = effect === 'frame' ? 12 : 5
    ctx.setLineDash(effect === 'finder' ? [20, 18] : [])
    ctx.strokeRect(92, 172, STORY_WIDTH - 184, STORY_HEIGHT - 344)
    ctx.setLineDash([])
  }

  if (effect === 'sound-wave') {
    ctx.globalAlpha = 0.42 + pulse * 0.32
    ctx.fillStyle = `hsl(${tintHue} 88% 56%)`
    for (let i = 0; i < 12; i += 1) {
      const height = STORY_HEIGHT * (0.05 + ((i * 19) % 42) / 100 + pulse * 0.08)
      ctx.fillRect(160 + i * 62, STORY_HEIGHT * 0.66 - height, 18, height)
    }
  }

  if (effect === 'light-leak' || effect === 'strobe') {
    ctx.globalAlpha = effect === 'strobe' ? Math.max(0, 0.42 - localProgress * 0.5) : 0.18 + pulse * 0.24
    const leak = ctx.createLinearGradient(-80, STORY_HEIGHT * 0.18, STORY_WIDTH + 80, STORY_HEIGHT * 0.58)
    leak.addColorStop(0, 'rgba(255, 255, 255, 0)')
    leak.addColorStop(0.42, 'rgba(255, 255, 255, 0.84)')
    leak.addColorStop(0.62, `hsl(${tintHue} 88% 62% / 0.72)`)
    leak.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = leak
    ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)
  }

  if (effect === 'speed-lines' || effect === 'glitch' || effect === 'noise') {
    ctx.globalAlpha = effect === 'noise' ? 0.12 + pulse * 0.10 : 0.20 + pulse * 0.24
    ctx.fillStyle = effect === 'glitch' ? '#3dd6e8' : '#ffffff'
    for (let i = 0; i < 9; i += 1) {
      const y = STORY_HEIGHT * (0.14 + i * 0.085)
      ctx.save()
      ctx.translate(STORY_WIDTH * (0.05 + (i % 2) * 0.08), y)
      ctx.rotate(-0.12)
      ctx.fillRect(0, 0, STORY_WIDTH * (0.38 + (i % 3) * 0.08), 5 + (i % 2) * 4)
      ctx.restore()
    }
  }

  if (effect === 'stage-curtain') {
    ctx.globalAlpha = 0.18 + pulse * 0.22
    ctx.fillStyle = '#1a1a1f'
    ctx.fillRect(0, 0, STORY_WIDTH * 0.18, STORY_HEIGHT)
    ctx.fillRect(STORY_WIDTH * 0.82, 0, STORY_WIDTH * 0.18, STORY_HEIGHT)
    ctx.fillStyle = '#f5c842'
    ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT * 0.055)
  }

  ctx.restore()
}

function drawCameraOffInteraction(
  ctx: CanvasRenderingContext2D,
  interaction: CameraOffInteractionSnapshot | undefined,
  localProgress: number,
) {
  if (!interaction) return

  const x = interaction.x * STORY_WIDTH
  const y = interaction.y * STORY_HEIGHT
  const hue = interaction.hue ?? 190
  const pulse = Math.sin(localProgress * Math.PI)
  const alpha = 0.20 + pulse * 0.42

  ctx.save()
  if (interaction.preset === 'film-studio') {
    ctx.globalAlpha = alpha
    ctx.strokeStyle = '#fffdf8'
    ctx.lineWidth = 14
    ctx.strokeRect(x - 250, y - 180, 500, 360)
    ctx.fillStyle = 'rgba(26, 26, 31, 0.28)'
    ctx.fillRect(0, y - 48, STORY_WIDTH, 96)
    ctx.fillStyle = '#f5c842'
    ctx.fillRect(0, y + 52, STORY_WIDTH * (0.25 + interaction.intensity * 0.58), 16)
  } else if (interaction.preset === 'signal-pop') {
    ctx.globalAlpha = alpha
    for (let i = 0; i < 8; i += 1) {
      ctx.strokeStyle = `hsl(${(hue + i * 24) % 360} 92% 58%)`
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.arc(x, y, 70 + i * 48 + pulse * 22, 0, Math.PI * 2)
      ctx.stroke()
    }
    for (let i = 0; i < 10; i += 1) {
      ctx.fillStyle = `hsl(${(hue + i * 18) % 360} 92% 56%)`
      ctx.fillRect(130 + i * 84, STORY_HEIGHT * 0.70 - (90 + i * 18) * pulse, 22, 120 + i * 24)
    }
  } else {
    ctx.globalAlpha = alpha
    ctx.strokeStyle = `hsl(${hue} 90% 56%)`
    ctx.lineWidth = 10
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath()
      ctx.arc(x, y, 90 + i * 76 + pulse * 24, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.54)'
    ctx.fillRect(x - 330, y - 8, 660, 16)
    ctx.fillRect(x - 8, y - 280, 16, 560)
  }

  if (interaction.kind === 'drag-trail') {
    ctx.globalAlpha = 0.34 + pulse * 0.36
    ctx.strokeStyle = interaction.preset === 'film-studio' ? '#fffdf8' : `hsl(${hue} 92% 62%)`
    ctx.lineWidth = 28
    ctx.beginPath()
    ctx.moveTo(x - 250, y + 160)
    ctx.quadraticCurveTo(x - 40, y - 180, x + 270, y + 40)
    ctx.stroke()
  }

  ctx.restore()
}

function drawStoryFrame(
  ctx: CanvasRenderingContext2D,
  frames: StoryRenderFrame[],
  frameIndex: number,
  localProgress: number,
  globalProgress: number,
) {
  const frame = frames[frameIndex]
  const nextFrame = frames[Math.min(frames.length - 1, frameIndex + 1)]
  const tintHue = frame.capture.tintHue ?? (frame.capture.isChorus ? 48 : 190)
  const transitionProgress = clamp((localProgress - 0.82) / 0.18, 0, 1)
  const activeImage = transitionProgress > 0 && nextFrame ? nextFrame.image : frame.image
  const kenBurns = 1.025 + localProgress * 0.045

  ctx.clearRect(0, 0, STORY_WIDTH, STORY_HEIGHT)
  ctx.fillStyle = '#1a1a1f'
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)

  ctx.save()
  if (transitionProgress > 0) {
    ctx.globalAlpha = 1 - transitionProgress
    drawStoryImage(ctx, frame.image, kenBurns)
    ctx.globalAlpha = transitionProgress
    drawStoryImage(ctx, activeImage, 1.02)
  } else {
    drawStoryImage(ctx, activeImage, kenBurns)
  }
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = frame.capture.isChorus ? 0.24 : 0.16
  ctx.fillStyle = `hsl(${tintHue} 82% 54%)`
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)
  ctx.restore()

  const gradient = ctx.createLinearGradient(0, STORY_HEIGHT * 0.42, 0, STORY_HEIGHT)
  gradient.addColorStop(0, 'rgba(26, 26, 31, 0)')
  gradient.addColorStop(0.58, 'rgba(26, 26, 31, 0.54)')
  gradient.addColorStop(1, 'rgba(26, 26, 31, 0.86)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)

  drawCapturedEffect(ctx, frame, localProgress)
  drawCameraOffInteraction(ctx, frame.capture.cameraOffInteraction, localProgress)

  ctx.strokeStyle = 'rgba(61, 214, 232, 0.52)'
  ctx.lineWidth = 4
  ctx.setLineDash([16, 18])
  ctx.strokeRect(62, 120, STORY_WIDTH - 124, STORY_HEIGHT - 240)
  ctx.setLineDash([])

  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
  const railWidth = STORY_WIDTH - 120
  ctx.fillRect(60, 62, railWidth, 8)
  ctx.fillStyle = '#f5c842'
  ctx.fillRect(60, 62, railWidth * globalProgress, 8)

  ctx.font = '900 34px "Barlow Condensed", Impact, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#f5c842'
  ctx.fillText(frame.capture.isChorus ? 'CHORUS CUT' : 'LYRIC CUT', 72, 104)

  ctx.fillStyle = '#ffffff'
  ctx.font = '900 25px "Noto Sans JP", system-ui, sans-serif'
  const meta = [
    `#${String(frame.sourceIndex + 1).padStart(3, '0')}`,
    frame.capture.chordName || 'NO CHORD',
    `${Math.round((frame.capture.vocalIntensity ?? 0) * 100)} VOX`,
  ].join(' / ')
  ctx.fillText(meta, 72, 148)

  ctx.save()
  ctx.translate(STORY_WIDTH - 76, STORY_HEIGHT * 0.52)
  ctx.rotate(Math.PI / 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
  ctx.font = '900 24px "Barlow Condensed", Impact, sans-serif'
  ctx.fillText(frame.capture.songTitle || 'Lyric Lens', 0, 0)
  ctx.restore()

  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = 18
  ctx.font = '900 64px "Noto Sans JP", system-ui, sans-serif'
  drawWrappedText(ctx, frame.capture.phrase || 'Lyric Lens', 74, STORY_HEIGHT - 340, STORY_WIDTH - 148, 82, 3)
  ctx.shadowBlur = 0

  ctx.fillStyle = '#3dd6e8'
  ctx.font = '900 34px "Barlow Condensed", Impact, sans-serif'
  ctx.fillText('TEXTALIVE AUTO EDIT', 74, STORY_HEIGHT - 114)

  const pulse = Math.sin(localProgress * Math.PI)
  ctx.fillStyle = `rgba(245, 200, 66, ${0.48 + pulse * 0.34})`
  ctx.fillRect(74, STORY_HEIGHT - 154, (STORY_WIDTH - 148) * localProgress, 6)
}

function assertCanRenderStory() {
  if (!HTMLCanvasElement.prototype.captureStream) {
    throw new Error('このブラウザは動画生成に対応していません。')
  }

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('このブラウザはMediaRecorderに対応していません。')
  }
}

export async function createStoryVideo(
  storyFrames: StoryFrame[],
  options: StoryRenderOptions = {},
): Promise<StoryVideoResult> {
  assertCanRenderStory()

  if (storyFrames.length === 0) {
    throw new Error('動画に使えるフレームがありません。')
  }

  const mimeType = pickMimeType()
  const canvas = document.createElement('canvas')
  canvas.width = STORY_WIDTH
  canvas.height = STORY_HEIGHT
  const ctx = canvas.getContext('2d')

  if (!ctx) throw new Error('Canvasを初期化できませんでした。')

  const frames = await prepareFrames(storyFrames)
  const durationMs = frames.reduce((sum, frame) => sum + frame.duration, 0)
  const stream = canvas.captureStream(STORY_FPS)
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: BlobPart[] = []

  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve()
    recorder.onerror = () => reject(new Error('動画生成に失敗しました。'))
  })

  try {
    recorder.start()

    const startedAt = performance.now()
    let elapsedBeforeFrame = 0

    for (const [frameIndex, frame] of frames.entries()) {
      const frameStartedAt = performance.now()

      while (performance.now() - frameStartedAt < frame.duration) {
        if (options.signal?.aborted) {
          recorder.stop()
          await stopped
          throw new DOMException('Story export aborted.', 'AbortError')
        }

        const frameElapsed = performance.now() - frameStartedAt
        const localProgress = clamp(frameElapsed / frame.duration, 0, 1)
        const globalProgress = clamp((elapsedBeforeFrame + frameElapsed) / durationMs, 0, 1)
        drawStoryFrame(ctx, frames, frameIndex, localProgress, globalProgress)
        options.onProgress?.(globalProgress)
        await wait(1000 / STORY_FPS)
      }

      elapsedBeforeFrame += frame.duration
    }

    drawStoryFrame(ctx, frames, frames.length - 1, 1, 1)
    options.onProgress?.(1)
    await wait(Math.max(80, startedAt + durationMs - performance.now()))
    recorder.stop()
    await stopped
  } finally {
    stream.getTracks().forEach(track => track.stop())
  }

  const effectiveMimeType = recorder.mimeType || mimeType || 'video/webm'
  return {
    blob: new Blob(chunks, { type: effectiveMimeType }),
    filename: getStoryFilename(effectiveMimeType),
    mimeType: effectiveMimeType,
    durationMs,
    frameCount: frames.length,
  }
}
