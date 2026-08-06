/** 기본 날씨 씬 4종 — 맑음·흐림·비·눈(웹 WeatherWidget 의 같은 이름 씬과 1:1). */
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { Cloud, Drift, RainLayer, SceneCanvas, SnowLayer, Sun, type SceneProps } from "./parts";

const W_WHITE: [string, string] = ["#FFFFFF", "#EAEFF8"];
const W_WHITE2: [string, string] = ["#FFFFFF", "#F0F3FA"];

export function SunnyScene(p: SceneProps) {
  return (
    <SceneCanvas {...p} anchor="topRight">
      <Sun
        glow={{ top: -36, right: -30, size: 210 }}
        ray={{ top: 10, right: 14, size: 94 }}
        core={{ top: 33, right: 37, size: 48 }}
      />
      <Cloud
        id="sc1"
        style={{ top: 96, right: 70 }}
        w={100}
        h={36}
        base={{ w: 100, h: 25, c: W_WHITE }}
        puffs={[
          { b: 10, l: 15, s: 34, c: W_WHITE2 },
          { b: 10, l: 46, s: 26, c: W_WHITE },
        ]}
        drift={{ from: -8, to: 12, duration: 9000 }}
      />
      <Cloud
        id="sc2"
        style={{ top: 150, right: 20 }}
        w={74}
        h={28}
        opacity={0.7}
        base={{ w: 74, h: 19, c: W_WHITE }}
        puffs={[{ b: 8, l: 12, s: 25, c: W_WHITE2 }]}
        drift={{ from: 10, to: -9, duration: 12000 }}
      />
    </SceneCanvas>
  );
}

export function CloudyScene(p: SceneProps) {
  return (
    <SceneCanvas {...p} anchor="topRight">
      <Cloud
        id="cc1"
        style={{ top: 48, right: 118 }}
        w={108}
        h={42}
        opacity={0.75}
        base={{ w: 108, h: 28, c: ["#D9E0EE", "#C3CDE1"] }}
        puffs={[
          { b: 11, l: 16, s: 38, c: ["#E2E8F3", "#CBD4E6"] },
          { b: 11, l: 50, s: 28, c: ["#DDE4F0", "#C3CDE1"] },
        ]}
        drift={{ from: 10, to: -9, duration: 11000 }}
      />
      <Cloud
        id="cc2"
        style={{ top: 14, right: 14 }}
        w={136}
        h={54}
        base={{ w: 136, h: 34, c: W_WHITE }}
        puffs={[
          { b: 14, l: 17, s: 48, c: ["#FFFFFF", "#EEF2F9"] },
          { b: 14, l: 60, s: 37, c: W_WHITE },
        ]}
        drift={{ from: -8, to: 12, duration: 8000 }}
      />
      <Cloud
        id="cc3"
        style={{ top: 118, right: 36 }}
        w={96}
        h={30}
        opacity={0.6}
        base={{ w: 96, h: 20, c: ["#E6EBF5", "#D2DAEA"] }}
        puffs={[{ b: 8, l: 14, s: 28, c: ["#EBEFF7", "#D8DFED"] }]}
        drift={{ from: 12, to: -8, duration: 13000 }}
      />
      {/* 안개 띠(cdHaze) */}
      <Drift from={0} to={8} duration={6000} style={{ top: 104, right: 150, width: 80, height: 11, opacity: 0.7 }}>
        <Svg width={80} height={11}>
          <Defs>
            <LinearGradient id="hazeG" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#BEC8E0" stopOpacity={0} />
              <Stop offset="0.5" stopColor="#BEC8E0" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#BEC8E0" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={80} height={11} rx={5.5} fill="url(#hazeG)" />
        </Svg>
      </Drift>
    </SceneCanvas>
  );
}

export function RainScene(p: SceneProps) {
  return (
    <SceneCanvas {...p} anchor="topRight">
      {/* 구름을 뒤에 그려 빗줄기 위로 올린다(웹의 zIndex:1 과 같은 효과). */}
      <RainLayer style={{ top: 52, right: 8, width: 225, height: 130, transform: [{ rotate: "7deg" }] }} />
      <Cloud
        id="rc1"
        style={{ top: 38, right: 126 }}
        w={96}
        h={34}
        opacity={0.8}
        base={{ w: 96, h: 24, c: ["#CBD4E6", "#AEBBD6"] }}
        puffs={[{ b: 9, l: 14, s: 33, c: ["#D5DDEC", "#B6C2DA"] }]}
        drift={{ from: 10, to: -9, duration: 10000 }}
      />
      <Cloud
        id="rc2"
        style={{ top: 10, right: 18 }}
        w={128}
        h={50}
        base={{ w: 128, h: 31, c: ["#F4F7FC", "#C9D3E6"] }}
        puffs={[
          { b: 13, l: 16, s: 45, c: ["#FBFCFE", "#D3DCEC"] },
          { b: 13, l: 57, s: 34, c: ["#F4F7FC", "#C9D3E6"] },
        ]}
        drift={{ from: -8, to: 12, duration: 8000 }}
      />
    </SceneCanvas>
  );
}

export function SnowScene(p: SceneProps) {
  return (
    <SceneCanvas {...p} anchor="topRight">
      <SnowLayer style={{ top: 52, right: 8, width: 235, height: 130 }} />
      <Cloud
        id="nc1"
        style={{ top: 38, right: 124 }}
        w={92}
        h={32}
        opacity={0.85}
        base={{ w: 92, h: 23, c: ["#F2F5FB", "#DCE3F0"] }}
        puffs={[{ b: 8, l: 14, s: 31, c: ["#F8FAFD", "#E2E8F3"] }]}
        drift={{ from: 10, to: -9, duration: 11000 }}
      />
      <Cloud
        id="nc2"
        style={{ top: 9, right: 20 }}
        w={126}
        h={50}
        base={{ w: 126, h: 31, c: ["#FFFFFF", "#E4EAF5"] }}
        puffs={[
          { b: 13, l: 15, s: 45, c: ["#FFFFFF", "#ECF0F8"] },
          { b: 13, l: 56, s: 34, c: ["#FFFFFF", "#E4EAF5"] },
        ]}
        drift={{ from: -8, to: 12, duration: 9000 }}
      />
    </SceneCanvas>
  );
}
