#!/bin/bash
# bastion(Amazon Linux 2023) 에 DART 아웃바운드용 forward proxy(squid) 를 설치·구성한다.
# 목적: ECS(next) 태스크가 이 프록시(bastion:8888) 를 경유해 DART 를 호출하면,
#       DART 가 보는 outbound IP 가 항상 bastion EIP(3.35.97.169) 로 고정된다.
# 실행: SSM Run Command 로 idempotent 하게 반복 실행 가능.
#   aws ssm send-command --instance-ids <bastion> --document-name AWS-RunShellScript ...
# 주의: tinyproxy 는 AL2023 리포에 없어 squid 로 구성한다(HTTP + HTTPS CONNECT 터널).
set -eux

dnf -y install squid

# forward proxy 최소 설정: VPC 대역만 허용, HTTPS(443) CONNECT 터널 허용, 캐시 비활성.
# SG 가 이미 ECS SG 만 8888 인바운드로 허용하므로 0.0.0.0 바인딩이어도 외부 노출 없음.
cat > /etc/squid/squid.conf <<'CONF'
http_port 8888

# 허용 대상: VPC 내부(ECS 태스크)만.
acl mcm_vpc src 10.40.0.0/16

# HTTPS CONNECT 터널은 443 으로만.
acl SSL_ports port 443
acl CONNECT method CONNECT
http_access deny CONNECT !SSL_ports

http_access allow mcm_vpc
http_access deny all

# forward proxy 전용 — 캐시하지 않음(정형 공시 데이터 신선도 유지).
cache deny all

# 컨테이너/EC2 로그로 바로 보이게 stdio 로깅.
access_log stdio:/var/log/squid/access.log
CONF

systemctl enable squid
systemctl restart squid
sleep 2
systemctl is-active squid
ss -lntp | grep ':8888' || true

# 자기 자신을 프록시로 DART 헬스체크(CONNECT 터널 확인). test 키라 status 는 인증오류지만
# HTTP 200(+DART status)로 오면 터널·아웃바운드 정상.
curl -s -x http://127.0.0.1:8888 --max-time 20 \
  -o /dev/null -w "proxy_dart_http_code=%{http_code}\n" \
  "https://opendart.fss.or.kr/api/list.json?crtfc_key=test&bgn_de=20260101&end_de=20260102" \
  || echo "proxy_dart_test_failed"
