const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// expo-sqlite 는 웹에서 wa-sqlite(wasm)로 동작한다 — 웹 번들(디자인 미리보기용)에서만 필요하지만
// assetExts 에 넣어두지 않으면 번들러가 .wasm 을 모듈로 해석하려다 실패한다. 네이티브에는 영향 없음.
config.resolver.assetExts.push("wasm");

module.exports = withNativeWind(config, { input: "./src/global.css" });
