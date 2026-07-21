import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import SignaturePadLib from 'signature_pad'

const SignaturePad = forwardRef(function SignaturePad(_props, ref) {
  const canvasRef = useRef(null)
  const padRef = useRef(null)

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d').scale(ratio, ratio)
    // Resizing the backing canvas clears its pixels, so drop any in-progress
    // strokes rather than leave signature_pad's internal state mismatched.
    padRef.current?.clear()
  }, [])

  useEffect(() => {
    resizeCanvas()
    padRef.current = new SignaturePadLib(canvasRef.current, { backgroundColor: 'rgb(255,255,255)' })

    window.addEventListener('resize', resizeCanvas)
    window.addEventListener('orientationchange', resizeCanvas)
    return () => {
      window.removeEventListener('resize', resizeCanvas)
      window.removeEventListener('orientationchange', resizeCanvas)
      padRef.current?.off()
    }
  }, [resizeCanvas])

  useImperativeHandle(ref, () => ({
    clear: () => padRef.current?.clear(),
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    toDataURL: () => padRef.current?.toDataURL('image/png'),
  }))

  return <canvas ref={canvasRef} className="signature-canvas" />
})

export default SignaturePad
