// 1단계: OAuth 토큰 발급 테스트
//   실행: node scripts/codef-demo/test-token.js [demo|sandbox]
//   .env의 CODEF_{ENV}_CLIENT_ID / CLIENT_SECRET 사용.
'use strict';
const { loadEnv, requestToken } = require('./codef');

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'demo').toLowerCase(); // demo | sandbox
  const prefix = env === 'sandbox' ? 'SANDBOX' : 'DEMO';
  const clientId = process.env[`CODEF_${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`CODEF_${prefix}_CLIENT_SECRET`];

  if (!clientId || !clientSecret) {
    console.error(`❌ .env에 CODEF_${prefix}_CLIENT_ID / CODEF_${prefix}_CLIENT_SECRET 가 필요합니다.`);
    process.exit(1);
  }

  console.log(`[${env}] 토큰 발급 시도 → oauth.codef.io`);
  try {
    const tok = await requestToken(clientId, clientSecret);
    const at = tok.access_token || '';
    console.log('✅ 토큰 발급 성공');
    console.log('  token_type :', tok.token_type);
    console.log('  expires_in :', tok.expires_in, `(약 ${Math.round((tok.expires_in || 0) / 86400)}일)`);
    console.log('  access_token(앞 24자):', at.slice(0, 24) + '...');
    console.log('\n다음 단계: node scripts/codef-demo/test-account-list.js', env);
  } catch (e) {
    console.error('❌ 실패:', e.message);
    process.exit(1);
  }
})();
