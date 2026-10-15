-- 미동의 약관 조회를 본인 것만 답하게 한다.
--
-- SECURITY DEFINER 라 RLS 를 안 타는데, p_user_id 가 호출한 사람인지 보지 않았다.
-- 그래서 로그인한 누구든 남의 id 를 넣어 그 사람이 어느 약관 버전에 동의했는지 알아낼 수
-- 있었다. 부르는 곳은 동의 창(consent-gate) 하나이고 늘 자기 id 를 넘기므로, 남의 id 면
-- 빈 결과를 돌려준다. 시그니처는 그대로 둔다(화면 코드 그대로).

CREATE OR REPLACE FUNCTION public.get_pending_term_versions(p_user_id uuid)
RETURNS TABLE(id integer, type text, version text, summary text, effective_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT tv.id, tv.type, tv.version, tv.summary, tv.effective_at
  FROM public.terms_versions tv
  WHERE p_user_id = auth.uid()
    AND tv.effective_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.user_term_consents utc
      WHERE utc.user_id = p_user_id AND utc.terms_version_id = tv.id
    )
  ORDER BY tv.effective_at;
$function$;
