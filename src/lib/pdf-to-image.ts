/**
 * PDF → PNG (브라우저 전용). 견적서를 사진처럼 카톡·문자로 보낼 때 쓴다.
 * 여러 쪽이면 세로로 이어 붙여 한 장으로 만든다.
 */
export async function pdfToPng(pdf: ArrayBuffer, scale = 2): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url
  ).toString()

  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf) }).promise
  const pages: HTMLCanvasElement[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const vp = page.getViewport({ scale })
    const c = document.createElement('canvas')
    c.width = Math.ceil(vp.width)
    c.height = Math.ceil(vp.height)
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('canvas unsupported')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise
    pages.push(c)
  }

  const out = document.createElement('canvas')
  out.width = Math.max(...pages.map(p => p.width))
  out.height = pages.reduce((s, p) => s + p.height, 0)
  const octx = out.getContext('2d')
  if (!octx) throw new Error('canvas unsupported')
  octx.fillStyle = '#fff'
  octx.fillRect(0, 0, out.width, out.height)
  let y = 0
  for (const p of pages) { octx.drawImage(p, 0, y); y += p.height }

  const blob: Blob | null = await new Promise(r => out.toBlob(r, 'image/png'))
  if (!blob) throw new Error('png encode failed')
  return blob
}
