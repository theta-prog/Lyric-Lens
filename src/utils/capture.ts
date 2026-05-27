const W = 1280
const H = 720

export function captureFrame(
  videoEl: HTMLVideoElement | null,
  phrase: string,
  songTitle: string,
  frameNumber: number,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return ''
  }

  renderBase(ctx, videoEl)
  drawViewfinder(ctx)
  drawLyrics(ctx, phrase)
  drawHud(ctx, songTitle, frameNumber)

  return canvas.toDataURL('image/jpeg', 0.9)
}

function renderBase(ctx: CanvasRenderingContext2D, videoEl: HTMLVideoElement | null) {
  ctx.clearRect(0, 0, W, H)

  if (videoEl && videoEl.videoWidth > 0) {
    ctx.save()
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(videoEl, 0, 0, W, H)
    ctx.restore()
    return
  }

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#fffef8')
  bg.addColorStop(0.44, '#e9fbff')
  bg.addColorStop(1, '#fff1b8')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  ctx.globalAlpha = 0.28
  for (let i = 0; i < 18; i += 1) {
    ctx.beginPath()
    ctx.arc((i * 97) % W, 90 + ((i * 73) % 460), 70 + (i % 4) * 22, 0, Math.PI * 2)
    ctx.fillStyle = i % 2 === 0 ? '#3dd6e8' : '#f5c842'
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawViewfinder(ctx: CanvasRenderingContext2D) {
  ctx.save()
  ctx.strokeStyle = 'rgba(61, 214, 232, 0.45)'
  ctx.lineWidth = 2
  ctx.setLineDash([12, 16])
  ctx.strokeRect(96, 64, W - 192, H - 128)
  ctx.setLineDash([])

  ctx.strokeStyle = 'rgba(61, 214, 232, 0.24)'
  for (const x of [W / 3, (W / 3) * 2]) {
    ctx.beginPath()
    ctx.moveTo(x, 86)
    ctx.lineTo(x, H - 86)
    ctx.stroke()
  }
  for (const y of [H / 3, (H / 3) * 2]) {
    ctx.beginPath()
    ctx.moveTo(116, y)
    ctx.lineTo(W - 116, y)
    ctx.stroke()
  }

  ctx.strokeStyle = '#3dd6e8'
  ctx.lineWidth = 5
  const length = 74
  const pad = 82
  drawCorner(ctx, pad, pad, length, 1, 1)
  drawCorner(ctx, W - pad, pad, length, -1, 1)
  drawCorner(ctx, pad, H - pad, length, 1, -1)
  drawCorner(ctx, W - pad, H - pad, length, -1, -1)
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

function drawLyrics(ctx: CanvasRenderingContext2D, phrase: string) {
  if (!phrase) return

  ctx.save()
  const text = phrase.trim()
  const maxWidth = W * 0.76
  const fontSize = text.length > 20 ? 44 : 58
  ctx.font = `900 ${fontSize}px "Noto Sans JP", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = 'rgba(26, 26, 31, 0.62)'
  roundRect(ctx, W * 0.14, H * 0.62, W * 0.72, 104, 12)
  ctx.fill()

  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)'
  ctx.shadowBlur = 10
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, W / 2, H * 0.695, maxWidth)
  ctx.restore()
}

function drawHud(ctx: CanvasRenderingContext2D, songTitle: string, frameNumber: number) {
  ctx.save()
  ctx.font = '700 22px "Barlow Condensed", sans-serif'
  ctx.fillStyle = 'rgba(26, 26, 31, 0.78)'
  ctx.fillText('SS 1/250', 76, 48)
  ctx.textAlign = 'right'
  ctx.fillText('f/1.8  ISO AUTO', W - 76, 48)
  ctx.textAlign = 'left'
  ctx.fillText((songTitle || 'shutter chance').toUpperCase(), 76, H - 38)
  ctx.textAlign = 'right'
  ctx.fillStyle = '#f5c842'
  ctx.fillText(`● ${String(frameNumber).padStart(4, '0')}`, W - 76, H - 38)
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
