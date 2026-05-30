import { useCallback, useEffect, useRef, useState } from 'react'

type FacingMode = 'user' | 'environment'

export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<FacingMode>('user')
  const facingModeRef = useRef<FacingMode>('user')

  const startStream = useCallback(async (facing: FacingMode) => {
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      setStream(prev => {
        prev?.getTracks().forEach(t => t.stop())
        return nextStream
      })
      setEnabled(true)
      setError(null)
    } catch {
      setError('カメラへのアクセスが許可されていません')
      setEnabled(false)
    }
  }, [])

  const enable = useCallback(async () => {
    await startStream(facingModeRef.current)
  }, [startStream])

  const disable = useCallback(() => {
    stream?.getTracks().forEach(track => track.stop())
    setStream(null)
    setEnabled(false)
  }, [stream])

  const toggle = useCallback(async () => {
    if (enabled) {
      disable()
      return
    }

    await enable()
  }, [disable, enable, enabled])

  const switchCamera = useCallback(async () => {
    const next: FacingMode = facingModeRef.current === 'user' ? 'environment' : 'user'
    facingModeRef.current = next
    setFacingMode(next)
    if (enabled) {
      await startStream(next)
    }
  }, [enabled, startStream])

  useEffect(() => {
    facingModeRef.current = facingMode
  }, [facingMode])

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach(track => track.stop())
    }
  }, [stream])

  return { stream, enabled, error, facingMode, toggle, switchCamera }
}
