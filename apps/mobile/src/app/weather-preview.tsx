/**
 * 날씨 위젯 씬 미리보기 — **개발 전용** 화면(라우트 링크 없음, __DEV__ 에서만 인증을 건너뛴다).
 *
 * 씬은 계절·기상·명절에 따라 저절로 바뀌어서 실제 화면에서는 한 번에 하나밖에 못 본다.
 * 씬을 손볼 때 10종을 나란히 놓고 비교하려고 둔다. `/weather-preview` 로 직접 진입.
 */
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { WeatherWidget } from "@/components/home/weather/WeatherWidget";
import { type SceneKind } from "@/components/home/weather/rules";

const SCENES: SceneKind[] = ["맑음", "흐림", "비", "눈", "봄", "여름휴가", "가을", "설날", "추석", "크리스마스"];

export default function WeatherPreviewScreen() {
  return (
    <SafeAreaView className="flex-1 bg-cd-bg">
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}>
        <Text className="text-[17px] font-extrabold text-cd-text">날씨 위젯 씬 10종</Text>
        {SCENES.map((s) => (
          <View key={s} className="gap-1.5">
            <Text className="text-[12px] font-bold text-cd-muted">{s}</Text>
            <WeatherWidget sceneOverride={s} />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
