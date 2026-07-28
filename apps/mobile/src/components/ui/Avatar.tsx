import { Image } from "expo-image";
import { Text, View } from "react-native";

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

/** 아바타 — 사진이 있으면 사진, 없으면 이니셜(웹 CdAvatar 대응, 기본 md=40px). */
export function Avatar({
  name,
  uri,
  size = "md",
}: {
  name?: string | null;
  uri?: string | null;
  size?: keyof typeof SIZES;
}) {
  const px = SIZES[size];
  const font = size === "lg" ? 18 : size === "md" ? 14 : 11;

  if (uri) {
    return (
      <Image
        source={{ uri }}
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
