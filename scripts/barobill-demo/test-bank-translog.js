// 계좌 입출금내역 조회 (GetPeriodBankAccountTransLog, 페이징)
//   실행: node scripts/barobill-demo/test-bank-translog.js [test|prod] <계좌번호> [YYYYMMDD start] [YYYYMMDD end]
//   중복체크 키 = BankAccountNum + TransRefKey (원장 dedup_key로 사용)
'use strict';
const { loadEnv, call, pick, pickAll, isErrCode } = require('./barobill');

function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'test').toLowerCase();
  const CERTKEY = process.env.BAROBILL_CERTKEY;
  const CorpNum = (process.env.BAROBILL_CORPNUM || '').replace(/[^0-9]/g, '');
  const ID = process.env.BAROBILL_ID;
  const account = (process.argv[3] || '').replace(/[^0-9]/g, '');
  if (!CERTKEY || !CorpNum || !ID) { console.error('❌ .env BAROBILL_CERTKEY/CORPNUM/ID 필요'); process.exit(1); }
  if (!account) { console.error('❌ 계좌번호 인자 필요'); process.exit(1); }

  const now = new Date();
  const past = new Date(now.getTime() - 30 * 86400000);
  const startDate = process.argv[4] || ymd(past);
  const endDate = process.argv[5] || ymd(now);

  let currentPage = 1;
  let maxPage = 1;
  let total = 0;
  do {
    const { xml } = await call(env, 'BANKACCOUNT', 'GetPeriodBankAccountTransLog', {
      CERTKEY, CorpNum, ID,
      BankAccountNum: account,
      StartDate: startDate, EndDate: endDate,
      TransDirection: 1,      // 1=전체 2=입금 3=출금
      CountPerPage: 100,
      CurrentPage: currentPage,
      OrderDirection: 2,      // 2=DESC(최신순)
    });
    const cur = pick(xml, 'CurrentPage');
    if (isErrCode(cur)) { console.error('  오류코드:', cur); return; }
    maxPage = parseInt(pick(xml, 'MaxPageNum') || '1', 10);
    // 실측(2026-08-15): 컨테이너 <BankAccountLogList>, 반복 요소 <BankAccountTransLog>
    const logs = pickAll(xml, 'BankAccountTransLog');
    if (currentPage === 1) console.log(`[${env}] 입출금내역 ${account} ${startDate}~${endDate} (총 ${maxPage}p, ${pick(xml, 'MaxIndex')}건)`);
    for (const l of logs) {
      total++;
      const dep = pick(l, 'Deposit'), wd = pick(l, 'Withdraw');
      const r1 = pick(l, 'TransRemark1') || '', r2 = pick(l, 'TransRemark2') || '';
      console.log(`  ${pick(l, 'TransDT')} | ${pick(l, 'TransDirection')} 입:${dep} 출:${wd} | 종류:${pick(l, 'TransType') || ''} | R1:${r1} R2:${r2} | key:${pick(l, 'TransRefKey')}`);
    }
    currentPage++;
  } while (currentPage <= maxPage);
  console.log(`\n합계 ${total}건`);
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
