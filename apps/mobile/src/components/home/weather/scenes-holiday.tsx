/** 명절 씬 3종 — 설날·추석·크리스마스(기상과 무관하게 시즌 구간에 나온다). */
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import Svg, { Circle, Ellipse, Line, Path, Polygon, Rect } from "react-native-svg";

import { usePingPong, useLinearLoop } from "./anim";
import {
  Drift,
  MapleLayer,
  SceneBand,
  SceneCanvas,
  SnowLayer,
  Sway,
  Twinkle,
  TwinkleRect,
  type SceneProps,
} from "./parts";
import { SCENE_H, SCENE_W } from "./rules";

export function SeolScene(p: SceneProps) {
  const kite = usePingPong(5500);
  const kiteSt = useAnimatedStyle(() => ({
    transform: [
      { translateX: -14 * kite.value },
      { translateY: -16 * kite.value },
      { rotate: `${-5 + 11 * kite.value}deg` },
    ],
  }));

  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={240}>
        <Path d="M0 196 Q110 184 220 192 T400 188 L400 240 L0 240 Z" fill="rgba(248,250,255,0.95)" />
      </SceneBand>
      <SceneCanvas {...p}>
        <Svg style={{ position: "absolute", left: 0, bottom: 0 }} width={SCENE_W} height={240} viewBox="0 0 400 240">
          <Ellipse cx={296} cy={200} rx={86} ry={7} fill="rgba(190,200,225,0.35)" />
          <Rect x={236} y={192} width={128} height={8} rx={2} fill="#C9C2B4" />
          <Rect x={244} y={152} width={112} height={40} fill="#8A6240" />
          <Rect x={247} y={156} width={14} height={32} fill="#E8DFC8" />
          <Rect x={339} y={156} width={14} height={32} fill="#E8DFC8" />
          <Rect x={267} y={156} width={20} height={36} rx={1.5} fill="#B98A63" />
          <Rect x={291} y={156} width={20} height={36} rx={1.5} fill="#B98A63" />
          <Rect x={315} y={156} width={20} height={36} rx={1.5} fill="#B98A63" />
          <Path
            d="M273 156 V192 M281 156 V192 M297 156 V192 M305 156 V192 M321 156 V192 M329 156 V192 M267 164 H335 M267 174 H335 M267 184 H335"
            stroke="#E8DFC8"
            strokeWidth={1.2}
          />
          <Rect x={263} y={152} width={4} height={40} fill="#6E4A2A" />
          <Rect x={287} y={152} width={4} height={40} fill="#6E4A2A" />
          <Rect x={311} y={152} width={4} height={40} fill="#6E4A2A" />
          <Rect x={335} y={152} width={4} height={40} fill="#6E4A2A" />
          <Rect x={228} y={148} width={144} height={5} fill="#6E4A2A" />
          <Path
            d="M256 102 Q300 110 344 102 C362 114 376 128 392 140 Q346 152 300 150 Q254 152 208 140 C224 128 238 114 256 102 Z"
            fill="#4A4E5C"
          />
          <Path d="M256 93 Q300 101 344 93 L344 103 Q300 111 256 103 Z" fill="#33374A" />
          <Rect x={250} y={89} width={12} height={15} rx={2.5} fill="#33374A" />
          <Rect x={338} y={89} width={12} height={15} rx={2.5} fill="#33374A" />
          <Path
            d="M268 104 Q256 126 242 141 M284 104 Q278 126 272 147 M300 104 V149 M316 104 Q322 126 328 147 M332 104 Q344 126 358 141"
            stroke="#3A3E4C"
            strokeWidth={1.8}
            fill="none"
          />
          <Path
            d="M212 139 Q254 149 300 147 Q346 149 388 139"
            stroke="#DDE2EC"
            strokeWidth={4}
            strokeDasharray="0.8 7.4"
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
          <Path d="M254 91 Q300 100 346 91" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.95} />
          <Ellipse cx={256} cy={87} rx={7} ry={2.5} fill="#FFFFFF" opacity={0.95} />
          <Ellipse cx={344} cy={87} rx={7} ry={2.5} fill="#FFFFFF" opacity={0.95} />
          <Ellipse cx={270} cy={118} rx={11} ry={3} fill="#FFFFFF" opacity={0.9} />
          <Ellipse cx={322} cy={124} rx={13} ry={3.5} fill="#FFFFFF" opacity={0.9} />
          <Ellipse cx={296} cy={111} rx={8} ry={2.5} fill="#FFFFFF" opacity={0.9} />
          <Ellipse cx={238} cy={132} rx={9} ry={2.8} fill="#FFFFFF" opacity={0.85} />
          <Ellipse cx={360} cy={130} rx={9} ry={2.8} fill="#FFFFFF" opacity={0.85} />
          <Path
            d="M214 137 Q254 147 300 145 Q346 147 386 137"
            stroke="#FFFFFF"
            strokeWidth={4}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
          <Line x1={242} y1={142} x2={242} y2={152} stroke="#B98A2E" strokeWidth={1.6} />
          <Rect x={237} y={152} width={10} height={5} rx={2} fill="#E3A63B" />
          <Circle cx={242} cy={163} r={9} fill="#D84B3F" />
          {/* 한복 인물 2명(핸드오프 디테일 확정판) — 연줄 잡은 소녀: 색동 소매·저고리 옷고름·치마 주름·버선 */}
          <Path d="M96 76 Q124 128 152 156" stroke="rgba(90,95,120,0.4)" strokeWidth={1.4} fill="none" />
          <Path d="M156 163 L151.5 157.5" stroke="#FBF6EC" strokeWidth={4.4} strokeLinecap="round" />
          <Circle cx={151.5} cy={157} r={2} fill="#F7D9C4" />
          <Path d="M168 163 L173.5 168.5" stroke="#FBF6EC" strokeWidth={4.4} strokeLinecap="round" />
          <Circle cx={174} cy={169} r={2} fill="#F7D9C4" />
          <Path d="M153.2 158.6 l2.4 -2 M170.9 166 l-2.3 2.1" stroke="#D84B3F" strokeWidth={1.1} />
          <Path d="M154.5 160 l2.3 -1.9 M169.6 164.6 l-2.3 2" stroke="#5468C9" strokeWidth={1.1} />
          <Path d="M152 162 h20 q2 5 1.6 8.5 h-23.2 q-0.4 -3.5 1.6 -8.5 Z" fill="#FBF6EC" stroke="#D8CBA8" strokeWidth={0.7} />
          <Path d="M162 164 q-3.2 1.4 -4 5.4" stroke="#D84B3F" strokeWidth={1.6} fill="none" strokeLinecap="round" />
          <Rect x={160.6} y={163.2} width={2.8} height={2} rx={0.6} fill="#D84B3F" />
          <Path d="M151 170.5 h22 l5.5 23 q-16.5 5 -33 0 Z" fill="#D84B3F" />
          <Path d="M158 174 l-2.6 17 M166 174 l2.6 17 M162 174 l0 18" stroke="#B03A32" strokeWidth={0.9} fill="none" />
          <Ellipse cx={156} cy={194.5} rx={3} ry={1.6} fill="#FBF6EC" />
          <Ellipse cx={168} cy={194.5} rx={3} ry={1.6} fill="#FBF6EC" />
          <Circle cx={162} cy={150} r={7.5} fill="#F7D9C4" />
          <Path d="M153.8 148.5 q8.2 -10 16.4 0 l-1.2 2.8 q-7 -5.6 -14 0 Z" fill="#2F2A33" />
          <Path d="M154.5 150 q-1.5 3 -1 5.5 M169.5 150 q1.5 3 1 5.5" stroke="#2F2A33" strokeWidth={2} fill="none" strokeLinecap="round" />
          <Path d="M153.5 155.5 l-0.6 2.4 M170.5 155.5 l0.6 2.4" stroke="#D84B3F" strokeWidth={1.4} strokeLinecap="round" />
          <Circle cx={159.2} cy={150} r={0.9} fill="#2F2A33" />
          <Circle cx={164.8} cy={150} r={0.9} fill="#2F2A33" />
          <Path d="M160.6 153.2 q1.4 1.3 2.8 0" stroke="#B0684A" strokeWidth={0.9} fill="none" strokeLinecap="round" />
          <Circle cx={157} cy={152.3} r={1.2} fill="rgba(240,150,150,0.5)" />
          <Circle cx={167} cy={152.3} r={1.2} fill="rgba(240,150,150,0.5)" />
          {/* 연을 가리키는 소년 — 남바위(흰 테두리)·금색 조끼·바지·짚신 */}
          <Path d="M191 168 L185.5 161.5" stroke="#5468C9" strokeWidth={4} strokeLinecap="round" />
          <Circle cx={185} cy={161} r={1.8} fill="#F7D9C4" />
          <Path d="M201.5 169 L206 173.5" stroke="#5468C9" strokeWidth={4} strokeLinecap="round" />
          <Circle cx={206.4} cy={174} r={1.8} fill="#F7D9C4" />
          <Path d="M187.2 163 l2.2 -1.8 M203.8 171 l-2.1 1.9" stroke="#E3A63B" strokeWidth={1} />
          <Path d="M188 167 h16 q1.8 4.5 1.4 7.5 h-18.8 q-0.4 -3 1.4 -7.5 Z" fill="#5468C9" stroke="#3E4C9A" strokeWidth={0.7} />
          <Path d="M196 168.5 q-2.6 1.2 -3.2 4.4" stroke="#F3E7D3" strokeWidth={1.4} fill="none" strokeLinecap="round" />
          <Path d="M192.5 175 q-1 9 -1.3 15.5" stroke="#E8DFC8" strokeWidth={5} fill="none" strokeLinecap="round" />
          <Path d="M199.5 175 q1 9 1.3 15.5" stroke="#E8DFC8" strokeWidth={5} fill="none" strokeLinecap="round" />
          <Path d="M189.8 186 l3.4 0.6 M198.8 186.6 l3.4 -0.6" stroke="#5468C9" strokeWidth={1.2} />
          <Ellipse cx={191} cy={192} rx={3.2} ry={1.7} fill="#2F2A33" />
          <Ellipse cx={201} cy={192} rx={3.2} ry={1.7} fill="#2F2A33" />
          <Circle cx={196} cy={158} r={6.5} fill="#F7D9C4" />
          <Path d="M188.8 157 q7.2 -9.5 14.4 0 l0 2.6 q-7.2 -4.6 -14.4 0 Z" fill="#2F2A33" />
          <Path d="M189 159.4 q7 -4.4 14 0" stroke="#FBF6EC" strokeWidth={1.6} fill="none" strokeLinecap="round" />
          <Circle cx={196} cy={149.5} r={1.6} fill="#D84B3F" />
          <Circle cx={193.6} cy={158.6} r={0.85} fill="#2F2A33" />
          <Circle cx={198.4} cy={158.6} r={0.85} fill="#2F2A33" />
          <Ellipse cx={196} cy={161.6} rx={1.3} ry={1.6} fill="#B0684A" />
          <Circle cx={191.6} cy={160.4} r={1.1} fill="rgba(240,150,150,0.5)" />
          <Circle cx={200.4} cy={160.4} r={1.1} fill="rgba(240,150,150,0.5)" />
          {/* 눈사람 */}
          <Ellipse cx={70} cy={200} rx={26} ry={4.5} fill="rgba(200,210,235,0.5)" />
          <Circle cx={70} cy={186} r={12} fill="#FFFFFF" stroke="#DCE3F0" strokeWidth={1.4} />
          <Circle cx={70} cy={168} r={8.5} fill="#FFFFFF" stroke="#DCE3F0" strokeWidth={1.4} />
          <Circle cx={67} cy={166} r={1.3} fill="#2A3040" />
          <Circle cx={73} cy={166} r={1.3} fill="#2A3040" />
          <Polygon points="70,168 79,170 70,172" fill="#E8813E" />
        </Svg>
        {/* 방패연 — 카드가 캔버스 위쪽 29px 를 잘라내므로 웹(top 14)보다 내려 잡는다. */}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 34, left: 78, width: 44, height: 92 }, kiteSt]}>
          <Svg width={44} height={92} viewBox="0 0 48 100">
            <Polygon points="24,2 46,28 24,54 2,28" fill="#E85D5D" />
            <Path d="M24 2 V54 M2 28 H46" stroke="#FFF3E0" strokeWidth={1.6} />
            <Circle cx={24} cy={28} r={6.5} fill="#F2C14E" />
            <Path d="M24 54 q12 16 0 30 q-12 14 0 28" stroke="#E85D5D" strokeWidth={2} fill="none" />
            <Rect x={18} y={66} width={7} height={4} rx={1} fill="#5468C9" transform="rotate(-18 21 68)" />
            <Rect x={24} y={86} width={7} height={4} rx={1} fill="#F2C14E" transform="rotate(14 27 88)" />
          </Svg>
        </Animated.View>
      </SceneCanvas>
      <SnowLayer tall style={{ top: 8, left: 0, right: 0, bottom: 0 }} />
    </>
  );
}

export function ChuseokScene(p: SceneProps) {
  // 떡방아 — 몸통 기울임(cdLean)과 절굿공이 아크 모션(cdPoundV)이 2.2s 로 동기화된다.
  const pound = usePingPong(2200);
  const leanSt = useAnimatedStyle(() => ({ transform: [{ rotate: `${6 * pound.value}deg` }] }));
  // cdPoundV 아크 모션(시안 확정판) — 들어올림(-8°/-8px) → 내려찍음(+9px)을 왕복값으로 근사.
  const poundSt = useAnimatedStyle(() => {
    const t = pound.value;
    const lift = t < 0.4 ? t / 0.4 : 0;
    const strike = t >= 0.4 ? (t - 0.4) / 0.6 : 0;
    return {
      transform: [
        { translateX: -2 * lift - 1 * strike },
        { translateY: -8 * lift + 9 * strike },
        { rotate: `${-8 * lift + 3 * strike}deg` },
      ],
    };
  });

  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={SCENE_H}>
        <Path d="M0 232 Q110 220 220 228 T400 224 L400 286 L0 286 Z" fill="rgba(150,138,185,0.35)" />
      </SceneBand>
      <SceneCanvas {...p}>
        <Svg style={{ position: "absolute", left: 0, top: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          {/* 보름달 */}
          <Circle cx={100} cy={98} r={72} fill="rgba(245,206,126,0.28)" />
          <Circle cx={100} cy={98} r={54} fill="#FFF3D0" />
          <Circle cx={78} cy={84} r={6} fill="rgba(228,186,110,0.42)" />
          <Circle cx={118} cy={70} r={4.5} fill="rgba(228,186,110,0.38)" />
          <Circle cx={66} cy={112} r={5} fill="rgba(228,186,110,0.38)" />
          <Ellipse cx={86} cy={136} rx={15} ry={2.6} fill="rgba(180,150,90,0.3)" />
          <Ellipse cx={114} cy={139} rx={12} ry={2.4} fill="rgba(180,150,90,0.3)" />
          {/* 절구 */}
          <Path d="M103 106 h22 l-2.5 26 q-0.8 5 -8.5 5 q-7.7 0 -8.5 -5 Z" fill="#8A6240" />
          <Path d="M104 116 h20 M105 126 h18" stroke="#6E4A2A" strokeWidth={1.2} />
          <Ellipse cx={114} cy={106} rx={11} ry={3} fill="#A97B4F" />
          <Ellipse cx={114} cy={105} rx={7} ry={2.2} fill="#FFF8E8" />
          {/* 감나무 — 카드가 캔버스 위쪽 29px 를 잘라내므로 웹 좌표에서 통째로 18 내렸다(가지 끝이 잘리지 않게). */}
          <Path d="M400 38 Q348 52 312 84 M366 56 Q356 74 358 90" stroke="#6E4E3A" strokeWidth={7} fill="none" strokeLinecap="round" />
          <Ellipse cx={330} cy={70} rx={14} ry={7} fill="#4F7D5A" transform="rotate(-22 330 70)" />
          <Ellipse cx={368} cy={54} rx={12} ry={6} fill="#5A8A64" transform="rotate(-10 368 54)" />
          <Ellipse cx={298} cy={80} rx={11} ry={5.5} fill="#4F7D5A" transform="rotate(-30 298 80)" />
          <Circle cx={338} cy={102} r={13} fill="#E8813E" />
          <Circle cx={306} cy={94} r={11} fill="#E06F2E" />
          <Circle cx={372} cy={82} r={10} fill="#E8813E" />
          <Path d="M331 92 h14 l-3 4 h-8 Z" fill="#4F7D5A" />
          <Path d="M300 85 h12 l-2.5 4 h-7 Z" fill="#4F7D5A" />
          <Path d="M366 74 h12 l-2.5 4 h-7 Z" fill="#4F7D5A" />
          {/* 한옥 */}
          <Rect x={236} y={224} width={128} height={8} rx={2} fill="#8E8CA0" />
          <Rect x={244} y={184} width={112} height={40} fill="#8A6240" />
          <Rect x={247} y={188} width={14} height={32} fill="#E8DFC8" />
          <Rect x={339} y={188} width={14} height={32} fill="#E8DFC8" />
          <TwinkleRect x={267} y={188} width={20} height={36} rx={1.5} fill="#F5CE7E" duration={4000} />
          <Rect x={291} y={188} width={20} height={36} rx={1.5} fill="#F0C468" />
          <TwinkleRect x={315} y={188} width={20} height={36} rx={1.5} fill="#F5CE7E" duration={5000} delay={1200} />
          <Path
            d="M273 188 V224 M281 188 V224 M297 188 V224 M305 188 V224 M321 188 V224 M329 188 V224 M267 196 H335 M267 206 H335 M267 216 H335"
            stroke="#8A6240"
            strokeWidth={1.2}
          />
          <Rect x={263} y={184} width={4} height={40} fill="#6E4A2A" />
          <Rect x={287} y={184} width={4} height={40} fill="#6E4A2A" />
          <Rect x={311} y={184} width={4} height={40} fill="#6E4A2A" />
          <Rect x={335} y={184} width={4} height={40} fill="#6E4A2A" />
          <Rect x={228} y={180} width={144} height={5} fill="#6E4A2A" />
          <Path
            d="M256 134 Q300 142 344 134 C362 146 376 160 392 172 Q346 184 300 182 Q254 184 208 172 C224 160 238 146 256 134 Z"
            fill="#3A3F52"
          />
          <Path d="M256 125 Q300 133 344 125 L344 135 Q300 143 256 135 Z" fill="#2E3344" />
          <Rect x={250} y={121} width={12} height={15} rx={2.5} fill="#2E3344" />
          <Rect x={338} y={121} width={12} height={15} rx={2.5} fill="#2E3344" />
          <Path
            d="M268 136 Q256 158 242 173 M284 136 Q278 158 272 179 M300 136 V181 M316 136 Q322 158 328 179 M332 136 Q344 158 358 173"
            stroke="#2E3344"
            strokeWidth={1.8}
            fill="none"
          />
          <Path
            d="M212 171 Q254 181 300 179 Q346 181 388 171"
            stroke="#E8E4F0"
            strokeWidth={4}
            strokeDasharray="0.8 7.4"
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
        </Svg>
        {/* 달토끼 몸통 — viewBox 오프셋으로 원본 좌표를 그대로 쓴다(회전 기준만 옮긴다). */}
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", left: 66, top: 55, width: 46, height: 86, transformOrigin: "55% 96%" }, leanSt]}>
          <Svg width={46} height={86} viewBox="66 55 46 86">
            <Circle cx={74} cy={122} r={4.5} fill="#FFFFFF" />
            <Ellipse cx={86} cy={118} rx={12} ry={16} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1.2} />
            <Ellipse cx={80} cy={133} rx={5.5} ry={3} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} />
            <Ellipse cx={93} cy={133} rx={5.5} ry={3} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} />
            <Ellipse cx={82} cy={74} rx={4} ry={14} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} transform="rotate(-10 82 74)" />
            <Ellipse cx={95} cy={73} rx={4} ry={14} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} transform="rotate(6 95 73)" />
            <Ellipse cx={82} cy={76} rx={2} ry={9} fill="#F0BFC6" transform="rotate(-10 82 76)" />
            <Ellipse cx={95} cy={75} rx={2} ry={9} fill="#F0BFC6" transform="rotate(6 95 75)" />
            <Circle cx={88} cy={94} r={11} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1.2} />
            <Ellipse cx={87} cy={105} rx={7} ry={6.5} fill="#FBF8F0" />
            <Circle cx={93} cy={92} r={1.6} fill="#4A4038" />
            <Circle cx={98} cy={96} r={1.3} fill="#E0A0A8" />
            <Circle cx={91} cy={99} r={2} fill="rgba(240,170,180,0.5)" />
          </Svg>
        </Animated.View>
        {/* 절굿공이 + 팔 */}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 90, top: 62, width: 32, height: 48 }, poundSt]}>
          <Svg width={32} height={48} viewBox="90 62 32 48">
            <Rect x={111} y={70} width={6} height={34} rx={3} fill="#B98A63" />
            <Rect x={108} y={63} width={12} height={11} rx={4} fill="#A97B4F" />
            <Path d="M93 108 Q103 102 112 93" stroke="#FBF8F0" strokeWidth={5} fill="none" strokeLinecap="round" />
          </Svg>
        </Animated.View>
        {/* 옅은 구름 */}
        <Drift from={-8} to={12} duration={10000} style={{ top: 150, left: 44, width: 130, height: 26 }}>
          <Svg width={130} height={26}>
            <Rect x={0} y={0} width={104} height={12} rx={6} fill="rgba(255,255,255,0.75)" />
            <Rect x={20} y={13} width={72} height={10} rx={5} fill="rgba(255,255,255,0.55)" />
          </Svg>
        </Drift>
      </SceneCanvas>
      {/* 추석 낙엽은 기본 낙엽보다 작고 6개만(웹과 동일) */}
      <MapleLayer style={{ top: 36, left: 0, right: 0, bottom: 0 }} count={6} size={0.86} />
    </>
  );
}

export function XmasScene(p: SceneProps) {
  const sleigh = useLinearLoop(13_000);
  const sleighSt = useAnimatedStyle(() => {
    const t = sleigh.value;
    // 웹 cdSleigh 는 (-170,64) → (120,-4) → (450,-78) 로 카드 위로 빠져나간다.
    // 모바일 카드는 세로가 짧아 그러면 좌상단에 잠깐 스칠 뿐이라, 상승 폭을 줄여
    // 화면을 가로지르는 동안 계속 보이게 한다(끝에서만 살짝 올라간다).
    const x = t < 0.5 ? -170 + (120 - -170) * (t / 0.5) : 120 + (450 - 120) * ((t - 0.5) / 0.5);
    const y = t < 0.5 ? 78 + (30 - 78) * (t / 0.5) : 30 + (-6 - 30) * ((t - 0.5) / 0.5);
    return {
      transform: [{ translateX: x }, { translateY: y }],
      opacity: t < 0.08 ? t / 0.08 : t > 0.92 ? (1 - t) / 0.08 : 1,
    };
  });

  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={SCENE_H}>
        <Path d="M0 224 Q110 212 220 220 T400 216 L400 286 L0 286 Z" fill="rgba(248,250,255,0.95)" />
      </SceneBand>
      <SceneCanvas {...p}>
        {/* 산타 썰매 — 하늘을 나는 오브젝트라 **트리·눈사람 등 지상 전경보다 먼저** 그린다. */}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 16, left: 0, width: 150, height: 48 }, sleighSt]}>
          <Svg width={150} height={48} viewBox="0 0 150 48">
            <Path d="M4 40 q-3 6 5 8 h32" stroke="#E8C05A" strokeWidth={2.5} fill="none" strokeLinecap="round" />
            <Path d="M10 22 q-9 10 3 17 h28 q11 0 12 -11 l-1 -9 h-26 q-10 0 -16 3 z" fill="#B8402F" />
            <Circle cx={18} cy={18} r={8} fill="#8A6240" />
            <Circle cx={36} cy={12} r={5} fill="#F7D9C4" />
            <Polygon points="30,10 36,0 42,10" fill="#D84B3F" />
            <Circle cx={42} cy={1.5} r={2} fill="#FFFFFF" />
            <Rect x={30} y={10} width={12} height={3} rx={1.5} fill="#FFFFFF" />
            <Rect x={29} y={15} width={15} height={11} rx={4} fill="#D84B3F" />
            <Path d="M54 26 L88 24 L120 22" stroke="#6E4E3A" strokeWidth={1.5} fill="none" />
            <Ellipse cx={94} cy={30} rx={12} ry={6.5} fill="#8A6240" />
            <Path d="M88 36 v8 M100 36 v8" stroke="#6E4E3A" strokeWidth={2.4} strokeLinecap="round" />
            <Circle cx={106} cy={21} r={4.5} fill="#8A6240" />
            <Path d="M106 17 q-2 -6 -7 -8 M107 17 q3 -6 8 -7" stroke="#6E4E3A" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            <Ellipse cx={124} cy={28} rx={12} ry={6.5} fill="#96714E" />
            <Path d="M118 34 v8 M130 34 v8" stroke="#6E4E3A" strokeWidth={2.4} strokeLinecap="round" />
            <Circle cx={136} cy={19} r={4.5} fill="#96714E" />
            <Path d="M136 15 q-2 -6 -7 -8 M137 15 q3 -6 8 -7" stroke="#6E4E3A" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            <Twinkle cx={140} cy={20} r={2} fill="#E8433A" duration={1200} />
          </Svg>
        </Animated.View>
        <Svg style={{ position: "absolute", left: 0, top: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          <Ellipse cx={104} cy={224} rx={60} ry={7} fill="rgba(190,200,225,0.4)" />
          <Rect x={96} y={208} width={15} height={18} rx={3} fill="#8A6240" />
          <Polygon points="104,140 164,210 44,210" fill="#2E7052" />
          <Polygon points="104,122 152,182 56,182" fill="#357F5F" />
          <Polygon points="104,106 142,156 66,156" fill="#3E8F6C" />
          <Polygon points="104,94 130,136 78,136" fill="#47A078" />
          <Path d="M50 208 Q104 197 158 208" stroke="#F4F8FF" strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.85} />
          <Path d="M62 180 Q104 171 146 180" stroke="#F4F8FF" strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.85} />
          <Path d="M72 154 Q104 147 136 154" stroke="#F4F8FF" strokeWidth={3.5} fill="none" strokeLinecap="round" opacity={0.85} />
          <Path d="M66 194 Q104 208 142 194" stroke="#E8C05A" strokeWidth={3} fill="none" />
          <Path d="M77 166 Q104 177 131 166" stroke="#E8C05A" strokeWidth={2.5} fill="none" />
          <Twinkle cx={82} cy={192} r={4.4} fill="#E85D5D" duration={1800} />
          <Twinkle cx={130} cy={190} r={4.4} fill="#5FB6E8" duration={2200} delay={500} />
          <Twinkle cx={90} cy={160} r={4} fill="#F2C14E" duration={2000} delay={1000} />
          <Twinkle cx={122} cy={158} r={4} fill="#E85D5D" duration={2400} delay={300} />
          <Twinkle cx={104} cy={130} r={3.8} fill="#5FB6E8" duration={2100} delay={900} />
          <Polygon points="104,66 107.5,76 117,76 109.5,82 112.5,92 104,86 95.5,92 98.5,82 90,76 100.5,76" fill="#F2C14E" />
          <Rect x={40} y={208} width={28} height={20} rx={3} fill="#D84B3F" />
          <Rect x={51} y={208} width={6} height={20} fill="#F2C14E" />
          <Rect x={150} y={212} width={24} height={16} rx={3} fill="#5468C9" />
          <Rect x={159} y={212} width={6} height={16} fill="#FFFFFF" />
          <Rect x={72} y={216} width={17} height={12} rx={3} fill="#3BAF8E" />
        </Svg>
        {/* 눈사람 */}
        <Sway deg={6} duration={3800} style={{ top: 150, right: 56, width: 64, height: 80 }}>
          <Svg width={64} height={80} viewBox="0 0 64 80">
            <Ellipse cx={32} cy={76} rx={24} ry={4} fill="rgba(190,200,225,0.45)" />
            <Circle cx={32} cy={56} r={20} fill="#FFFFFF" stroke="#DCE3F0" strokeWidth={1.5} />
            <Circle cx={32} cy={26} r={14} fill="#FFFFFF" stroke="#DCE3F0" strokeWidth={1.5} />
            <Rect x={22} y={6} width={20} height={10} rx={1.5} fill="#2A3040" />
            <Rect x={18} y={14} width={28} height={4} rx={2} fill="#2A3040" />
            <Circle cx={27} cy={24} r={1.6} fill="#2A3040" />
            <Circle cx={37} cy={24} r={1.6} fill="#2A3040" />
            <Polygon points="32,26 46,28 32,30" fill="#E8813E" />
            <Rect x={23} y={37} width={18} height={6} rx={3} fill="#D84B3F" />
            <Rect x={33} y={40} width={6} height={14} rx={3} fill="#D84B3F" />
            <Path d="M12 50 L0 40 M52 50 L64 38" stroke="#8A6240" strokeWidth={3} strokeLinecap="round" />
            <Circle cx={32} cy={50} r={1.9} fill="#2A3040" />
            <Circle cx={32} cy={58} r={1.9} fill="#2A3040" />
          </Svg>
        </Sway>
      </SceneCanvas>
      <SnowLayer tall style={{ top: 8, left: 0, right: 0, bottom: 0 }} />
    </>
  );
}
