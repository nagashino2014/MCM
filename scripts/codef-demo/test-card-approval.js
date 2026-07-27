// 카드 승인내역 조회 (지출결의 반자동화 원천 데이터)
//   실행: node scripts/codef-demo/test-card-approval.js [demo|sandbox] [bc|lotte|...] [YYYYMMDD start] [YYYYMMDD end]
//   inquiryType='1'(전체조회)로 카드번호 없이 전 카드 승인내역을 한 번에 받는다.
//   (보유카드 조회의 카드번호는 마스킹이라 카드별조회 cardNo로는 매칭 불가)
//   ※ BC카드는 1개월 단위 조회 → 기간을 1개월 이내로.
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEnv, requestToken, requestProduct, CARD } = require('./codef');

const APPROVAL_PATH = '/v1/kr/card/b/account/approval-list';

function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'demo').toLowerCase();
  const prefix = env === 'sandbox' ? 'SANDBOX' : 'DEMO';
  const clientId = process.env[`CODEF_${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`CODEF_${prefix}_CLIENT_SECRET`];

  const orgKey = (process.argv[3] || 'bc').toLowerCase();
  const organization = CARD[orgKey];
  if (!organization) { console.error('❌ 알 수 없는 카드 orgKey:', orgKey); process.exit(1); }

  const { connectedId } = JSON.parse(
    fs.readFileSync(path.join(__dirname, '.connected-id.json'), 'utf8'),
  );

  const now = new Date();
  const past = new Date(now.getTime() - 28 * 86400000); // 약 1개월(BC 단위)
  const startDate = process.argv[4] || ymd(past);
  const endDate = process.argv[5] || ymd(now);

  const body = {
    connectedId,
    organization,
    startDate,
    endDate,
    orderBy: '0',
    inquiryType: '1',          // 1 = 전체조회(카드번호 불필요)
    memberStoreInfoType: '1',  // 가맹점 정보 포함(지출결의에 필요)
  };

  const tok = await requestToken(clientId, clientSecret);
  console.log(`[${env}] ${orgKey}(${organization}) 전체 승인내역 조회 (${startDate}~${endDate})`);
  const { httpStatus, json } = await requestProduct(env, APPROVAL_PATH, tok.access_token, body);
  console.log('  HTTP', httpStatus, '| result.code:', json?.result?.code, '|', json?.result?.message);

  const list = json?.data?.resApprovalList || (Array.isArray(json?.data) ? json.data : (json?.data?.resUsedDate ? [json.data] : []));
  if (Array.isArray(list) && list.length) {
    console.log(`\n✅ 승인 ${list.length}건. 앞 8건(카드·일시·가맹점·금액·매입):`);
    for (const a of list.slice(0, 8)) {
      const cardNo = String(a.resCardNo || '').replace(/.(?=.{4})/g, '*');
      console.log(`  - ${a.resUsedDate} ${a.resUsedTime} | ${cardNo} | ${a.resMemberStoreName} | ${Number(a.resUsedAmount).toLocaleString()}원 | 취소:${a.resCancelYN} 매입:${a.resPurchaseYN}`);
    }
  } else {
    console.log('\n--- 응답 data(요약) ---');
    console.log(JSON.stringify(json?.data, null, 2)?.slice(0, 1500));
  }
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
