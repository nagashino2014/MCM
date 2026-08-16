// 카드 등록/관리 URL 발급 (GetCardManagementURL)
//   실행: node scripts/barobill-demo/get-card-url.js [test|prod]
//   반환된 URL(60초 유효)을 브라우저로 열어 카드·카드사 웹 자격을 사용자가 직접 등록.
//   수집대상은 매입내역(PURCHASE), 수집주기 1일 선택. ⚠ BC카드는 회계양식 전체선택 상태 확인.
'use strict';
const { loadEnv, call, pick, result, isErrCode, unesc } = require('./barobill');

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'test').toLowerCase();
  const CERTKEY = process.env.BAROBILL_CERTKEY;
  const CorpNum = (process.env.BAROBILL_CORPNUM || '').replace(/[^0-9]/g, '');
  const ID = process.env.BAROBILL_ID;
  if (!CERTKEY || !CorpNum || !ID) { console.error('❌ .env BAROBILL_CERTKEY/CORPNUM/ID 필요'); process.exit(1); }

  const { xml } = await call(env, 'CARD', 'GetCardManagementURL', {
    CERTKEY, CorpNum, ID, PWD: '', // PWD는 미사용(빈 문자열)
  });
  const url = unesc(result(xml, 'GetCardManagementURL') || '');
  if (!url || isErrCode(url)) {
    console.error('❌ URL 발급 실패:', url, '| fault:', pick(xml, 'faultstring'));
    console.log(xml.slice(0, 600));
    return;
  }
  console.log('✅ 카드 관리 URL (60초 유효):\n', url);
  console.log('\n이 URL을 즉시 브라우저로 열어 카드를 등록하세요. (수집대상=매입내역, 주기=1일)');
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
