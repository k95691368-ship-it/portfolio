import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import SignaturePadLib from 'signature_pad'

// 서명 입력.
//
// 손으로 그리는 것만 되면, 마우스를 쓸 수 없는 사람은 이 서비스로 근로계약을
// 맺을 수 없다. canvas 는 기본적으로 Tab 순서에 들어가지 않으므로 키보드만
// 쓰는 사람에게는 서명란이 존재하지도 않는 셈이었다.
//
// 그래서 이름을 입력하면 그것을 캔버스에 그려 서명으로 삼는 경로를 함께 둔다.
// 전자서명법상 서명의 요건은 그림 자체가 아니라 서명한 사람을 나타내고 그가
// 서명했음을 확인할 수 있는 것이므로, 타이핑 서명도 서명으로 성립한다.
// 이 앱은 그와 별도로 서명 시점의 문서 지문·로그인 세션·접속 환경을 함께
// 남기므로, 무엇에 누가 동의했는지는 그림이 아니라 그 기록이 증명한다.
const SignaturePad = forwardRef(function SignaturePad(_props, ref) {
  const canvasRef = useRef(null)
  const padRef = useRef(null)
  const typedRef = useRef('')

  // 이름을 캔버스에 직접 그린다. signature_pad 의 내부 상태와는 별개다.
  const drawTypedName = useCallback(() => {
    const canvas = canvasRef.current
    const name = typedRef.current
    if (!canvas || !name) return
    const ctx = canvas.getContext('2d')
    // 컨텍스트가 이미 devicePixelRatio 로 scale 돼 있어 CSS 픽셀 좌표를 쓴다.
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    ctx.save()
    ctx.fillStyle = '#14263f'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // 칸을 넘으면 잘린 채로 저장된다. 이름이 긴 사람 — 대개 한국 이름이 아닌
    // 사람 — 만 자기 서명이 잘려 나가는 것을 보게 된다. 들어갈 때까지 줄인다.
    const maxWidth = w * 0.9
    let size = Math.min(h * 0.42, 44)
    const setFont = () => {
      ctx.font = `italic ${size}px 'Gungsuh', 'Batang', serif`
    }
    setFont()
    while (size > 10 && ctx.measureText(name).width > maxWidth) {
      size -= 1
      setFont()
    }

    ctx.fillText(name, w / 2, h / 2, maxWidth)
    ctx.restore()
  }, [])

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d').scale(ratio, ratio)
    // Resizing the backing canvas clears its pixels, so drop any in-progress
    // strokes rather than leave signature_pad's internal state mismatched.
    padRef.current?.clear()
    // 리사이즈가 픽셀을 지우므로 타이핑 서명은 다시 그려야 한다.
    drawTypedName()
  }, [drawTypedName])

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
    clear: () => {
      typedRef.current = ''
      padRef.current?.clear()
    },
    // signature_pad 의 isEmpty()는 내부 플래그만 보므로 직접 그린 글자를 모른다.
    // 타이핑 서명도 서명이므로 함께 판단한다.
    isEmpty: () => (padRef.current?.isEmpty() ?? true) && !typedRef.current,
    setTypedName: (name) => {
      typedRef.current = String(name ?? '').trim()
      padRef.current?.clear() // 배경을 다시 칠해 이전 글자를 지운다
      drawTypedName()
    },
    // 내부 pad 가 아니라 캔버스에서 직접 뽑는다. 손으로 그린 획과 타이핑 서명이
    // 같은 캔버스에 있으므로 둘 다 담긴다.
    toDataURL: () => canvasRef.current?.toDataURL('image/png'),
  }))

  return (
    <canvas
      ref={canvasRef}
      className="signature-canvas"
      role="img"
      aria-label="서명 그리는 곳. 마우스나 손가락으로 그리거나, 아래 칸에 이름을 입력해 서명할 수 있습니다."
    />
  )
})

export default SignaturePad
