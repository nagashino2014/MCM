// 공동인증서 등록 상태 확인 (TI.CheckCERTIsValid) — 세금계산서 발행 전제 점검.
// 1 = 정상, 음수 = 오류코드(-31100 = 등록된 인증서 없음).
'use strict';
const { loadEnv, call, result, unesc } = require('./barobill');

async function errString(env, CERTKEY, code) {
  const { xml } = await call(env, 'BANKACCOUNT', 'GetErrString', { CERTKEY, ErrCode: code });
  return unesc(result(xml, 'GetErrString') || `오류코드 ${code}`);
}

(async () => {
  loadEnv();
  const env = process.env.BAROBILL_ENV || 'test';
  const CERTKEY = process.env.BAROBILL_CERTKEY;
  const CorpNum = (process.env.BAROBILL_CORPNUM || '').replace(/[^0-9]/g, '');
  if (!CERTKEY || !CorpNum) { console.error('❌ .env BAROBILL_CERTKEY/CORPNUM 필요'); process.exit(1); }

  const { httpStatus, xml } = await call(env, 'TI', 'CheckCERTIsValid', { CERTKEY, CorpNum });
  const code = result(xml, 'CheckCERTIsValid');
  console.log(`[${env}] HTTP ${httpStatus} · CheckCERTIsValid = ${code}`);
  if (code === '1') {
    console.log('✅ 공동인증서 등록·유효 — 세금계산서 발행 가능');
  } else {
    console.log('❌', await errString(env, CERTKEY, code));
  }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
