import { useCallback, useEffect, useState } from 'react'

export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enable = useCallback(async () => {
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      setStream(nextStream)
      setEnabled(true)
      setError(null)
    } catch {
      setError('カメラへのアクセスが許可されていません')
      setEnabled(false)
    }
  }, [])

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

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach(track => track.stop())
    }
  }, [stream])

  return { stream, enabled, error, toggle }
}
