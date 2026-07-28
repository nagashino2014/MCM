import { useMemo, useState } from "react";
import { Linking, View } from "react-native";
import { WebView } from "react-native-webview";

import { useTheme } from "@/theme/useTheme";

/**
 * HTML 본문 렌더(메일 본문·결재 multitext·게시판 본문 공용).
 *
 * 정책(블루프린트 §9.1):
 * - JS 비활성, 원격 이미지는 기본 차단(`showImages` 로 사용자가 명시 허용).
 * - 링크 탭은 앱 안에서 열지 않고 외부 브라우저로 넘긴다.
 * - 높이는 내용에 맞춰 자동(부모 스크롤 안에 그대로 놓을 수 있게).
 */
export function HtmlView({
  html,
  showImages = false,
  maxHeight,
}: {
  html: string;
  showImages?: boolean;
  maxHeight?: number;
}) {
  const { c, dark } = useTheme();
  const [height, setHeight] = useState(80);

  const doc = useMemo(() => {
    // 원격 이미지 차단 — src 를 data-blocked-src 로 바꿔 요청 자체를 막는다(cid:/data: 는 유지).
    const body = showImages
      ? html
      : html.replace(
          /<img([^>]*?)\ssrc=(["'])(?!data:|cid:)([^"']*)\2/gi,
          '<img$1 data-blocked-src=$2$3$2'
        );

    return `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<style>
  html,body{margin:0;padding:0;background:${c.card};color:${c.text};
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    font-size:15px;line-height:1.65;word-break:break-word;-webkit-text-size-adjust:100%}
  img{max-width:100%;height:auto}
  img[data-blocked-src]{display:inline-block;min-width:80px;min-height:24px;
    background:${c.surface};border:1px dashed ${c.border};border-radius:6px}
  a{color:${c.primary}}
  table{max-width:100%;border-collapse:collapse}
  td,th{border:1px solid ${c.border};padding:6px}
  blockquote{margin:8px 0;padding-left:10px;border-left:3px solid ${c.border};color:${c.muted}}
  pre{white-space:pre-wrap}
</style></head><body>${body}
<script>
  function post(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(
    String(document.documentElement.scrollHeight));}
  window.addEventListener('load',post);setTimeout(post,120);setTimeout(post,600);
</script>
</body></html>`;
  }, [html, showImages, c.card, c.text, c.surface, c.border, c.primary, c.muted]);

  const h = maxHeight ? Math.min(height, maxHeight) : height;

  return (
    <View style={{ height: h }}>
      <WebView
        // key: 테마 전환 시 문서를 다시 심어 색이 반영되게 한다.
        key={dark ? "d" : "l"}
        originWhitelist={["*"]}
        source={{ html: doc }}
        style={{ backgroundColor: c.card }}
        scrollEnabled={!!maxHeight}
        // 높이 계산용 스크립트만 허용하고, 문서 자체의 스크립트는 실행되지 않는다(본문은 정적 HTML).
        javaScriptEnabled
        onMessage={(e) => {
          const n = Number(e.nativeEvent.data);
          if (Number.isFinite(n) && n > 0) setHeight(Math.ceil(n) + 8);
        }}
        onShouldStartLoadWithRequest={(req) => {
          if (req.url === "about:blank" || req.url.startsWith("data:")) return true;
          void Linking.openURL(req.url);
          return false;
        }}
      />
    </View>
  );
}
