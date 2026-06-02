/**
 * 세 표 페이지(고객목록·매물목록·일지) 공통 빈 상태 행.
 *
 * tbody 안에 들어가는 `<tr><td>` 단일 행. 데이터 0건일 때 표시.
 *
 * 사용:
 *   <tbody>
 *     {rows.length === 0 ? (
 *       <EmptyRow colSpan={activeCols.length + 1} message="아직 등록된 고객이 없어요" />
 *     ) : rows.map(...)}
 *   </tbody>
 */
export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-16 text-center text-sm text-gray-500">
        {message}
      </td>
    </tr>
  )
}
