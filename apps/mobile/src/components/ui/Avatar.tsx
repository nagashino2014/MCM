import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { Text, View } from "react-native";

import { API_BASE_URL } from "@/lib/config";
import { getAccessToken } from "@/lib/tokens";

const SIZES = { sm: 28, md: 40, lg: 56 } as const;

/** 한글 이름은 성을 제외한 뒤 두 글자, 영문은 첫 글자 2개까지. */
function initials(name?: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "?";
  if (/[가-힣]/.test(n)) return n.length > 2 ? n.slice(1) : n;
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
function useAuthedSource(photoPath?: string | null) {
  const [src, setSrc] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!photoPath) {
      setSrc(null);
      return;
    }
    if (/^https?:\/\//.test(photoPath)) {
      setSrc({ uri: photoPath });
      return;
    }
    let alive = true;
    void getAccessToken().then((token) => {
      if (!alive) return;
      setSrc({
        uri: `${API_BASE_URL}${photoPath}`,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    });
    return () => {
      alive = false;
    };
  }, [photoPath]);
  return src;
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
