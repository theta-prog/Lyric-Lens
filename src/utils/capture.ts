interface CaptureSize {
  width: number
  height: number
}

export interface CapturedFrame {
  dataUrl: string
  width: number
  height: number
}

export interface CaptureFilter {
  canvasFilter?: string
  tintHue: number
  tintSaturation: number
  tintLightness: number
  tintOpacity: number
}

const DEFAULT_SIZE: CaptureSize = { width: 1080, height: 1920 }
const EXPORT_LONG_SIDE = 1920

function normalizeExportSize(size?: CaptureSize): CaptureSize {
  if (!size || size.width <= 0 || size.height <= 0) {
    return DEFAULT_SIZE
  }

  const aspect = size.width / size.height
  const width = aspect >= 1 ? EXPORT_LONG_SIDE : Math.round(EXPORT_LONG_SIDE * aspect)
  const height = aspect >= 1 ? Math.round(EXPORT_LONG_SIDE / aspect) : EXPORT_LONG_SIDE

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  }
}

export function captureFrame(
  videoEl: HTMLVideoElement | null,
  phrase: string,
  activeWord: string,
  songTitle: string,
  frameNumber: number,
  size?: CaptureSize,
  filter?: CaptureFilter | null,
  mirrorVideo = true,
): CapturedFrame {
  const { width, height } = normalizeExportSize(size)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return { dataUrl: '', width, height }
  }

  renderBase(ctx, width, height, videoEl, filter?.canvasFilter, mirrorVideo)
  drawColorFilter(ctx, width, height, filter)
  drawViewfinder(ctx, width, height)
  drawLyrics(ctx, width, height, phrase, activeWord)
  drawHud(ctx, width, height, songTitle, frameNumber)

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width, height }
}

function renderBase(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  videoEl: HTMLVideoElement | null,
  canvasFilter?: string,
  mirrorVideo = true,
) {
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  if (canvasFilter && canvasFilter !== 'none') {
    ctx.filter = canvasFilter
  }

  if (videoEl && videoEl.videoWidth > 0) {
    const scale = Math.max(width / videoEl.videoWidth, height / videoEl.videoHeight)
    const sw = videoEl.videoWidth * scale
    const sh = videoEl.videoHeight * scale
    const ox = (width - sw) / 2
    const oy = (height - sh) / 2
    if (mirrorVideo) {
      ctx.translate(width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(videoEl, ox, oy, sw, sh)
    ctx.restore()
    return
  }

  const bg = ctx.createLinearGradient(0, 0, width, height)
  bg.addColorStop(0, '#fffef8')
  bg.addColorStop(0.44, '#e9fbff')
  bg.addColorStop(1, '#fff1b8')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  drawCameraOffBackdrop(ctx, width, height)
  ctx.restore()
}

function drawColorFilter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  filter?: CaptureFilter | null,
) {
  if (!filter || filter.tintOpacity <= 0) return

  ctx.save()
  ctx.globalAlpha = Math.min(0.5, Math.max(0, filter.tintOpacity))
  ctx.fillStyle = `hsl(${filter.tintHue} ${filter.tintSaturation}% ${filter.tintLightness}%)`
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

function drawCameraOffBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const shortSide = Math.min(width, height)
  drawSketchLine(ctx, width * -0.05, height, width * 0.22, 0, '#3dd6e8', 0.09, shortSide * 0.012)
  drawSketchLine(ctx, width * 0.18, height, width * 0.44, 0, '#f5c842', 0.10, shortSide * 0.012)
  drawSketchLine(ctx, width * 0.48, height, width * 0.73, 0, '#3dd6e8', 0.08, shortSide * 0.012)
  drawSketchLine(ctx, width * 0.84, height, width * 1.08, 0, '#f5c842', 0.08, shortSide * 0.012)

  drawRotatedFrame(ctx, {
    x: width * 0.12,
    y: height * 0.32,
    width: width * 0.21,
    height: height * 0.14,
    angle: -10,
    stroke: '#3dd6e8',
    alpha: 0.32,
    lineWidth: shortSide * 0.014,
  })

  drawRotatedFrame(ctx, {
    x: width * 0.60,
    y: height * 0.31,
    width: width * 0.36,
    height: height * 0.11,
    angle: 8,
    stroke: '#f5c842',
    alpha: 0.42,
    lineWidth: shortSide * 0.012,
  })

  drawRotatedFrame(ctx, {
    x: width * 0.08,
    y: height * 0.66,
    width: width * 0.47,
    height: height * 0.21,
    angle: 3,
    stroke: '#1a1a1f',
    alpha: 0.08,
    lineWidth: shortSide * 0.014,
  })

  ctx.save()
  ctx.globalAlpha = 0.18
  ctx.translate(width * 0.80, height * 0.76)
  ctx.rotate((-8 * Math.PI) / 180)
  ctx.fillStyle = '#f5c842'
  ctx.strokeStyle = '#3dd6e8'
  ctx.lineWidth = shortSide * 0.018
  ctx.beginPath()
  ctx.arc(0, 0, shortSide * 0.09, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawSketchLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  alpha: number,
  width: number,
) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.restore()
}

function drawRotatedFrame(
  ctx: CanvasRenderingContext2D,
  frame: {
    x: number
    y: number
    width: number
    height: number
    angle: number
    stroke: string
    alpha: number
    lineWidth: number
  },
) {
  ctx.save()
  ctx.translate(frame.x + frame.width / 2, frame.y + frame.height / 2)
  ctx.rotate((frame.angle * Math.PI) / 180)
  ctx.globalAlpha = frame.alpha
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = frame.stroke
  ctx.lineWidth = frame.lineWidth
  ctx.fillRect(-frame.width / 2, -frame.height / 2, frame.width, frame.height)
  ctx.strokeRect(-frame.width / 2, -frame.height / 2, frame.width, frame.height)
  ctx.restore()
}

function drawViewfinder(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save()
  ctx.strokeStyle = 'rgba(61, 214, 232, 0.45)'
  ctx.lineWidth = 2
  ctx.setLineDash([12, 16])
  const insetX = width * 0.055
  const insetY = height * 0.075
  ctx.strokeRect(insetX, insetY, width - insetX * 2, height - insetY * 2)
  ctx.setLineDash([])

  ctx.strokeStyle = 'rgba(61, 214, 232, 0.24)'
  for (const x of [width / 3, (width / 3) * 2]) {
    ctx.beginPath()
    ctx.moveTo(x, insetY + 20)
    ctx.lineTo(x, height - insetY - 20)
    ctx.stroke()
  }
  for (const y of [height / 3, (height / 3) * 2]) {
    ctx.beginPath()
    ctx.moveTo(insetX + 20, y)
    ctx.lineTo(width - insetX - 20, y)
    ctx.stroke()
  }

  ctx.strokeStyle = '#3dd6e8'
  ctx.lineWidth = 6
  const length = Math.min(width, height) * 0.085
  const pad = Math.min(width, height) * 0.065
  drawCorner(ctx, pad, pad + 50, length, 1, 1)
  drawCorner(ctx, width - pad, pad + 50, length, -1, 1)
  drawCorner(ctx, pad, height - pad - 50, length, 1, -1)
  drawCorner(ctx, width - pad, height - pad - 50, length, -1, -1)
  ctx.restore()
}

function drawCorner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  sx: 1 | -1,
  sy: 1 | -1,
) {
  ctx.beginPath()
  ctx.moveTo(x, y + length * sy)
  ctx.lineTo(x, y)
  ctx.lineTo(x + length * sx, y)
  ctx.stroke()
}

function splitPhraseByWord(phrase: string, word: string) {
  if (!phrase) {
    return { before: '', active: '', after: '' }
  }

  if (!word) {
    return { before: '', active: phrase, after: '' }
  }

  const index = phrase.indexOf(word)
  if (index < 0) {
    return { before: '', active: phrase, after: '' }
  }

  return {
    before: phrase.slice(0, index),
    active: phrase.slice(index, index + word.length),
    after: phrase.slice(index + word.length),
  }
}

function drawSegmentedText(
  ctx: CanvasRenderingContext2D,
  segments: { before: string; active: string; after: string },
  centerX: number,
  centerY: number,
  maxWidth: number,
  fontSize: number,
) {
  let activeFontSize = fontSize
  const fullText = `${segments.before}${segments.active}${segments.after}`

  while (activeFontSize > 18) {
    ctx.font = `900 ${activeFontSize}px "Noto Sans JP", sans-serif`
    if (ctx.measureText(fullText).width <= maxWidth) break
    activeFontSize -= 2
  }

  const beforeWidth = ctx.measureText(segments.before).width
  const activeWidth = ctx.measureText(segments.active).width
  const afterWidth = ctx.measureText(segments.after).width
  let x = centerX - (beforeWidth + activeWidth + afterWidth) / 2

  ctx.globalAlpha = 0.64
  ctx.fillStyle = '#3dd6e8'
  ctx.fillText(segments.before, x, centerY)
  x += beforeWidth

  ctx.globalAlpha = 1
  ctx.fillStyle = '#ffffff'
  ctx.fillText(segments.active, x, centerY)
  x += activeWidth

  ctx.globalAlpha = 0.64
  ctx.fillStyle = '#3dd6e8'
  ctx.fillText(segments.after, x, centerY)
  ctx.globalAlpha = 1
}

function drawLyrics(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phrase: string,
  activeWord: string,
) {
  if (!phrase) return

  ctx.save()
  const text = phrase.trim()
  const maxWidth = width * 0.82
  const fontSize = Math.min(width, height) * (text.length > 20 ? 0.052 : 0.067)
  ctx.font = `900 ${fontSize}px "Noto Sans JP", sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const boxH = Math.max(96, height * 0.09)
  const boxY = height * 0.70
  ctx.fillStyle = 'rgba(26, 26, 31, 0.66)'
  roundRect(ctx, width * 0.08, boxY, width * 0.84, boxH, 16)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.lineWidth = Math.max(1, Math.min(width, height) * 0.003)
  ctx.stroke()

  ctx.shadowColor = 'rgba(0, 0, 0, 0.42)'
  ctx.shadowBlur = 14
  drawSegmentedText(ctx, splitPhraseByWord(text, activeWord.trim()), width / 2, boxY + boxH / 2, maxWidth, fontSize)
  ctx.restore()
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  songTitle: string,
  frameNumber: number,
) {
  ctx.save()
  const fontSize = Math.max(24, Math.min(width, height) * 0.028)
  const inset = width * 0.055
  ctx.font = `700 ${fontSize}px "Barlow Condensed", sans-serif`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(26, 26, 31, 0.78)'
  ctx.fillText('SS 1/250', inset, height * 0.032)
  ctx.textAlign = 'right'
  ctx.fillText('f/1.8  ISO AUTO', width - inset, height * 0.032)
  ctx.textAlign = 'left'
  ctx.fillText((songTitle || 'Lyric Lens').toUpperCase(), inset, height - height * 0.032)
  ctx.textAlign = 'right'
  ctx.fillStyle = '#f5c842'
  ctx.fillText(`● ${String(frameNumber).padStart(4, '0')}`, width - inset, height - height * 0.032)
  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}
