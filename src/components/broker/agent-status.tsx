/**
 * PC 프로그램(부소장광고)이 켜져 있는지 알려 주는 한 줄.
 *
 * 광고관리와 신규매물 두 화면이 쓴다. **두 곳이 같은 것을 말하므로 말도 같아야
 * 한다** — 예전에는 한쪽이 "PowerShell에서 npm run agent 를 실행하세요", 다른
 * 쪽이 "PC 바탕화면의 부소장 광고 프로그램을 켜세요" 라고 했다. 같은 프로그램을
 * 두 이름으로 부른 셈이고, 명령어를 아는 사람만 한쪽 화면을 쓸 수 있었다.
 *
 * 켜짐/꺼짐과 "켜 주세요" 를 한 줄에 둔다. 나눠 두면 꺼져 있을 때 같은 말이
 * 두 줄로 늘어선다.
 *
 * 이 화면들의 버튼은 누르면 바로 도는 게 아니라 **PC 프로그램이 집어가 실행한다.**
 * 그래서 꺼져 있을 때 "아무 일도 안 일어난다" 가 아니라 "켤 때 실행된다" 라고
 * 말해야 맞다 — 누른 것은 사라지지 않는다.
 */
export function AgentStatus({ online }: { online: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          online ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      />
      {online ? 'PC 프로그램 켜짐' : 'PC 프로그램 꺼짐 — 켜면 눌러 둔 것이 실행됩니다'}
    </span>
  )
}

/** 버튼 툴팁에 쓰는 문구. 꺼져 있을 때 무엇을 해야 하는지 한 곳에서 정한다. */
export const AGENT_OFF_HINT = 'PC 프로그램을 먼저 켜 주세요'
