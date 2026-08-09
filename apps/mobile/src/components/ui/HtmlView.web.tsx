import { createElement, useMemo } from "react";
import { View } from "react-native";

import { useTheme } from "@/theme/useTheme";

/**
 * HTML 본문 렌더 — **웹 미리보기 전용 대체 구현**.
 *
 * 앱(iOS/Android)은 `HtmlView.tsx`(react-native-webview)를 쓴다. 그런데 그 라이브러리는
 * 웹 플랫폼을 지원하지 않아 `npx expo start --web` 미리보기에서 메일·결재 본문 자리에
 * "React Native WebView does not support this platform." 문구만 나온다.
 * 디자인 확인이 막히므로 웹에서는 DOM 에 직접 심는다(RNW 환경이라 실제 DOM 이 있다).
 *
 * 정책·인터페이스는 앱 판과 같다 — 스크립트 제거, 원격 이미지는 `showImages` 로만 표시.
 * 차단 안내 배너는 화면(메일 상세)이 그리므로 여기서는 그리지 않는다(중복 방지).
 * 다만 이 파일은 **개발 미리보기용**이라 앱의 WebView 격리만큼 엄격하지는 않다.
 */

/** 스크립트·이벤트 핸들러·위험 태그 제거. */
function sanitize(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|link|meta)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export function HtmlView({
  html,
  showImages = false,
  maxHeight,
}: {
  html: string;
  showImages?: boolean;
  maxHeight?: number;
}) {
  const { c } = useTheme();

  const body = useMemo(() => {
    const clean = sanitize(html);
    // 원격 이미지 차단 — src 를 data-blocked-src 로 바꿔 요청 자체를 막는다(cid:/data: 는 유지).
    return showImages
      ? clean
      : clean.replace(/<img([^>]*?)\ssrc=(["'])(?!data:|cid:)([^"']*)\2/gi, '<img$1 data-blocked-src=$2$3$2');
  }, [html, showImages]);

  return (
    <View>
      {createElement("div", {
        style: {
          padding: 12,
          maxHeight,
          overflow: maxHeight ? "auto" : undefined,
          background: c.card,
          color: c.text,
          fontSize: 15,
          lineHeight: 1.65,
          wordBreak: "break-word",
        },
        dangerouslySetInnerHTML: { __html: body },
      })}
    </View>
  );
}
