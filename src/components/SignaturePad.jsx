import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import SignaturePadLib from 'signature_pad'

const SignaturePad = forwardRef(function SignaturePad(_props, ref) {
  const canvasRef = useRef(null)
  const padRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d').scale(ratio, ratio)

    padRef.current = new SignaturePadLib(canvas, { backgroundColor: 'rgb(255,255,255)' })

    return () => {
      padRef.current?.off()
    }
  }, [])

  useImperativeHandle(ref, () => ({
    clear: () => padRef.current?.clear(),
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    toDataURL: () => padRef.current?.toDataURL('image/png'),
  }))

  return <canvas ref={canvasRef} className="signature-canvas" />
})

export default SignaturePad
