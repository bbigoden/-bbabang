/**
 * 도장 사진의 흰 배경을 지워 투명 PNG 로 만든다 (브라우저 전용).
 *
 * 종이에 찍은 도장을 폰으로 찍어 올리는 게 제일 흔한 경로인데, 배경이 흰색이라
 * 그대로 얹으면 견적서에 흰 네모가 생긴다. 밝은 픽셀일수록 투명하게 만든다.
 * 이미 투명한 PNG 는 건드릴 필요가 없지만, 같은 처리를 거쳐도 결과가 같다.
 */
export async function removeWhiteBackground(file: File, maxSide = 600): Promise<File> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas unsupported')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()

  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const LOW = 150    // 이보다 어두우면 잉크 — 그대로 둔다
  const HIGH = 225   // 이보다 밝으면 종이 — 완전 투명
  for (let i = 0; i < d.length; i += 4) {
    const min = Math.min(d[i], d[i + 1], d[i + 2])
    const keep = min <= LOW ? 1 : min >= HIGH ? 0 : (HIGH - min) / (HIGH - LOW)
    d[i + 3] = Math.round(d[i + 3] * keep)
  }
  ctx.putImageData(img, 0, 0)

  const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('png encode failed')
  return new File([blob], 'stamp.png', { type: 'image/png' })
}
