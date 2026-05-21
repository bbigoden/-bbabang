import { redirect } from 'next/navigation'

// 보안 항목은 /settings/account 안으로 통합됨. 기존 링크·북마크 호환용 redirect.
export default function SettingsSecurityPage() {
  redirect('/settings/account')
}
