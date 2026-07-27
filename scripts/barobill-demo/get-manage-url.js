// 계좌 등록/관리 URL 발급 (GetBankAccountManagementURL)
//   실행: node scripts/barobill-demo/get-manage-url.js [test|prod]
//   반환된 URL(60초 유효)을 브라우저로 열어 계좌·빠른조회 자격을 사용자가 직접 등록.
//   → RegistBankAccountEx로 자격증명을 코드에 넣는 것보다 안전(권장 경로).
'use strict';
const { loadEnv, call, pick, result, isErrCode } = require('./barobill');

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'test').toLowerCase();
  const CERTKEY = process.env.BAROBILL_CERTKEY;
  const CorpNum = (process.env.BAROBILL_CORPNUM || '').replace(/[^0-9]/g, '');
  const ID = process.env.BAROBILL_ID;
  if (!CERTKEY || !CorpNum || !ID) { console.error('❌ .env BAROBILL_CERTKEY/CORPNUM/ID 필요'); process.exit(1); }

  const { xml } = await call(env, 'BANKACCOUNT', 'GetBankAccountManagementURL', {
    CERTKEY, CorpNum, ID, PWD: '', // PWD는 미사용(빈 문자열)
  });
  const url = result(xml, 'GetBankAccountManagementURL');
  if (!url || isErrCode(url)) {
    console.error('❌ URL 발급 실패:', url, '| fault:', pick(xml, 'faultstring'));
    console.log(xml.slice(0, 600));
    return;
  }
  console.log('✅ 계좌 관리 URL (60초 유효):\n', url);
  console.log('\n이 URL을 브라우저로 열어 계좌·은행 빠른조회 자격을 등록하세요.');
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
