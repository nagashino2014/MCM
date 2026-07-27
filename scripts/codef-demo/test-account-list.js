// 2단계: 보유계좌 조회 호출 파이프라인 테스트 (URL 인코딩 바디/응답 디코딩 검증)
//   실행: node scripts/codef-demo/test-account-list.js [demo|sandbox] [connectedId] [orgKey]
//   주의: 데모/샌드박스에서 실제 데이터를 받으려면 CODEF가 안내하는 데모 계정 등록으로
//         발급한 connectedId가 필요하다. connectedId 없이 호출하면 CODEF가 파라미터
//         오류코드(CF-xxxxx)를 돌려주는데, 이 경우에도 "인증·요청·응답 디코딩 경로"는
//         정상 검증된 것이다(토큰 인증 통과 + 응답 파싱 성공).
'use strict';
const { loadEnv, requestToken, requestProduct, ORG } = require('./codef');

const ACCOUNT_LIST_PATH = '/v1/kr/bank/b/account/account-list';

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'demo').toLowerCase();
  const connectedId = process.argv[3] || 'TEST_CONNECTED_ID'; // 데모 등록 후 교체
  const orgKey = (process.argv[4] || 'ibk').toLowerCase();
  const organization = ORG[orgKey] || ORG.ibk;

  const prefix = env === 'sandbox' ? 'SANDBOX' : 'DEMO';
  const clientId = process.env[`CODEF_${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`CODEF_${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    console.error(`❌ .env에 CODEF_${prefix}_CLIENT_ID / CLIENT_SECRET 필요`);
    process.exit(1);
  }

  const tok = await requestToken(clientId, clientSecret);
  console.log('✅ 토큰 OK. 계좌목록 조회 호출 →', env, ACCOUNT_LIST_PATH);
  console.log(`  organization=${organization}(${orgKey}) connectedId=${connectedId}`);

  const { httpStatus, json } = await requestProduct(env, ACCOUNT_LIST_PATH, tok.access_token, {
    connectedId,
    organization,
  });

  console.log('  HTTP', httpStatus);
  console.log('  result.code   :', json?.result?.code);
  console.log('  result.message:', json?.result?.message || json?.result?.extraMessage);
  if (json?.data) console.log('  data 키:', Object.keys(json.data));
  console.log('\n--- 전체 응답(요약) ---');
  console.log(JSON.stringify(json, null, 2).slice(0, 1500));
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
