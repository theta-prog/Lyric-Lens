import type { CameraOffInteractionSnapshot, CameraOffStudioScene, CameraOffVisualMode, FilmPresetId } from '../types'

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
  filmPresetId?: FilmPresetId
  filmPresetLabel?: string
  filmCssFilter?: string
  filmTintHue?: number
  filmTintSaturation?: number
  filmTintLightness?: number
  filmTintOpacity?: number
  filmGrainOpacity?: number
  filmVignetteOpacity?: number
  filmLeakHue?: number
  filmLeakOpacity?: number
  exportLongSide?: number
  tintHue: number
  tintSaturation: number
  tintLightness: number
  tintOpacity: number
  bpm?: number
  chordName?: string
  isChorus?: boolean
  chorusProgress?: number
  vocalIntensity?: number
  cameraOffMode?: CameraOffVisualMode
  cameraOffStudioScene?: CameraOffStudioScene
  studioLeftHue?: number
  studioRightHue?: number
  studioAccentHue?: number
  studioTextPrimaryHue?: number
  studioTextSecondaryHue?: number
  studioSaturation?: number
  studioLeftLightness?: number
  studioRightLightness?: number
  cameraOffInteraction?: CameraOffInteractionSnapshot
}

const DEFAULT_SIZE: CaptureSize = { width: 1080, height: 1920 }
const EXPORT_LONG_SIDE = 1600
const CAMERA_OFF_EXPORT_LONG_SIDE = 1280
const MOBILE_EXPORT_LONG_SIDE = 1280

function getExportLongSide(filter?: CaptureFilter | null) {
  if (filter?.exportLongSide && filter.exportLongSide > 0) {
    return filter.exportLongSide
  }

  if (typeof window === 'undefined') return EXPORT_LONG_SIDE

  const isSmallViewport = Math.min(window.innerWidth, window.innerHeight) <= 640
  const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const lowCoreDevice = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4
  const isCameraOff = Boolean(filter?.cameraOffMode)

  if (isCameraOff) return CAMERA_OFF_EXPORT_LONG_SIDE

  return isSmallViewport || isCoarsePointer || lowCoreDevice
    ? MOBILE_EXPORT_LONG_SIDE
    : EXPORT_LONG_SIDE
}

function normalizeExportSize(size?: CaptureSize, filter?: CaptureFilter | null): CaptureSize {
  if (!size || size.width <= 0 || size.height <= 0) {
    return DEFAULT_SIZE
  }

  const aspect = size.width / size.height
  const longSide = getExportLongSide(filter)
  const width = aspect >= 1 ? longSide : Math.round(longSide * aspect)
  const height = aspect >= 1 ? Math.round(longSide / aspect) : longSide

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
  const { canvas, width, height } = renderFrameCanvas(
    videoEl,
    phrase,
    activeWord,
    songTitle,
    frameNumber,
    size,
    filter,
    mirrorVideo,
  )

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.86), width, height }
}

export async function captureFrameAsync(
  videoEl: HTMLVideoElement | null,
  phrase: string,
  activeWord: string,
  songTitle: string,
  frameNumber: number,
  size?: CaptureSize,
  filter?: CaptureFilter | null,
  mirrorVideo = true,
): Promise<CapturedFrame> {
  const { canvas, width, height } = renderFrameCanvas(
    videoEl,
    phrase,
    activeWord,
    songTitle,
    frameNumber,
    size,
    filter,
    mirrorVideo,
  )
  const blob = await new Promise<Blob | null>(resolve => {
    canvas.toBlob(resolve, 'image/jpeg', 0.86)
  })

  if (!blob) {
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), width, height }
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('画像のエンコードに失敗しました。'))
    reader.readAsDataURL(blob)
  })

  return { dataUrl, width, height }
}

function renderFrameCanvas(
  videoEl: HTMLVideoElement | null,
  phrase: string,
  activeWord: string,
  songTitle: string,
  frameNumber: number,
  size?: CaptureSize,
  filter?: CaptureFilter | null,
  mirrorVideo = true,
) {
  const { width, height } = normalizeExportSize(size, filter)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return { canvas, width, height }
  }

  renderBase(ctx, width, height, videoEl, phrase, activeWord, songTitle, filter, mirrorVideo)
  drawColorFilter(ctx, width, height, filter)
  drawFilmLook(ctx, width, height, filter)
  drawViewfinder(ctx, width, height)
  drawLyrics(ctx, width, height, phrase, activeWord)
  drawHud(ctx, width, height, songTitle, frameNumber)

  return { canvas, width, height }
}

function renderBase(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  videoEl: HTMLVideoElement | null,
  phrase: string,
  activeWord: string,
  songTitle: string,
  filter?: CaptureFilter | null,
  mirrorVideo = true,
) {
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  if (filter?.canvasFilter && filter.canvasFilter !== 'none') {
    ctx.filter = filter.canvasFilter
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

  drawCameraOffBackdrop(ctx, width, height, phrase, activeWord, songTitle, filter)
  ctx.restore()
}

function drawFilmLook(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  filter?: CaptureFilter | null,
) {
  if (!filter?.filmPresetId) return

  const shortSide = Math.min(width, height)
  ctx.save()

  if (filter.filmTintOpacity && filter.filmTintOpacity > 0) {
    ctx.globalAlpha = Math.min(0.46, Math.max(0, filter.filmTintOpacity))
    ctx.globalCompositeOperation = filter.filmPresetId === 'mono-800' ? 'saturation' : 'multiply'
    ctx.fillStyle = `hsl(${filter.filmTintHue ?? filter.tintHue} ${filter.filmTintSaturation ?? 38}% ${filter.filmTintLightness ?? 58}%)`
    ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'source-over'
  }

  if (filter.filmLeakOpacity && filter.filmLeakOpacity > 0) {
    const leak = ctx.createRadialGradient(width * 0.08, height * 0.18, 0, width * 0.08, height * 0.18, width * 0.62)
    leak.addColorStop(0, `hsl(${filter.filmLeakHue ?? 38} 92% 62% / ${filter.filmLeakOpacity})`)
    leak.addColorStop(0.38, `hsl(${filter.filmLeakHue ?? 38} 90% 58% / ${filter.filmLeakOpacity * 0.42})`)
    leak.addColorStop(1, 'transparent')
    ctx.fillStyle = leak
    ctx.fillRect(0, 0, width, height)
  }

  if (filter.filmGrainOpacity && filter.filmGrainOpacity > 0) {
    ctx.globalAlpha = Math.min(0.24, Math.max(0, filter.filmGrainOpacity))
    for (let i = 0; i < 260; i += 1) {
      const x = ((i * 137) % 997) / 997 * width
      const y = ((i * 271) % 991) / 991 * height
      const size = shortSide * (0.0016 + (i % 3) * 0.0009)
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#1a1a1f'
      ctx.fillRect(x, y, size, size)
    }
    ctx.globalAlpha = 1
  }

  const vignetteOpacity = Math.min(0.42, Math.max(0, filter.filmVignetteOpacity ?? 0.16))
  const vignette = ctx.createRadialGradient(width * 0.50, height * 0.46, shortSide * 0.20, width * 0.50, height * 0.50, Math.max(width, height) * 0.72)
  vignette.addColorStop(0, 'transparent')
  vignette.addColorStop(0.70, 'transparent')
  vignette.addColorStop(1, `rgba(26, 26, 31, ${vignetteOpacity})`)
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)

  ctx.globalAlpha = 0.20
  ctx.strokeStyle = '#fffdf8'
  ctx.lineWidth = Math.max(2, shortSide * 0.004)
  ctx.strokeRect(width * 0.028, height * 0.028, width * 0.944, height * 0.944)

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

function drawCameraOffBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phrase: string,
  activeWord: string,
  songTitle: string,
  filter?: CaptureFilter | null,
) {
  if (!filter?.cameraOffMode || filter.cameraOffMode === 'classic') {
    drawClassicCameraOffBackdrop(ctx, width, height)
    return
  }

  const shortSide = Math.min(width, height)
  const hue = filter?.tintHue ?? 190
  const mode = filter.cameraOffMode
  const energyBoost = mode === 'signal-pop' ? 0.22 : mode === 'film-studio' ? -0.03 : 0
  const energy = Math.max(0.14, Math.min(1, (filter?.vocalIntensity ?? 0.24) + energyBoost))
  const chorusProgress = Math.max(0, Math.min(1, filter?.chorusProgress ?? 0))
  const scene = filter?.cameraOffStudioScene ?? (filter?.isChorus ? 'chorus' : energy > 0.58 ? 'build' : 'verse')
  const text = (activeWord || phrase || songTitle || 'Lyric Lens').trim()
  const leftHue = filter?.studioLeftHue ?? 190
  const rightHue = filter?.studioRightHue ?? 48
  const accentHue = filter?.studioAccentHue ?? 190
  const textPrimaryHue = filter?.studioTextPrimaryHue ?? 48
  const textSecondaryHue = filter?.studioTextSecondaryHue ?? 190
  const saturation = filter?.studioSaturation ?? 78
  const leftLightness = filter?.studioLeftLightness ?? 81
  const rightLightness = filter?.studioRightLightness ?? 66

  ctx.save()
  ctx.fillStyle = mode === 'film-studio' ? '#f8f1e5' : '#fffdf8'
  ctx.fillRect(0, 0, width, height)

  const bg = ctx.createLinearGradient(0, 0, width, height)
  bg.addColorStop(0, `hsl(${leftHue} ${saturation}% ${leftLightness}%)`)
  bg.addColorStop(0.46, `hsl(${leftHue} ${saturation}% ${leftLightness}%)`)
  bg.addColorStop(0.51, '#fffdf8')
  bg.addColorStop(0.56, `hsl(${rightHue} ${saturation}% ${rightLightness}%)`)
  bg.addColorStop(1, `hsl(${rightHue} ${saturation}% ${rightLightness}%)`)
  ctx.globalAlpha = 0.92
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  ctx.globalAlpha = 1

  if (mode === 'film-studio') {
    drawFilmStudioTexture(ctx, width, height, shortSide)
  }

  drawMvContactSheet(ctx, width, height, shortSide, scene)
  drawMvCardStack(ctx, width, height, shortSide, scene, {
    leftHue,
    rightHue,
    saturation,
    leftLightness,
    rightLightness,
  })
  drawMvAperture(ctx, width, height, shortSide, hue, scene)
  drawMvShutterGate(ctx, width, height, shortSide, hue, scene)
  drawMvFilmStrip(ctx, width, height, shortSide, true)
  drawMvFilmStrip(ctx, width, height, shortSide, false)
  drawMvParticles(ctx, width, height, shortSide, energy)

  if (mode === 'signal-pop') {
    drawSignalPopBars(ctx, width, height, shortSide, hue, energy, filter?.chordName)
  }

  drawCameraOffInteraction(ctx, width, height, shortSide, filter?.cameraOffInteraction, hue)

  drawSketchLine(ctx, width * -0.10, height * 0.74, width * 1.08, height * 0.22, '#ffffff', 0.50 + energy * 0.10, shortSide * 0.018)
  drawSketchLine(ctx, width * -0.08, height * 0.46, width * 1.03, height * 0.58, '#1a1a1f', 0.10 + energy * 0.06, shortSide * 0.006)
  drawSketchLine(ctx, width * 0.08, height * 0.20, width * 0.44, height * 0.74, `hsl(${accentHue} ${saturation}% 50%)`, 0.18, shortSide * 0.010)

  if (scene === 'chorus') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.86)'
    ctx.lineWidth = shortSide * 0.014
    ctx.strokeRect(width * 0.06, height * 0.08, width * 0.88, height * 0.84)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.84)'
    ctx.fillRect(width * 0.06, height * 0.08, width * 0.88 * Math.max(0.08, chorusProgress), shortSide * 0.012)
  } else if (scene === 'build') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)'
    ctx.lineWidth = shortSide * 0.009
    ctx.setLineDash([shortSide * 0.030, shortSide * 0.018])
    ctx.strokeRect(width * 0.10, height * 0.13, width * 0.80, height * 0.70)
    ctx.setLineDash([])
  }

  ctx.save()
  ctx.translate(width * 0.52, height * 0.43)
  ctx.rotate(scene === 'chorus' ? -0.045 : -0.08)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  drawMvStickerText(ctx, {
    text,
    maxWidth: width * 0.86,
    baseFontSize: shortSide * 0.18,
    minFontSize: shortSide * 0.055,
    strokeWidth: Math.max(12, shortSide * 0.032),
    secondaryColor: `hsl(${textSecondaryHue} ${saturation}% 52%)`,
    primaryColor: `hsl(${textPrimaryHue} ${saturation}% 56%)`,
    primaryAlpha: scene === 'chorus' ? 0.96 : 0.88,
    offset: shortSide * 0.012,
  })
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = 0.70
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 12; i += 1) {
    const barHeight = height * (0.05 + ((i * 17) % 36) / 100 + energy * 0.12)
    ctx.fillRect(width * (0.10 + i * 0.068), height * 0.82 - barHeight, shortSide * 0.009, barHeight)
  }
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.90)'
  ctx.lineWidth = Math.max(3, shortSide * 0.008)
  roundRect(ctx, width * 0.045, height * 0.045, width * 0.91, height * 0.91, shortSide * 0.012)
  ctx.stroke()
  ctx.restore()

  ctx.restore()
}

function drawFilmStudioTexture(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shortSide: number,
) {
  ctx.save()
  ctx.globalAlpha = 0.18
  ctx.fillStyle = '#1a1a1f'
  for (let i = 0; i < 90; i += 1) {
    const x = ((i * 137) % 1000) / 1000 * width
    const y = ((i * 277) % 1000) / 1000 * height
    ctx.fillRect(x, y, shortSide * 0.0025, shortSide * 0.0025)
  }
  ctx.globalAlpha = 0.16
  ctx.fillStyle = '#fffdf8'
  ctx.fillRect(0, 0, width, height * 0.08)
  ctx.fillRect(0, height * 0.92, width, height * 0.08)
  ctx.globalAlpha = 0.28
  ctx.strokeStyle = '#1a1a1f'
  ctx.lineWidth = Math.max(2, shortSide * 0.004)
  ctx.strokeRect(width * 0.08, height * 0.08, width * 0.84, height * 0.84)
  ctx.restore()
}

function drawSignalPopBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shortSide: number,
  hue: number,
  energy: number,
  chordName?: string,
) {
  ctx.save()
  ctx.globalAlpha = 0.66
  for (let i = 0; i < 10; i += 1) {
    const barWidth = width * (0.08 + ((i * 13) % 22) / 100)
    const x = i % 2 === 0 ? 0 : width - barWidth
    const y = height * (0.12 + i * 0.074)
    ctx.fillStyle = `hsl(${(hue + i * 18) % 360} 86% ${48 + (i % 3) * 7}%)`
    ctx.fillRect(x, y, barWidth * (0.62 + energy * 0.38), shortSide * 0.014)
  }

  if (chordName) {
    ctx.translate(width * 0.50, height * 0.17)
    ctx.rotate(-0.055)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `900 ${shortSide * 0.092}px "Barlow Condensed", Impact, sans-serif`
    ctx.lineWidth = shortSide * 0.014
    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = '#1a1a1f'
    ctx.strokeText(chordName, 0, 0)
    ctx.fillText(chordName, 0, 0)
  }
  ctx.restore()
}

function drawCameraOffInteraction(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shortSide: number,
  interaction: CameraOffInteractionSnapshot | undefined,
  fallbackHue: number,
) {
  if (!interaction) return

  const x = interaction.x * width
  const y = interaction.y * height
  const hue = interaction.hue ?? fallbackHue
  const intensity = Math.max(0.2, Math.min(1, interaction.intensity))

  ctx.save()
  if (interaction.kind === 'drag-trail') {
    const filmHeight = shortSide * 0.078
    const dragLeak = ctx.createRadialGradient(x, y, 0, x, y, shortSide * 0.48)
    dragLeak.addColorStop(0, 'rgba(255, 255, 255, 0.34)')
    dragLeak.addColorStop(0.28, `hsl(${hue} 92% 66% / ${0.18 + intensity * 0.16})`)
    dragLeak.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.globalAlpha = 0.88
    ctx.filter = `blur(${Math.round(shortSide * 0.018)}px)`
    ctx.fillStyle = dragLeak
    ctx.fillRect(0, 0, width, height)
    ctx.filter = 'none'

    ctx.globalAlpha = 0.46 + intensity * 0.18
    ctx.fillStyle = interaction.preset === 'film-studio'
      ? 'rgba(255, 253, 248, 0.82)'
      : `hsl(${hue} 82% 58% / 0.46)`
    ctx.fillRect(0, y - filmHeight / 2, width, filmHeight)
    ctx.fillStyle = 'rgba(26, 26, 31, 0.40)'
    const holeWidth = shortSide * 0.018
    const holeHeight = filmHeight * 0.46
    for (let ix = -holeWidth; ix < width + holeWidth; ix += holeWidth * 2.6) {
      ctx.fillRect(ix, y - filmHeight * 0.38, holeWidth, holeHeight)
      ctx.fillRect(ix + holeWidth * 0.8, y + filmHeight * 0.02, holeWidth, holeHeight)
    }

    const leak = ctx.createLinearGradient(0, y - shortSide * 0.24, width, y + shortSide * 0.18)
    leak.addColorStop(0, `hsl(${hue} 92% 62% / ${0.34 + intensity * 0.18})`)
    leak.addColorStop(0.42, 'rgba(255, 255, 255, 0.34)')
    leak.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.globalAlpha = 0.78
    ctx.filter = `blur(${Math.round(shortSide * 0.006)}px)`
    ctx.fillStyle = leak
    ctx.beginPath()
    ctx.moveTo(0, y - shortSide * 0.22)
    ctx.lineTo(width, y - shortSide * 0.06)
    ctx.lineTo(width, y + shortSide * 0.18)
    ctx.lineTo(0, y + shortSide * 0.05)
    ctx.closePath()
    ctx.fill()
    ctx.filter = 'none'

    ctx.globalAlpha = 0.58 + intensity * 0.18
    ctx.strokeStyle = '#fffdf8'
    ctx.lineWidth = shortSide * 0.018
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    if (interaction.points && interaction.points.length > 1) {
      interaction.points.forEach((point, index) => {
        const px = point.x * width
        const py = point.y * height
        if (index === 0) {
          ctx.moveTo(px, py)
        } else {
          ctx.lineTo(px, py)
        }
      })
    } else {
      ctx.moveTo(x - width * 0.18, y + height * 0.10)
      ctx.quadraticCurveTo(x, y - height * 0.08, x + width * 0.20, y + height * 0.04)
    }
    ctx.stroke()
    ctx.globalAlpha = 0.64
    ctx.fillStyle = 'rgba(255, 253, 248, 0.92)'
    for (const point of interaction.points ?? []) {
      ctx.fillRect(point.x * width - shortSide * 0.010, point.y * height - shortSide * 0.010, shortSide * 0.020, shortSide * 0.020)
    }
  } else if (interaction.kind === 'press-charge' || interaction.kind === 'press-arming') {
    const tankWidth = shortSide * (interaction.kind === 'press-arming' ? 0.44 : 0.58)
    const tankHeight = shortSide * (interaction.kind === 'press-arming' ? 0.26 : 0.34)
    const fillHeight = tankHeight * (interaction.kind === 'press-arming' ? 0.42 : 0.76)
    const exposureRadius = shortSide * (interaction.kind === 'press-arming' ? 0.38 : 0.58)
    const exposure = ctx.createRadialGradient(x, y, 0, x, y, exposureRadius)
    exposure.addColorStop(0, `rgba(255, 255, 255, ${interaction.kind === 'press-arming' ? 0.30 : 0.52})`)
    exposure.addColorStop(0.36, `hsl(${hue} 90% 64% / ${interaction.kind === 'press-arming' ? 0.16 : 0.28})`)
    exposure.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.globalAlpha = 0.82
    ctx.filter = `blur(${Math.round(shortSide * (interaction.kind === 'press-arming' ? 0.010 : 0.018))}px)`
    ctx.fillStyle = exposure
    ctx.fillRect(0, 0, width, height)
    ctx.filter = 'none'

    if (interaction.kind === 'press-charge') {
      ctx.globalAlpha = 0.18 + intensity * 0.16
      ctx.fillStyle = '#fffdf8'
      ctx.fillRect(0, 0, width, height)
    }

    ctx.globalAlpha = 0.34 + intensity * 0.24
    ctx.fillStyle = 'rgba(255, 253, 248, 0.22)'
    ctx.fillRect(x - tankWidth / 2, y - tankHeight / 2, tankWidth, tankHeight)
    ctx.fillStyle = interaction.preset === 'film-studio'
      ? 'rgba(26, 26, 31, 0.40)'
      : `hsl(${hue} 84% 52% / 0.56)`
    ctx.fillRect(x - tankWidth / 2, y + tankHeight / 2 - fillHeight, tankWidth, fillHeight)
    ctx.globalAlpha = 0.76
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.lineWidth = shortSide * 0.010
    ctx.strokeRect(x - tankWidth / 2, y - tankHeight / 2, tankWidth, tankHeight)
    ctx.globalAlpha = 0.50 + intensity * 0.20
    ctx.fillStyle = '#ffffff'
    const meterHeight = shortSide * 0.040
    ctx.fillRect(x - tankWidth * 0.42, y - tankHeight * 0.72, tankWidth * (0.38 + intensity * 0.42), meterHeight)
    ctx.fillStyle = 'rgba(26, 26, 31, 0.40)'
    for (let i = 0; i < 7; i += 1) {
      ctx.fillRect(x - tankWidth * 0.42 + i * tankWidth * 0.12, y - tankHeight * 0.72, shortSide * 0.004, meterHeight)
    }
  } else if (interaction.kind === 'tap-burst') {
    const tapBlur = ctx.createRadialGradient(x, y, 0, x, y, shortSide * 0.22)
    tapBlur.addColorStop(0, 'rgba(255, 255, 255, 0.28)')
    tapBlur.addColorStop(0.36, `hsl(${hue} 88% 64% / 0.14)`)
    tapBlur.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.globalAlpha = 0.88
    ctx.filter = `blur(${Math.round(shortSide * 0.010)}px)`
    ctx.fillStyle = tapBlur
    ctx.beginPath()
    ctx.arc(x, y, shortSide * 0.24, 0, Math.PI * 2)
    ctx.fill()
    ctx.filter = 'none'
    ctx.globalAlpha = 0.28
    ctx.strokeStyle = '#fffdf8'
    ctx.lineWidth = shortSide * 0.006
    ctx.beginPath()
    ctx.arc(x, y, shortSide * 0.16, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.globalAlpha = 0.32 + intensity * 0.26
    ctx.strokeStyle = `hsl(${hue} 86% 52%)`
    ctx.lineWidth = shortSide * 0.010
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath()
      ctx.arc(x, y, shortSide * (0.11 + i * 0.07), 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  ctx.restore()
}

function drawMvStickerText(
  ctx: CanvasRenderingContext2D,
  options: {
    text: string
    maxWidth: number
    baseFontSize: number
    minFontSize: number
    strokeWidth: number
    secondaryColor: string
    primaryColor: string
    primaryAlpha: number
    offset: number
  },
) {
  const { text, maxWidth, minFontSize } = options
  let fontSize = options.baseFontSize
  let lines = [text]

  while (fontSize >= minFontSize) {
    ctx.font = `900 ${fontSize}px "Noto Sans JP", sans-serif`
    lines = wrapTextForWidth(ctx, text, maxWidth, 2)
    if (lines.length <= 2 && lines.every(line => ctx.measureText(line).width <= maxWidth)) break
    fontSize *= 0.92
  }

  ctx.font = `900 ${fontSize}px "Noto Sans JP", sans-serif`
  if (lines.some(line => ctx.measureText(line).width > maxWidth)) {
    lines = splitTextNearMiddle(text)
  }

  const lineHeight = fontSize * 0.98
  const firstY = -((lines.length - 1) * lineHeight) / 2

  for (const [index, line] of lines.entries()) {
    const y = firstY + index * lineHeight
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = options.strokeWidth
    ctx.strokeText(line, 0, y)
    ctx.globalAlpha = 0.84
    ctx.fillStyle = options.secondaryColor
    ctx.fillText(line, -options.offset, y - options.offset)
    ctx.globalAlpha = options.primaryAlpha
    ctx.fillStyle = options.primaryColor
    ctx.fillText(line, options.offset, y + options.offset)
  }
  ctx.globalAlpha = 1
}

function wrapTextForWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
) {
  const chars = Array.from(text)
  const lines: string[] = []
  let current = ''

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]
    const next = current + char
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current)
      current = char
      if (lines.length === maxLines) {
        lines[lines.length - 1] += chars.slice(index).join('')
        return lines
      }
    } else {
      current = next
    }
  }

  if (current) lines.push(current)
  return lines
}

function splitTextNearMiddle(text: string) {
  const chars = Array.from(text)
  if (chars.length <= 1) return [text]
  const middle = Math.ceil(chars.length / 2)
  return [chars.slice(0, middle).join(''), chars.slice(middle).join('')]
}

function drawMvParticles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shortSide: number,
  energy: number,
) {
  ctx.save()
  const dots = 42
  for (let i = 0; i < dots; i += 1) {
    const x = ((i * 97) % 1000) / 1000 * width
    const y = ((i * 193) % 1000) / 1000 * height
    const isBlue = i % 7 === 0
    ctx.globalAlpha = isBlue ? 0.74 : 0.52 + energy * 0.22
    ctx.fillStyle = isBlue ? '#1676e5' : '#f2bd00'
    ctx.beginPath()
    ctx.arc(x, y, shortSide * (isBlue ? 0.004 : 0.0035), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawMvCardStack(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shortSide: number,
  scene: CameraOffStudioScene,
  palette: {
    leftHue: number
    rightHue: number
    saturation: number
    leftLightness: number
    rightLightness: number
  },
) {
  const cards = [
    { x: width * 0.12, y: height * 0.11, s: 0.90, r: -3, a: scene === 'verse' ? 0.20 : 0.28 },
    { x: width * 0.60, y: height * 0.12, s: 1.00, r: 2, a: scene === 'chorus' ? 0.36 : 0.26 },
    { x: width * 0.43, y: height * 0.62, s: 0.72, r: -1, a: 0.22 },
  ]

  for (const card of cards) {
    const cardW = shortSide * 0.30 * card.s
    const cardH = cardW * 1.24
    ctx.save()
    ctx.translate(card.x + cardW / 2, card.y + cardH / 2)
    ctx.rotate((card.r * Math.PI) / 180)
    ctx.globalAlpha = card.a
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, shortSide * 0.012)
    ctx.fill()
    ctx.strokeStyle = 'rgba(26, 26, 31, 0.12)'
    ctx.lineWidth = Math.max(1, shortSide * 0.003)
    ctx.stroke()
    ctx.fillStyle = `hsl(${palette.leftHue} ${palette.saturation}% ${palette.leftLightness}%)`
    ctx.fillRect(-cardW / 2, -cardH / 2, cardW, cardH * 0.68)
    ctx.fillStyle = `hsl(${palette.rightHue} ${palette.saturation}% ${palette.rightLightness}%)`
    ctx.fillRect(-cardW / 2 + cardW * 0.54, -cardH / 2, cardW * 0.46, cardH * 0.68)
    ctx.restore()
  }
}

function drawMvContactSheet(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shortSide: number,
  scene: CameraOffStudioScene,
) {
  ctx.save()
  ctx.globalAlpha = scene === 'verse' ? 0.10 : 0.16
  ctx.strokeStyle = '#f5f2ed'
  ctx.lineWidth = Math.max(1, shortSide * 0.003)
  const cellW = width * 0.18
  const cellH = height * 0.12
  for (let y = -cellH; y < height + cellH; y += cellH * 1.45) {
    for (let x = -cellW; x < width + cellW; x += cellW * 1.25) {
      ctx.strokeRect(x, y, cellW, cellH)
    }
  }
  ctx.restore()
}

function drawMvShutterGate(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shortSide: number,
  hue: number,
  scene: CameraOffStudioScene,
) {
  ctx.save()
  ctx.translate(width * 0.50, height * 0.47)
  ctx.rotate(-0.08)
  void hue
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)'
  ctx.lineWidth = Math.max(4, shortSide * 0.009)
  const gateW = shortSide * (scene === 'chorus' ? 0.62 : 0.52)
  const gateH = shortSide * (scene === 'build' ? 0.30 : 0.24)
  ctx.strokeRect(-gateW / 2, -gateH / 2, gateW, gateH)
  ctx.beginPath()
  ctx.moveTo(-gateW * 0.62, 0)
  ctx.lineTo(-gateW * 0.36, 0)
  ctx.moveTo(gateW * 0.36, 0)
  ctx.lineTo(gateW * 0.62, 0)
  ctx.moveTo(0, -gateH * 0.72)
  ctx.lineTo(0, -gateH * 0.42)
  ctx.moveTo(0, gateH * 0.42)
  ctx.lineTo(0, gateH * 0.72)
  ctx.stroke()
  ctx.restore()
}

function drawClassicCameraOffBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number) {
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

function drawMvAperture(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shortSide: number,
  hue: number,
  scene: CameraOffStudioScene,
) {
  ctx.save()
  ctx.translate(width * 0.50, height * 0.47)
  ctx.rotate(((scene === 'chorus' ? 18 : scene === 'build' ? 6 : -7) * Math.PI) / 180)
  void hue
  ctx.globalAlpha = scene === 'verse' ? 0.22 : 0.34
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = shortSide * 0.01
  ctx.beginPath()
  ctx.arc(0, 0, shortSide * 0.34, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.18
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 7; i += 1) {
    ctx.save()
    ctx.rotate((i * Math.PI * 2) / 7)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(shortSide * 0.10, -shortSide * 0.30)
    ctx.lineTo(shortSide * 0.40, -shortSide * 0.22)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  ctx.restore()
}

function drawMvFilmStrip(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shortSide: number,
  left: boolean,
) {
  const stripWidth = shortSide * 0.075
  const x = left ? width * 0.025 : width - width * 0.025 - stripWidth

  ctx.save()
  ctx.globalAlpha = 0.46
  ctx.fillStyle = 'rgba(255, 255, 255, 0.30)'
  ctx.fillRect(x, 0, stripWidth, height)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
  const holeW = stripWidth * 0.46
  const holeH = shortSide * 0.045
  for (let y = shortSide * 0.025; y < height; y += shortSide * 0.088) {
    ctx.fillRect(x + stripWidth * 0.27, y, holeW, holeH)
  }
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
  ctx.shadowColor = 'rgba(0, 0, 0, 0.52)'
  ctx.shadowBlur = Math.max(8, Math.min(width, height) * 0.012)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
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
