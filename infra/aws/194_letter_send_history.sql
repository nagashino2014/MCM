-- 194: 공문 발송 이력(N차) — 승인 건 재발송 + 발송 내역 합산 관리(2026-08-19 사용자 확정).
-- 배경: 발주처 사정으로 승인·발송 완료(sent) 공문을 다시 보내야 하는 실사례(준공계 공문).
-- 종전에는 sent_at 단일 필드라 재발송하면 최초 발송 시각이 사라졌다 →
-- send_history 에 1차부터 N차까지 전부 누적하고(sent_at 은 최근 발송 시각 유지),
-- 발송공문 탭·전자결재 문서 모달이 회차 목록을 보여준다.
-- 관례: text 타임스탬프, 멱등(IF NOT EXISTS).
-- 항목 형태: [{"sentAt": ISO, "messageId": str|null, "to": [메일...], "cc": [메일...]}]

ALTER TABLE official_letters ADD COLUMN IF NOT EXISTS send_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 백필 — 기존 발송 완료 건은 현재 sent_at 을 1차 발송으로 등재한다(재실행 멱등: 빈 배열만 대상).
UPDATE official_letters
   SET send_history = jsonb_build_array(
         jsonb_strip_nulls(jsonb_build_object('sentAt', sent_at, 'messageId', sent_message_id))
       )
 WHERE send_status = 'sent'
   AND sent_at IS NOT NULL
   AND send_history = '[]'::jsonb;
