/**
 * 올리기 전에 사진을 줄인다 — 폰 사진 원본(2~5MB)을 그대로 올려 느린 망에서 목록·방이 한참 걸렸다.
 * Supabase 무료 요금제라 내려받을 때 줄여 주는 기능(이미지 변환)이 없어 올릴 때 줄여 둔다.
 * 긴 변을 maxSide 로 맞춰 JPEG 로 다시 굽고, 움직이는 GIF·이미 작은 사진·줄여도 안 작아지는 사진은 그대로 둔다.
 *
 * 메신저에서 쓰던 것을 매물사진도 쓰게 꺼냈다(2026-11-05) — 매물사진은 원본 그대로 올라가
 * 하루에 500MB가 늘어 파일 저장 한도(1GB)를 며칠 만에 채울 뻔했다(장당 평균 1.3MB).
 */
export async function shrinkImage(file: File, maxSide: number, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 500 * 1024) { bmp.close(); return file }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    const g = canvas.getContext('2d')!
    g.fillStyle = '#fff'   // 투명 PNG 를 JPEG 로 구우면 검게 나오지 않게
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/** 매물사진 — 광고·카페에 쓰기 넉넉하면서 장당 200~400KB 로 떨어지는 크기 */
export const PROPERTY_PHOTO_SIDE = 1600
export const PROPERTY_PHOTO_QUALITY = 0.82
