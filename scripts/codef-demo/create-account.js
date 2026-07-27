// 3단계: 계정 등록(connectedId 발급) — 하나은행 기업계좌 / 공동인증서 방식
//   실행: node scripts/codef-demo/create-account.js [demo|sandbox]
//
// 필요한 .env 항목(사용자가 직접 채움 — 이 스크립트는 값을 로깅하지 않음):
//   CODEF_PUBLIC_KEY        (이미 채워짐)
//   HANA_CERT_DER_PATH      공동인증서 signCert.der 파일의 로컬 경로
//   HANA_CERT_KEY_PATH      공동인증서 signPri.key  파일의 로컬 경로
//   HANA_CERT_PASSWORD      인증서 비밀번호(원문 — RSA로 암호화되어 전송됨)
//
// 성공 시 connectedId를 콘솔 출력 + .connected-id.json(git 제외)에 저장한다.
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEnv, requestToken, requestProduct, publicEncRSA, ORG } = require('./codef');

const CREATE_PATH = '/v1/account/create';

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'demo').toLowerCase();
  const prefix = env === 'sandbox' ? 'SANDBOX' : 'DEMO';

  const clientId = process.env[`CODEF_${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`CODEF_${prefix}_CLIENT_SECRET`];
  const pubKey = process.env.CODEF_PUBLIC_KEY;
  const derPath = process.env.HANA_CERT_DER_PATH;
  const keyPath = process.env.HANA_CERT_KEY_PATH;
  const certPw = process.env.HANA_CERT_PASSWORD;

  const missing = [];
  if (!clientId || !clientSecret) missing.push(`CODEF_${prefix}_CLIENT_ID/SECRET`);
  if (!pubKey) missing.push('CODEF_PUBLIC_KEY');
  if (!derPath) missing.push('HANA_CERT_DER_PATH');
  if (!keyPath) missing.push('HANA_CERT_KEY_PATH');
  if (!certPw) missing.push('HANA_CERT_PASSWORD');
  if (missing.length) {
    console.error('❌ .env 누락 항목:', missing.join(', '));
    process.exit(1);
  }
  if (!fs.existsSync(derPath)) { console.error('❌ der 파일 없음:', derPath); process.exit(1); }
  if (!fs.existsSync(keyPath)) { console.error('❌ key 파일 없음:', keyPath); process.exit(1); }

  const derFile = fs.readFileSync(derPath).toString('base64');
  const keyFile = fs.readFileSync(keyPath).toString('base64');

  const body = {
    accountList: [
      {
        countryCode: 'KR',
        businessType: 'BK',      // 은행
        clientType: 'B',         // 기업(법인)
        organization: ORG.hana,  // 하나은행 0081
        loginType: '0',          // 0 = 공동인증서
        password: publicEncRSA(pubKey, certPw),
        derFile,
        keyFile,
        // 하나은행 기업이 인증서 외 추가 식별정보(사업자번호/서브ID)를 요구하면
        // CODEF 응답 메시지에 따라 여기에 필드를 추가한다. (예: 'businessType' 세부, 'id' 등)
      },
    ],
  };

  const tok = await requestToken(clientId, clientSecret);
  console.log(`[${env}] 계정 등록 요청 → ${CREATE_PATH} (하나은행 0081, 인증서)`);
  const { httpStatus, json } = await requestProduct(env, CREATE_PATH, tok.access_token, body);

  console.log('  HTTP', httpStatus);
  console.log('  result.code   :', json?.result?.code);
  console.log('  result.message:', json?.result?.message);
  if (json?.result?.extraMessage) console.log('  extraMessage  :', json.result.extraMessage);

  const connectedId = json?.data?.connectedId || json?.data?.[0]?.connectedId;
  if (connectedId) {
    const outPath = path.join(__dirname, '.connected-id.json');
    fs.writeFileSync(outPath, JSON.stringify({ env, connectedId, savedAt: new Date().toISOString() }, null, 2));
    console.log('\n✅ connectedId 발급:', connectedId);
    console.log('   저장됨:', outPath);
    console.log('   다음: node scripts/codef-demo/test-transaction.js', env);
  } else {
    console.log('\n⚠ connectedId 미발급. 위 result 메시지를 보고 파라미터를 조정하세요.');
    console.log('   (추가인증/추가정보 요구 코드면 해당 필드를 body에 더해야 합니다)');
    console.log('\n--- data ---');
    console.log(JSON.stringify(json?.data, null, 2)?.slice(0, 1200));
  }
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
