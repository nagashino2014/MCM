// 등록된 계좌 목록 조회 (GetBankAccountEx2)
//   실행: node scripts/barobill-demo/test-bank-list.js [test|prod] [0|1|2]
//   AvailOnly: 0=전체 1=사용중 2=해지
'use strict';
const { loadEnv, call, pick, pickAll, result, isErrCode } = require('./barobill');

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'test').toLowerCase();
  const availOnly = process.argv[3] || '1';
  const CERTKEY = process.env.BAROBILL_CERTKEY;
  const CorpNum = (process.env.BAROBILL_CORPNUM || '').replace(/[^0-9]/g, '');
  if (!CERTKEY || !CorpNum) { console.error('❌ .env BAROBILL_CERTKEY / BAROBILL_CORPNUM 필요'); process.exit(1); }

  console.log(`[${env}] 계좌목록 조회 GetBankAccountEx2 (AvailOnly=${availOnly})`);
  const { httpStatus, xml } = await call(env, 'BANKACCOUNT', 'GetBankAccountEx2', {
    CERTKEY, CorpNum, AvailOnly: availOnly,
  });
  console.log('  HTTP', httpStatus);

  // SOAP fault 체크
  const fault = pick(xml, 'faultstring');
  if (fault) { console.error('  SOAP Fault:', fault); console.log(xml.slice(0, 800)); return; }

  // 오류코드(첫 BankAccountNum이 음수)
  const first = pick(xml, 'BankAccountNum');
  if (isErrCode(first)) {
    console.error('  오류코드:', first, '→ GetErrString으로 메시지 확인 필요');
    return;
  }

  const accounts = pickAll(xml, 'BankAccountEx');
  console.log(`\n✅ 계좌 ${accounts.length}건:`);
  for (const a of accounts) {
    console.log(`  - ${pick(a, 'BankName')} | ${pick(a, 'BankAccountNum')} | 주기:${pick(a, 'CollectCycle')} | 별칭:${pick(a, 'Alias') || ''}`);
  }
  if (!accounts.length) console.log('  (없음) 원본:', xml.slice(0, 600));
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
