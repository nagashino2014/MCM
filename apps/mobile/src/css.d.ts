// CSS side-effect import 타입 선언 (NativeWind global.css, *.module.css).
// 실제 처리는 metro(withNativeWind)가 담당하고, tsc 는 타입만 필요로 한다.
declare module '*.css';
