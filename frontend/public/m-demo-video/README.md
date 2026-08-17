# 데모 시연 영상

`/m-demo.html`(회의 시연용 웹 데모)의 "명함 촬영"·"영수증 촬영" 탭에서 재생되는 영상.
앱에서 웹으로 재현할 수 없는 **카메라 촬영 기능**을 실기기 화면 녹화로 대신 보여준다.

| 파일 | 탭 |
|---|---|
| `namecard.mp4` | 명함 촬영 |
| `receipt.mp4` | 영수증 촬영 |

## 규격
- **H.264 mp4**(iPhone 화면 기록 원본은 HEVC `.mov`라 크롬에서 재생 안 될 수 있음 → 변환 필수)
- 세로 9:19.5 (iPhone 12 Pro Max 화면 녹화 원본 1284×2778 그대로면 목업 화면 비율과 일치)
- 폭 780px 정도로 축소, `-movflags +faststart`, 오디오 제거(`-an`)

```
ffmpeg -i namecard.mov -c:v libx264 -crf 23 -preset slow -vf "scale=780:-2" -an -movflags +faststart namecard.mp4
```
