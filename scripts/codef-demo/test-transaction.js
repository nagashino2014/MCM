// 4단계: 기업 수시입출 거래내역 조회 (connectedId 필요)
//   실행: node scripts/codef-demo/test-transaction.js [demo|sandbox] [orgKey] [YYYYMMDD start] [YYYYMMDD end]
//   orgKey: hana|ibk|kb|shinhan|woori|nh (기본 hana)
//
// connectedId는 .connected-id.json(create/add 스크립트가 저장)에서 자동 로드.
// 계좌번호는 .env {ORGKEY}_ACCOUNT 사용(하이픈 제거해 전송).
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEnv, requestToken, requestProduct, ORG } = require('./codef');

// 기업 수시입출 거래내역 (CODEF 표준 경로 — 실행 응답으로 최종 확인)
const TX_PATH = '/v1/kr/bank/b/account/transaction-list';

function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'demo').toLowerCase();
  const prefix = env === 'sandbox' ? 'SANDBOX' : 'DEMO';

  const clientId = process.env[`CODEF_${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`CODEF_${prefix}_CLIENT_SECRET`];
  const orgKey = (process.argv[3] || 'hana').toLowerCase();
  const organization = ORG[orgKey];
  if (!organization) { console.error('❌ 알 수 없는 orgKey:', orgKey, '(hana|ibk|kb|shinhan|woori|nh)'); process.exit(1); }
  const account = (process.env[`${orgKey.toUpperCase()}_ACCOUNT`] || '').replace(/[^0-9]/g, '');
  if (!account) { console.error(`❌ .env ${orgKey.toUpperCase()}_ACCOUNT (계좌번호) 필요`); process.exit(1); }

  // connectedId 로드
  const idPath = path.join(__dirname, '.connected-id.json');
  if (!fs.existsSync(idPath)) {
    console.error('❌ .connected-id.json 없음 — 먼저 create-account.js 로 connectedId를 발급하세요.');
    process.exit(1);
  }
  const { connectedId } = JSON.parse(fs.readFileSync(idPath, 'utf8'));

  // 기간: 인자 우선, 없으면 최근 3개월
  const now = new Date();
  const past = new Date(now.getTime() - 90 * 86400000);
  const startDate = process.argv[4] || ymd(past);
  const endDate = process.argv[5] || ymd(now);

  const body = {
    connectedId,
    organization,
    account,
    startDate,
    endDate,
    orderBy: '0',        // 0=최신순
    inquiryType: '1',    // 1=전체(입금+출금)  ※ 기관별 상이 가능 → 응답으로 확인
  };

  const tok = await requestToken(clientId, clientSecret);
  console.log(`[${env}] 거래내역 조회 → ${TX_PATH}  (${orgKey} ${organization})`);
  console.log(`  account=${account} ${startDate}~${endDate} connectedId=${connectedId}`);

  const { httpStatus, json } = await requestProduct(env, TX_PATH, tok.access_token, body);
  console.log('  HTTP', httpStatus);
  console.log('  result.code   :', json?.result?.code);
  console.log('  result.message:', json?.result?.message);

  const hist = json?.data?.resTrHistoryList;
  if (Array.isArray(hist)) {
    console.log(`\n✅ 거래 ${hist.length}건. 앞 5건:`);
    for (const t of hist.slice(0, 5)) {
      // 필드명은 기관 응답 스키마 확인용 — 대표 필드만 출력
      console.log('  -', JSON.stringify(t));
    }
  } else {
    console.log('\n--- 응답 data(요약) ---');
    console.log(JSON.stringify(json?.data, null, 2)?.slice(0, 1500));
  }
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
