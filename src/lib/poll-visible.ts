/**
 * 화면이 보일 때만 도는 setInterval.
 *
 * 광고·매물수집 화면은 작업이 끝났는지 몇 초마다 DB 에 묻는다. 카페 발행은 글 사이를
 * 30~90분 띄우므로, 탭을 열어 둔 채 다른 일을 하면 몇 시간 동안 3초마다 쿼리가
 * 나갔다. 숨은 동안은 묻지 않고, 다시 보이면 바로 한 번 묻는다.
 *
 * 돌려주는 함수로 멈춘다(clearInterval 자리).
 */
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  const id = setInterval(() => { if (document.visibilityState === 'visible') fn() }, ms)
  const onVisible = () => { if (document.visibilityState === 'visible') fn() }
  document.addEventListener('visibilitychange', onVisible)
  return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
}
