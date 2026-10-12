-- 262: 메일·메신저 첨부 확장자 정책 — 전사 기본 + 인원별 예외(2026-09-17 사용자 요청)
-- 일반 그룹웨어·메일 공급자처럼 전 사용자 일률 차단이 아니라, 전사 기본 정책 위에 사람별로
-- '모두 허용 / 목록 전체 차단 / 확장자별 허용·차단' 예외를 둘 수 있게 한다.
-- 판정: 파일명 마지막 확장자(끝의 점·공백 제거, 소문자). 목록에 없는 확장자는 항상 허용.
--   사용자 모드 allow_all → 차단 없음 / block_listed → 목록 전부 차단 / default → 전사 기본(blocked=1)
--   그 뒤 사용자 확장자 규칙(allow·block)이 최종 결정.
-- 적용 경로: 메일 발송(일반·대용량 첨부), 메신저 전송(일반·대용량·개인문서함 전송).
-- 기본 차단 = 위험도 high(실행·스크립트·설치·바로가기·디스크 이미지 등). medium 은 목록에만 두고 허용
-- (매크로 문서·압축 파일 등 업무상 흔히 주고받는 형식 — 필요 시 일괄 제한).
-- 근거: Outlook 차단 목록(Level 1), Gmail 차단 확장자, MOTW 우회형(iso·img·vhd) 등 최근 유포 사례.
-- 관례: 멱등(IF NOT EXISTS / ON CONFLICT DO NOTHING — 관리자가 바꾼 차단 여부는 재실행해도 보존).

CREATE TABLE IF NOT EXISTS attachment_ext_catalog (
  ext text PRIMARY KEY,                           -- 소문자, 점 없이
  category text NOT NULL,                         -- exec|script|installer|shortcut|disk|system|office_macro|database|java|mac_linux|archive|web|custom
  risk text NOT NULL CHECK (risk IN ('high', 'medium')),
  description text NOT NULL,
  blocked integer NOT NULL DEFAULT 0,             -- 전사 기본 정책(1 = 차단)
  is_custom integer NOT NULL DEFAULT 0,           -- 관리자가 추가한 확장자
  sort_order integer NOT NULL DEFAULT 0,
  updated_by text REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at text NOT NULL DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS attachment_ext_user_policy (
  user_id text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'default' CHECK (mode IN ('default', 'allow_all', 'block_listed')),
  note text,
  updated_by text REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at text NOT NULL DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS attachment_ext_user_rules (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  ext text NOT NULL REFERENCES attachment_ext_catalog(ext) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('allow', 'block')),
  updated_by text REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at text NOT NULL DEFAULT now()::text,
  PRIMARY KEY (user_id, ext)
);

INSERT INTO attachment_ext_catalog (ext, category, risk, description, blocked, sort_order) VALUES
  -- 실행 파일(Windows)
  ('exe',  'exec', 'high', 'Windows 실행 파일', 1, 100),
  ('com',  'exec', 'high', 'MS-DOS 실행 파일', 1, 101),
  ('scr',  'exec', 'high', '화면 보호기(실행 파일과 동일하게 실행)', 1, 102),
  ('pif',  'exec', 'high', '프로그램 정보 파일(실행 파일 위장에 사용)', 1, 103),
  ('cpl',  'exec', 'high', '제어판 항목(더블클릭 시 DLL 코드 실행)', 1, 104),
  ('dll',  'exec', 'high', '동적 연결 라이브러리', 1, 105),
  ('sys',  'exec', 'high', '시스템 드라이버', 1, 106),
  ('drv',  'exec', 'high', '장치 드라이버', 1, 107),
  ('ocx',  'exec', 'high', 'ActiveX 컨트롤', 1, 108),
  ('xll',  'exec', 'high', 'Excel 추가 기능 DLL(열면 코드 실행)', 1, 109),
  ('ex_',  'exec', 'high', '압축된 실행 파일(설치 매체)', 1, 110),
  ('vxd',  'exec', 'high', '가상 장치 드라이버', 1, 111),
  -- 스크립트
  ('bat',     'script', 'high', '배치 파일', 1, 200),
  ('cmd',     'script', 'high', '명령 스크립트', 1, 201),
  ('vbs',     'script', 'high', 'VBScript', 1, 202),
  ('vbe',     'script', 'high', '암호화된 VBScript', 1, 203),
  ('vb',      'script', 'high', 'VBScript', 1, 204),
  ('js',      'script', 'high', 'JScript(Windows 에서 더블클릭 시 실행)', 1, 205),
  ('jse',     'script', 'high', '암호화된 JScript', 1, 206),
  ('wsf',     'script', 'high', 'Windows Script 파일', 1, 207),
  ('wsh',     'script', 'high', 'Windows Script Host 설정', 1, 208),
  ('wsc',     'script', 'high', 'Windows Script 구성요소', 1, 209),
  ('ws',      'script', 'high', 'Windows Script', 1, 210),
  ('ps1',     'script', 'high', 'PowerShell 스크립트', 1, 211),
  ('ps1xml',  'script', 'high', 'PowerShell 서식 파일', 1, 212),
  ('ps2',     'script', 'high', 'PowerShell 스크립트', 1, 213),
  ('ps2xml',  'script', 'high', 'PowerShell 서식 파일', 1, 214),
  ('psc1',    'script', 'high', 'PowerShell 콘솔 파일', 1, 215),
  ('psc2',    'script', 'high', 'PowerShell 콘솔 파일', 1, 216),
  ('psm1',    'script', 'high', 'PowerShell 모듈', 1, 217),
  ('psd1',    'script', 'high', 'PowerShell 데이터 파일', 1, 218),
  ('hta',     'script', 'high', 'HTML 응용 프로그램(브라우저 보안 밖에서 실행)', 1, 219),
  ('sct',     'script', 'high', 'Windows 스크립트 구성요소', 1, 220),
  ('msh',     'script', 'high', 'Microsoft Shell 스크립트', 1, 221),
  ('msh1',    'script', 'high', 'Microsoft Shell 스크립트', 1, 222),
  ('msh2',    'script', 'high', 'Microsoft Shell 스크립트', 1, 223),
  ('mshxml',  'script', 'high', 'Microsoft Shell 서식 파일', 1, 224),
  ('shb',     'script', 'high', '문서 바로가기 스크랩', 1, 225),
  ('shs',     'script', 'high', 'Shell 스크랩 개체', 1, 226),
  ('py',      'script', 'medium', 'Python 스크립트(인터프리터 설치 시 실행)', 0, 240),
  ('pyw',     'script', 'medium', 'Python 창 없는 스크립트', 0, 241),
  ('pyc',     'script', 'medium', 'Python 컴파일 파일', 0, 242),
  ('pyz',     'script', 'medium', 'Python 압축 앱', 0, 243),
  ('pl',      'script', 'medium', 'Perl 스크립트', 0, 244),
  ('rb',      'script', 'medium', 'Ruby 스크립트', 0, 245),
  ('php',     'script', 'medium', 'PHP 스크립트', 0, 246),
  ('sh',      'script', 'medium', 'Unix 셸 스크립트', 0, 247),
  -- 설치·패키지
  ('msi',         'installer', 'high', 'Windows Installer 패키지', 1, 300),
  ('msix',        'installer', 'high', 'Windows 앱 패키지', 1, 301),
  ('msixbundle',  'installer', 'high', 'Windows 앱 번들', 1, 302),
  ('appx',        'installer', 'high', 'Windows 앱 패키지', 1, 303),
  ('appxbundle',  'installer', 'high', 'Windows 앱 번들', 1, 304),
  ('msp',         'installer', 'high', 'Windows Installer 패치', 1, 305),
  ('mst',         'installer', 'high', 'Windows Installer 변환', 1, 306),
  ('msu',         'installer', 'high', 'Windows 업데이트 패키지', 1, 307),
  ('application', 'installer', 'high', 'ClickOnce 배포 매니페스트', 1, 308),
  ('appref-ms',   'installer', 'high', 'ClickOnce 앱 참조', 1, 309),
  ('gadget',      'installer', 'high', 'Windows 가젯', 1, 310),
  ('xbap',        'installer', 'high', 'XAML 브라우저 앱', 1, 311),
  ('diagcab',     'installer', 'high', '문제 해결 패키지(악용 사례 — Follina 계열)', 1, 312),
  ('apk',         'installer', 'high', 'Android 앱 설치 파일(스미싱 악성앱 유포 주경로)', 1, 313),
  ('xapk',        'installer', 'high', 'Android 앱 분할 설치 파일', 1, 314),
  ('cab',         'installer', 'high', 'Windows 캐비닛(설치 압축)', 1, 315),
  -- 바로가기·링크
  ('lnk',                 'shortcut', 'high', 'Windows 바로가기(명령 실행 가능 — 최근 악성코드 주 유포 형식)', 1, 400),
  ('url',                 'shortcut', 'high', '인터넷 바로가기', 1, 401),
  ('website',             'shortcut', 'high', '고정 사이트 바로가기', 1, 402),
  ('scf',                 'shortcut', 'high', 'Windows 탐색기 명령 파일', 1, 403),
  ('settingcontent-ms',   'shortcut', 'high', '설정 바로가기(명령 실행 악용)', 1, 404),
  ('library-ms',          'shortcut', 'high', 'Windows 라이브러리 정의(원격 경로 악용)', 1, 405),
  ('search-ms',           'shortcut', 'high', 'Windows 검색 바로가기(원격 경로 악용)', 1, 406),
  -- 디스크 이미지(다운로드 보안 표시 우회에 악용)
  ('iso',  'disk', 'high', '디스크 이미지(열면 내부 파일의 보안 경고가 사라짐)', 1, 500),
  ('img',  'disk', 'high', '디스크 이미지', 1, 501),
  ('vhd',  'disk', 'high', '가상 하드 디스크', 1, 502),
  ('vhdx', 'disk', 'high', '가상 하드 디스크', 1, 503),
  ('dmg',  'disk', 'medium', 'macOS 디스크 이미지', 0, 504),
  -- 시스템·설정
  ('reg',   'system', 'high', '레지스트리 파일(열면 시스템 설정 변경)', 1, 600),
  ('inf',   'system', 'high', '설치 정보 파일', 1, 601),
  ('ins',   'system', 'high', '인터넷 통신 설정', 1, 602),
  ('isp',   'system', 'high', '인터넷 통신 설정', 1, 603),
  ('msc',   'system', 'high', 'Microsoft 관리 콘솔 스냅인(악용 사례)', 1, 604),
  ('chm',   'system', 'high', '컴파일된 HTML 도움말(스크립트 실행)', 1, 605),
  ('hlp',   'system', 'high', 'Windows 도움말', 1, 606),
  ('hpj',   'system', 'high', '도움말 프로젝트', 1, 607),
  ('cnt',   'system', 'high', '도움말 목차', 1, 608),
  ('wsb',   'system', 'medium', 'Windows Sandbox 설정', 0, 620),
  ('theme', 'system', 'medium', 'Windows 테마(원격 자원 참조 악용)', 0, 621),
  ('cer',   'system', 'medium', '인증서(설치 유도 시 신뢰 체계 변경)', 0, 622),
  ('crt',   'system', 'medium', '인증서', 0, 623),
  ('der',   'system', 'medium', '인증서', 0, 624),
  -- 매크로 포함 문서(업무상 흔함 — 기본 허용)
  ('docm', 'office_macro', 'medium', '매크로 포함 Word 문서', 0, 700),
  ('dotm', 'office_macro', 'medium', '매크로 포함 Word 서식', 0, 701),
  ('xlsm', 'office_macro', 'medium', '매크로 포함 Excel 통합 문서', 0, 702),
  ('xltm', 'office_macro', 'medium', '매크로 포함 Excel 서식', 0, 703),
  ('xlam', 'office_macro', 'medium', 'Excel 추가 기능', 0, 704),
  ('xla',  'office_macro', 'medium', 'Excel 추가 기능(구형)', 0, 705),
  ('pptm', 'office_macro', 'medium', '매크로 포함 PowerPoint', 0, 706),
  ('potm', 'office_macro', 'medium', '매크로 포함 PowerPoint 서식', 0, 707),
  ('ppam', 'office_macro', 'medium', 'PowerPoint 추가 기능', 0, 708),
  ('ppsm', 'office_macro', 'medium', '매크로 포함 PowerPoint 쇼', 0, 709),
  ('sldm', 'office_macro', 'medium', '매크로 포함 PowerPoint 슬라이드', 0, 710),
  ('one',  'office_macro', 'medium', 'OneNote 섹션(내장 파일 실행 악용 사례)', 0, 711),
  ('iqy',  'office_macro', 'medium', 'Excel 웹 쿼리', 0, 712),
  ('slk',  'office_macro', 'medium', 'SYLK 스프레드시트(매크로 경고 우회 사례)', 0, 713),
  -- 데이터베이스(Access)
  ('mde',   'database', 'high', 'Access 컴파일 데이터베이스(코드 실행)', 1, 800),
  ('ade',   'database', 'high', 'Access 프로젝트 확장', 1, 801),
  ('adp',   'database', 'high', 'Access 프로젝트', 1, 802),
  ('accde', 'database', 'high', 'Access 실행 전용 데이터베이스', 1, 803),
  ('mda',   'database', 'medium', 'Access 추가 기능', 0, 804),
  ('mdb',   'database', 'medium', 'Access 데이터베이스(매크로 포함 가능)', 0, 805),
  ('accdb', 'database', 'medium', 'Access 데이터베이스(매크로 포함 가능)', 0, 806),
  -- Java·크로스플랫폼
  ('jar',   'java', 'high', 'Java 실행 아카이브', 1, 900),
  ('jnlp',  'java', 'high', 'Java 웹 시작 파일', 1, 901),
  ('class', 'java', 'medium', 'Java 클래스 파일', 0, 902),
  -- macOS·Linux
  ('command', 'mac_linux', 'high', 'macOS 터미널 실행 파일', 1, 1000),
  ('app',     'mac_linux', 'medium', 'macOS 응용 프로그램 번들', 0, 1001),
  ('pkg',     'mac_linux', 'medium', 'macOS 설치 패키지', 0, 1002),
  ('run',     'mac_linux', 'medium', 'Linux 실행 설치 파일', 0, 1003),
  ('deb',     'mac_linux', 'medium', 'Debian 패키지', 0, 1004),
  ('rpm',     'mac_linux', 'medium', 'RPM 패키지', 0, 1005),
  -- 압축(내부 파일은 검사할 수 없다 — 기본 허용)
  ('zip', 'archive', 'medium', 'ZIP 압축', 0, 1100),
  ('7z',  'archive', 'medium', '7-Zip 압축', 0, 1101),
  ('rar', 'archive', 'medium', 'RAR 압축', 0, 1102),
  ('alz', 'archive', 'medium', '알집 압축', 0, 1103),
  ('egg', 'archive', 'medium', '알집 EGG 압축(비밀번호 압축 악성 유포 사례)', 0, 1104),
  ('ace', 'archive', 'medium', 'ACE 압축(해제 프로그램 취약점 사례)', 0, 1105),
  ('arj', 'archive', 'medium', 'ARJ 압축', 0, 1106),
  ('lzh', 'archive', 'medium', 'LZH 압축', 0, 1107),
  ('gz',  'archive', 'medium', 'Gzip 압축', 0, 1108),
  ('tgz', 'archive', 'medium', 'Tar+Gzip 압축', 0, 1109),
  ('tar', 'archive', 'medium', 'Tar 묶음', 0, 1110),
  ('bz2', 'archive', 'medium', 'Bzip2 압축', 0, 1111),
  ('xz',  'archive', 'medium', 'XZ 압축', 0, 1112),
  -- 웹(피싱 페이지 첨부)
  ('htm',   'web', 'medium', 'HTML 문서(피싱 로그인 페이지 첨부 사례)', 0, 1200),
  ('html',  'web', 'medium', 'HTML 문서(피싱 로그인 페이지 첨부 사례)', 0, 1201),
  ('shtml', 'web', 'medium', 'HTML 문서', 0, 1202),
  ('mht',   'web', 'medium', '웹 보관 파일', 0, 1203),
  ('mhtml', 'web', 'medium', '웹 보관 파일', 0, 1204),
  ('svg',   'web', 'medium', 'SVG 이미지(스크립트 포함 피싱 사례)', 0, 1205),
  ('xht',   'web', 'medium', 'XHTML 문서', 0, 1206)
ON CONFLICT (ext) DO NOTHING;

-- 관리 권한키 — 시스템 관리자 템플릿에 시드(192 관례).
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('security.attachment_policy', 'security', 'attachment_policy', '메일·메신저 첨부 확장자 정책(전사 기본·인원별 예외) 관리', 'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5('security.attachment_policy'), 1, 16),
       'tpl-system-admin', 'security.attachment_policy', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = 'security.attachment_policy'
   );
