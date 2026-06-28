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

export type StoryLayoutMode = 'stage' | 'log'
export type StoryPacingMode = 'auto' | 'bar' | 'half'

interface StoryRenderOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
  layoutMode?: StoryLayoutMode
  pacingMode?: StoryPacingMode
}

const STORY_WIDTH = 1080
const STORY_HEIGHT = 1920
const STORY_FPS = 30
const MAX_STORY_FRAMES = 12
const MAX_STORY_DURATION = 15_000

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatStoryTime(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
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

function getFrameDuration(capture: CaptureItem, pacingMode: StoryPacingMode, frameCount: number) {
  const beatMs = capture.bpm && capture.bpm > 0 ? 60_000 / capture.bpm : 560
  const effectivePacing = pacingMode === 'auto'
    ? frameCount <= 6 ? 'bar' : 'half'
    : pacingMode
  const beats = effectivePacing === 'bar' ? 4 : 2
  const vocalBoost = clamp(capture.vocalIntensity ?? 0, 0, 1) * 180

  return effectivePacing === 'bar'
    ? clamp(Math.round(beatMs * beats + vocalBoost), 1300, 2400)
    : clamp(Math.round(beatMs * beats + vocalBoost), 760, 1450)
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

async function prepareFrames(storyFrames: StoryFrame[], pacingMode: StoryPacingMode) {
  const frames = await Promise.all(
    storyFrames.map(async frame => ({
      capture: frame.capture,
      image: await loadImage(frame.dataUrl),
      sourceIndex: frame.index,
      duration: getFrameDuration(frame.capture, pacingMode, storyFrames.length),
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

function drawContainedImageInRect(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const sw = image.naturalWidth * scale
  const sh = image.naturalHeight * scale
  const dx = x + (width - sw) / 2
  const dy = y + (height - sh) / 2

  ctx.drawImage(image, dx, dy, sw, sh)

  return { x: dx, y: dy, width: sw, height: sh }
}

function getCaptureReason(capture: CaptureItem) {
  if (capture.cameraOffInteraction) return 'GESTURE TAKE'
  if (capture.triggerText) return `TRIGGER ${capture.triggerText}`
  if (capture.captureSource === 'auto') return 'AUTO SHOT'
  return 'MANUAL SHOT'
}

function getEffectLabel(capture: CaptureItem) {
  switch (capture.shutterEffect) {
    case 'finder':
      return 'FINDER'
    case 'light-leak':
      return 'LIGHT LEAK'
    case 'sound-wave':
      return 'SOUND WAVE'
    case 'frame':
      return 'FRAME'
    case 'strobe':
      return 'STROBE'
    case 'speed-lines':
      return 'SPEED LINES'
    case 'glitch':
      return 'GLITCH'
    case 'noise':
      return 'NOISE'
    case 'stage-curtain':
      return 'CURTAIN'
    case 'answer-scan':
      return 'ANSWER SCAN'
    default:
      return capture.triggerText || 'LYRIC CUT'
  }
}

function getSongProgress(capture: CaptureItem) {
  if (!capture.songDuration || capture.songDuration <= 0) return 0
  return clamp(capture.songPosition / capture.songDuration, 0, 1)
}

function getTimelineStrip(frames: StoryRenderFrame[], activeIndex: number) {
  const first = clamp(activeIndex - 2, 0, Math.max(0, frames.length - 5))
  return frames.slice(first, first + 5).map((frame, offset) => ({
    frame,
    index: first + offset,
  }))
}

function drawSetlogHeader(
  ctx: CanvasRenderingContext2D,
  frame: StoryRenderFrame,
  frameNumber: number,
  globalProgress: number,
) {
  ctx.save()
  ctx.fillStyle = '#fffdf8'
  ctx.fillRect(0, 0, STORY_WIDTH, 258)
  ctx.strokeStyle = '#1a1a1f'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(0, 258)
  ctx.lineTo(STORY_WIDTH, 258)
  ctx.stroke()

  ctx.fillStyle = '#d8d0bd'
  ctx.fillRect(58, 64, STORY_WIDTH - 116, 10)
  ctx.fillStyle = '#f5c842'
  ctx.fillRect(58, 64, (STORY_WIDTH - 116) * globalProgress, 10)

  ctx.fillStyle = '#1a1a1f'
  ctx.font = '900 72px "Barlow Condensed", Impact, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText('MUSIC LOG', 58, 98)

  ctx.font = '900 34px "Barlow Condensed", Impact, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(`#${String(frameNumber).padStart(2, '0')}`, STORY_WIDTH - 58, 96)
  ctx.fillStyle = '#3dd6e8'
  ctx.fillText(formatStoryTime(frame.capture.songPosition), STORY_WIDTH - 58, 138)

  ctx.textAlign = 'left'
  ctx.fillStyle = '#1a1a1f'
  ctx.font = '900 26px "Noto Sans JP", system-ui, sans-serif'
  drawWrappedText(ctx, frame.capture.songTitle || 'Lyric Lens', 58, 188, STORY_WIDTH - 116, 34, 1)
  ctx.restore()
}

function drawSetlogStage(
  ctx: CanvasRenderingContext2D,
  frame: StoryRenderFrame,
  localProgress: number,
) {
  const top = 258
  const height = 1260
  const tintHue = frame.capture.tintHue ?? (frame.capture.isChorus ? 48 : 190)

  ctx.save()
  ctx.fillStyle = '#1a1a1f'
  ctx.fillRect(0, top, STORY_WIDTH, height)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.fillRect(58, top + 98, STORY_WIDTH - 116, 2)
  ctx.fillRect(58, top + height - 166, STORY_WIDTH - 116, 2)

  ctx.fillStyle = '#f5c842'
  ctx.font = '900 28px "Barlow Condensed", Impact, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText('NOW LYRIC', 58, top + 44)

  ctx.fillStyle = '#fffdf8'
  ctx.font = '900 38px "Noto Sans JP", system-ui, sans-serif'
  drawWrappedText(ctx, frame.capture.phrase || 'Lyric Lens', 58, top + 82, 650, 48, 2)

  const status = frame.capture.isChorus ? 'CHORUS' : 'VERSE'
  const chord = frame.capture.chordName || 'NO CHORD'
  const vox = `VOX ${Math.round((frame.capture.vocalIntensity ?? 0) * 100)}`

  ctx.textAlign = 'right'
  ctx.fillStyle = '#fffdf8'
  ctx.font = '900 23px "Barlow Condensed", Impact, sans-serif'
  ctx.fillText(status, STORY_WIDTH - 58, top + 46)
  ctx.fillText(chord, STORY_WIDTH - 58, top + 86)
  ctx.fillText(vox, STORY_WIDTH - 58, top + 126)
  ctx.textAlign = 'left'

  const buttonWidth = 344
  const buttonX = (STORY_WIDTH - buttonWidth) / 2
  roundRect(ctx, buttonX + 10, top + 160, buttonWidth, 68, 10)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
  ctx.fill()
  roundRect(ctx, buttonX, top + 150, buttonWidth, 68, 10)
  ctx.fillStyle = '#f5c842'
  ctx.fill()
  ctx.strokeStyle = '#fffdf8'
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.fillStyle = '#1a1a1f'
  ctx.font = '900 26px "Barlow Condensed", Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('PLAY MUSIC LOG', STORY_WIDTH / 2, top + 184)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const imageTop = top + 250
  const imageHeight = 738
  const imageRect = drawContainedImageInRect(ctx, frame.image, 58, imageTop, STORY_WIDTH - 116, imageHeight)
  ctx.strokeStyle = '#fffdf8'
  ctx.lineWidth = 5
  ctx.strokeRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height)

  ctx.save()
  ctx.globalAlpha = frame.capture.isChorus ? 0.18 : 0.12
  ctx.fillStyle = `hsl(${tintHue} 86% 56%)`
  ctx.fillRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height)
  ctx.restore()

  const pulse = Math.sin(localProgress * Math.PI)
  ctx.save()
  ctx.globalAlpha = 0.16 + pulse * 0.14
  ctx.strokeStyle = '#3dd6e8'
  ctx.lineWidth = 5
  ctx.setLineDash([18, 16])
  ctx.strokeRect(imageRect.x + 24, imageRect.y + 24, imageRect.width - 48, imageRect.height - 48)
  ctx.setLineDash([])
  ctx.restore()

  const bottomTop = top + height - 130
  ctx.fillStyle = '#fffdf8'
  ctx.font = '900 28px "Barlow Condensed", Impact, sans-serif'
  ctx.fillText('SHOT', 58, bottomTop)
  ctx.fillText('MUSIC', 260, bottomTop)
  ctx.fillText('CUT', 462, bottomTop)
  ctx.fillText('REASON', 704, bottomTop)

  ctx.fillStyle = '#3dd6e8'
  ctx.font = '900 38px "Barlow Condensed", Impact, sans-serif'
  ctx.fillText(formatStoryTime(frame.capture.songPosition), 58, bottomTop + 40)
  ctx.fillText(formatStoryTime(frame.capture.songPosition), 260, bottomTop + 40)

  ctx.fillStyle = '#fffdf8'
  ctx.font = '900 30px "Barlow Condensed", Impact, sans-serif'
  ctx.fillText(getEffectLabel(frame.capture), 462, bottomTop + 44)
  drawWrappedText(ctx, getCaptureReason(frame.capture), 704, bottomTop + 44, 300, 34, 1)
  ctx.restore()
}

function drawStageOnlyFrame(
  ctx: CanvasRenderingContext2D,
  frame: StoryRenderFrame,
  localProgress: number,
) {
  const tintHue = frame.capture.tintHue ?? (frame.capture.isChorus ? 48 : 190)
  const status = frame.capture.isChorus ? 'CHORUS' : 'VERSE'
  const chord = frame.capture.chordName || 'NO CHORD'
  const vox = `VOX ${Math.round((frame.capture.vocalIntensity ?? 0) * 100)}`

  ctx.save()
  ctx.fillStyle = '#1a1a1f'
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.fillRect(62, 174, STORY_WIDTH - 124, 2)
  ctx.fillRect(62, 1536, STORY_WIDTH - 124, 2)

  ctx.fillStyle = '#f5c842'
  ctx.font = '900 33px "Barlow Condensed", Impact, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText('NOW LYRIC', 62, 86)

  ctx.fillStyle = '#fffdf8'
  ctx.font = '900 52px "Noto Sans JP", system-ui, sans-serif'
  drawWrappedText(ctx, frame.capture.phrase || 'Lyric Lens', 62, 132, 700, 66, 2)

  ctx.textAlign = 'right'
  ctx.font = '900 28px "Barlow Condensed", Impact, sans-serif'
  ctx.fillText(status, STORY_WIDTH - 62, 88)
  ctx.fillText(chord, STORY_WIDTH - 62, 146)
  ctx.fillText(vox, STORY_WIDTH - 62, 204)
  ctx.textAlign = 'left'

  const buttonWidth = 344
  const buttonX = (STORY_WIDTH - buttonWidth) / 2
  roundRect(ctx, buttonX + 10, 294, buttonWidth, 78, 10)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
  ctx.fill()
  roundRect(ctx, buttonX, 282, buttonWidth, 78, 10)
  ctx.fillStyle = '#f5c842'
  ctx.fill()
  ctx.strokeStyle = '#fffdf8'
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.fillStyle = '#1a1a1f'
  ctx.font = '900 31px "Barlow Condensed", Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('PLAY MUSIC LOG', STORY_WIDTH / 2, 321)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const imageRect = drawContainedImageInRect(ctx, frame.image, 62, 635, STORY_WIDTH - 124, 610)
  ctx.strokeStyle = '#fffdf8'
  ctx.lineWidth = 5
  ctx.strokeRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height)

  ctx.save()
  ctx.globalAlpha = frame.capture.isChorus ? 0.18 : 0.12
  ctx.fillStyle = `hsl(${tintHue} 86% 56%)`
  ctx.fillRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height)
  ctx.restore()

  const pulse = Math.sin(localProgress * Math.PI)
  ctx.save()
  ctx.globalAlpha = 0.14 + pulse * 0.12
  ctx.strokeStyle = '#3dd6e8'
  ctx.lineWidth = 5
  ctx.setLineDash([18, 16])
  ctx.strokeRect(imageRect.x + 24, imageRect.y + 24, imageRect.width - 48, imageRect.height - 48)
  ctx.setLineDash([])
  ctx.restore()

  ctx.fillStyle = '#fffdf8'
  ctx.font = '900 30px "Barlow Condensed", Impact, sans-serif'
  ctx.fillText('SHOT', 62, 1596)
  ctx.fillText('MUSIC', 262, 1596)
  ctx.fillText('CUT', 462, 1596)
  ctx.fillText('REASON', 706, 1596)

  ctx.fillStyle = '#3dd6e8'
  ctx.font = '900 44px "Barlow Condensed", Impact, sans-serif'
  ctx.fillText(formatStoryTime(frame.capture.songPosition), 62, 1658)
  ctx.fillText(formatStoryTime(frame.capture.songPosition), 262, 1658)

  ctx.fillStyle = '#fffdf8'
  ctx.font = '900 38px "Noto Sans JP", system-ui, sans-serif'
  drawWrappedText(ctx, getEffectLabel(frame.capture), 462, 1658, 220, 46, 1)
  ctx.font = '900 32px "Barlow Condensed", Impact, sans-serif'
  drawWrappedText(ctx, getCaptureReason(frame.capture), 706, 1658, 312, 40, 2)
  ctx.restore()
}

function drawSetlogFooter(
  ctx: CanvasRenderingContext2D,
  frames: StoryRenderFrame[],
  activeIndex: number,
) {
  const frame = frames[activeIndex]
  const top = 1518
  const progress = Math.round(getSongProgress(frame.capture) * 100)

  ctx.save()
  ctx.fillStyle = '#fffdf8'
  ctx.fillRect(0, top, STORY_WIDTH, STORY_HEIGHT - top)
  ctx.strokeStyle = '#1a1a1f'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(0, top)
  ctx.lineTo(STORY_WIDTH, top)
  ctx.stroke()

  ctx.fillStyle = '#1a1a1f'
  ctx.font = '900 34px "Noto Sans JP", system-ui, sans-serif'
  ctx.textBaseline = 'top'
  drawWrappedText(ctx, frame.capture.phrase || 'Lyric Lens', 58, top + 36, STORY_WIDTH - 116, 44, 2)

  ctx.fillStyle = '#3dd6e8'
  ctx.font = '900 26px "Barlow Condensed", Impact, sans-serif'
  const tags = [
    `${progress}%`,
    frame.capture.captureSource === 'auto' ? 'AUTO' : 'MANUAL',
    frame.capture.isChorus ? 'CHORUS' : 'VERSE',
    frame.capture.chordName || 'NO CHORD',
  ]
  ctx.fillText(tags.join(' / '), 58, top + 138)

  const strip = getTimelineStrip(frames, activeIndex)
  const gap = 16
  const thumbWidth = (STORY_WIDTH - 116 - gap * 4) / 5
  const thumbHeight = 164
  const y = top + 200

  strip.forEach(({ frame: thumb, index }, offset) => {
    const x = 58 + offset * (thumbWidth + gap)
    ctx.fillStyle = index === activeIndex ? '#f5c842' : '#1a1a1f'
    roundRect(ctx, x - 5, y - 5, thumbWidth + 10, thumbHeight + 10, 10)
    ctx.fill()

    ctx.save()
    roundRect(ctx, x, y, thumbWidth, thumbHeight, 6)
    ctx.clip()
    ctx.fillStyle = '#1a1a1f'
    ctx.fillRect(x, y, thumbWidth, thumbHeight)
    drawContainedImageInRect(ctx, thumb.image, x, y, thumbWidth, thumbHeight)
    ctx.restore()

    ctx.fillStyle = '#fffdf8'
    ctx.font = '900 20px "Barlow Condensed", Impact, sans-serif'
    ctx.fillText(String(thumb.sourceIndex + 1).padStart(2, '0'), x + 10, y + 10)
  })

  ctx.restore()
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
  layoutMode: StoryLayoutMode,
) {
  const frame = frames[frameIndex]

  ctx.clearRect(0, 0, STORY_WIDTH, STORY_HEIGHT)

  if (layoutMode === 'stage') {
    drawStageOnlyFrame(ctx, frame, localProgress)
    return
  }

  ctx.fillStyle = '#fffdf8'
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)
  drawSetlogHeader(ctx, frame, frame.sourceIndex + 1, globalProgress)
  drawSetlogStage(ctx, frame, localProgress)
  drawSetlogFooter(ctx, frames, frameIndex)
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

  const layoutMode = options.layoutMode ?? 'stage'
  const pacingMode = options.pacingMode ?? 'auto'
  const mimeType = pickMimeType()
  const canvas = document.createElement('canvas')
  canvas.width = STORY_WIDTH
  canvas.height = STORY_HEIGHT
  const ctx = canvas.getContext('2d')

  if (!ctx) throw new Error('Canvasを初期化できませんでした。')

  const frames = await prepareFrames(storyFrames, pacingMode)
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
        drawStoryFrame(ctx, frames, frameIndex, localProgress, globalProgress, layoutMode)
        options.onProgress?.(globalProgress)
        await wait(1000 / STORY_FPS)
      }

      elapsedBeforeFrame += frame.duration
    }

    drawStoryFrame(ctx, frames, frames.length - 1, 1, 1, layoutMode)
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
