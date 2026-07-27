// 법인 보유카드 목록 조회 (승인내역 조회에 필요한 카드번호 확보용)
//   실행: node scripts/codef-demo/test-card-list.js [demo|sandbox] [lotte|bc]
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEnv, requestToken, requestProduct, CARD } = require('./codef');

const CARD_LIST_PATH = '/v1/kr/card/b/account/card-list';

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'demo').toLowerCase();
  const prefix = env === 'sandbox' ? 'SANDBOX' : 'DEMO';
  const clientId = process.env[`CODEF_${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`CODEF_${prefix}_CLIENT_SECRET`];

  const orgKey = (process.argv[3] || 'bc').toLowerCase();
  const organization = CARD[orgKey];
  if (!organization) { console.error('❌ 알 수 없는 카드 orgKey:', orgKey, '(lotte|bc)'); process.exit(1); }

  const { connectedId } = JSON.parse(
    fs.readFileSync(path.join(__dirname, '.connected-id.json'), 'utf8'),
  );

  const tok = await requestToken(clientId, clientSecret);
  console.log(`[${env}] 보유카드 조회 → ${CARD_LIST_PATH}  (${orgKey} ${organization})`);
  const { httpStatus, json } = await requestProduct(env, CARD_LIST_PATH, tok.access_token, {
    connectedId,
    organization,
  });
  console.log('  HTTP', httpStatus, '| result.code:', json?.result?.code, '|', json?.result?.message);

  const list = json?.data?.resCardList || (Array.isArray(json?.data) ? json.data : null);
  if (Array.isArray(list) && list.length) {
    console.log(`\n✅ 카드 ${list.length}장:`);
    for (const c of list) {
      // 카드번호는 마스킹해서 표시(뒤 4자리만). 승인내역 조회 시 원본 필요.
      const no = c.resCardNo || c.resIssueCardNo || '';
      console.log(`  - ${c.resCardName || ''} | ${no.replace(/.(?=.{4})/g, '*')} | 유효:${c.resValidPeriod || ''}`);
    }
    // 원본 카드번호를 파일에 저장(git 제외) → 승인내역 조회에서 재사용(card-list 재호출 회피)
    const nos = list.map((c) => c.resCardNo || c.resIssueCardNo).filter(Boolean);
    fs.writeFileSync(path.join(__dirname, `.cards-${orgKey}.json`), JSON.stringify(nos, null, 2));
    console.log(`\n카드번호 ${nos.length}건 저장 → .cards-${orgKey}.json`);
    console.log(`  다음: node scripts/codef-demo/test-card-approval.js ${env} ${orgKey}`);
  } else {
    console.log('\n--- 응답 data(요약) ---');
    console.log(JSON.stringify(json?.data, null, 2)?.slice(0, 1500));
  }
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
