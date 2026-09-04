import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { Text, View } from "react-native";

import { API_BASE_URL } from "@/lib/config";
import { personName } from "@/lib/person-name";
import { getAccessToken } from "@/lib/tokens";

const SIZES = { sm: 28, md: 40, lg: 56 } as const;

/**
 * 한글 이름은 성을 제외한 뒤 두 글자, 영문은 첫 글자 2개까지.
 * 회사명·직급이 섞인 표시명("㈜재영물산 이재연")은 personName 으로 이름만 추린 뒤 자른다 —
 * 예전에는 `slice(1)` 이라 원 안에 "재영물산 이재연"이 통째로 들어갔다.
 */
function initials(name?: string | null): string {
  const n = personName(name);
  if (!n) return "?";
  if (/[가-힣]/.test(n)) return n.length > 2 ? n.slice(-2) : n;
  return n
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * 앱 API 로 서빙되는 사진(`/api/admin/employees/{id}/photo`)은 Bearer 인증이 필요하다.
 * 상대경로를 절대 URL 로 바꾸고 토큰 헤더를 붙인 소스를 만든다(토큰 조회가 비동기라 훅으로).
 */
/** 마지막으로 읽은 토큰 — 재마운트 시 첫 렌더부터 사진 소스를 만들어 이니셜↔사진 깜빡임을 막는다. */
let lastToken: string | null = null;

const isAbsolute = (p: string) => /^https?:\/\//.test(p);

function buildSource(photoPath: string, token: string | null) {
  return {
    uri: `${API_BASE_URL}${photoPath}`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

function useAuthedSource(photoPath?: string | null) {
  // 상대경로(앱 API) 사진만 상태를 쓴다 — 절대 URL 은 파생값. 토큰이 이미 알려져 있으면 동기 초기값으로
  // 만들어 목록 항목이 재마운트돼도 이니셜을 거치지 않는다. path 를 같이 들고 있어 경로가 바뀐 직후
  // 옛 사진이 잠깐 보이는 일도 없다.
  const [authed, setAuthed] = useState<{ path: string; source: { uri: string; headers?: Record<string, string> } } | null>(() =>
    photoPath && !isAbsolute(photoPath) && lastToken ? { path: photoPath, source: buildSource(photoPath, lastToken) } : null
  );
  useEffect(() => {
    if (!photoPath || isAbsolute(photoPath)) return;
    let alive = true;
    void getAccessToken().then((token) => {
      if (!alive) return;
      lastToken = token;
      setAuthed({ path: photoPath, source: buildSource(photoPath, token) });
    });
    return () => {
      alive = false;
    };
  }, [photoPath]);
  if (!photoPath) return null;
  if (isAbsolute(photoPath)) return { uri: photoPath };
  return authed && authed.path === photoPath ? authed.source : null;
}

/** 아바타 — 사진이 있으면 사진, 없으면 이니셜(웹 CdAvatar 대응, 기본 md=40px). */
export function Avatar({
  name,
  uri,
  photoPath,
  size = "md",
}: {
  name?: string | null;
  /** 완전한 이미지 URL(외부). */
  uri?: string | null;
  /** 앱 API 의 사진 경로 — 인증 헤더를 붙여 불러온다. */
  photoPath?: string | null;
  size?: keyof typeof SIZES;
}) {
  const px = SIZES[size];
  const font = size === "lg" ? 18 : size === "md" ? 14 : 11;
  const authed = useAuthedSource(photoPath);
  const source = uri ? { uri } : authed;

  if (source) {
    return (
      <Image
        source={source}
        style={{ width: px, height: px, borderRadius: px / 2 }}
        contentFit="cover"
        transition={120}
      />
    );
  }
  return (
    <View
      style={{ width: px, height: px, borderRadius: px / 2 }}
      className="items-center justify-center bg-cd-primary-soft">
      <Text style={{ fontSize: font }} className="font-extrabold text-cd-primary">
        {initials(name)}
      </Text>
    </View>
  );
}
