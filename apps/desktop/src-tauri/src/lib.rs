//! MCM 데스크탑 위젯 셸(WID-P0 · P1).
//!
//! 화면은 이 크레이트에 없다 — 창이 `https://koensain.app/m-app`(모바일 앱의 Expo 웹 빌드)을
//! 그대로 로드한다(tauri.conf.json `app.windows[].url`). 따라서 앱 기능 업데이트는 next 배포로
//! 끝나고, 이 셸을 다시 배포하는 경우는 아래 네이티브 기능이 바뀔 때뿐이다.
//!
//! 셸이 담당하는 것:
//!   - 트레이 상주(아이콘 클릭 = 창 토글, 우클릭 = 열기·종료 메뉴)
//!   - 닫기(X) = 종료가 아니라 트레이로 숨김 — 메신저는 계속 떠 있어야 알림을 받는다
//!   - 중복 실행 차단(single-instance) — 시작 메뉴에서 다시 눌러도 새 창이 아니라 있던 창을 띄운다
//!   - 미읽음 뱃지(트레이 아이콘 점 · 작업표시줄 카운트)와 OS 알림 — 웹앱이 postMessage 로 알려준다
//!   - 창 위치·크기 기억(window-state), 부팅 시 자동 시작(autostart)
//!   - 대화 팝업 창(chat-<roomId>) — 웹앱의 mcm:open-chat 을 받아 상단 바(index.html)가 연다. 닫으면 실제로 닫힌다

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// 처음 실행할 때 주 창이 차지할 수 있는 화면 높이의 비율(2026-11-06 사용자 결정).
const FIRST_RUN_MAX_HEIGHT_RATIO: f64 = 0.85;

/// 주 창 크기를 화면에 맞춘다.
///
/// 초기 크기(1040×1060, 2026-11-06)는 홈 2열에서 "결재 대기" 카드까지 한 화면에 보이도록 잡은 값이다. 큰 화면에서는
/// 그대로 열리지만 FHD 에서는 세로를 가득 채운다(작업 영역 높이: 배율 100% 약 1032, 125% 약 816). 그래서
///   - **처음 실행**(저장된 창 상태가 없을 때): 높이를 작업 영역의 85% 까지로 제한한다 — 아래는 스크롤로 본다.
///   - **그 뒤**: 사용자가 정한 크기(window-state 복원값)를 존중하고, 작업 영역보다 클 때만 그 안으로 줄인다
///     (더 작은 모니터로 옮겨 온 경우).
/// 줄였으면 작업 영역 가운데에 다시 놓는다. 폭은 작업 영역을 넘을 때만 줄인다(1040 이 2열 배치의 기준 폭).
fn fit_main_window_to_monitor(app: &tauri::AppHandle, first_run: bool) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(Some(monitor)), Ok(size)) = (win.current_monitor(), win.outer_size()) else {
        return;
    };
    let area = monitor.work_area();
    let (max_w, area_h) = (area.size.width, area.size.height);
    let max_h = if first_run {
        (f64::from(area_h) * FIRST_RUN_MAX_HEIGHT_RATIO).round() as u32
    } else {
        area_h
    };
    if size.width <= max_w && size.height <= max_h {
        return;
    }
    let (w, h) = (size.width.min(max_w), size.height.min(max_h));
    // set_size 는 안쪽 크기 기준이다 — 바깥 크기(보이지 않는 테두리 포함)가 w×h 가 되도록 테두리 몫을 뺀다.
    let frame = win
        .inner_size()
        .map(|inner| (size.width.saturating_sub(inner.width), size.height.saturating_sub(inner.height)))
        .unwrap_or((0, 0));
    let _ = win.set_size(tauri::PhysicalSize::new(w.saturating_sub(frame.0), h.saturating_sub(frame.1)));
    let x = area.position.x + ((max_w - w) / 2) as i32;
    let y = area.position.y + ((area_h - h) / 2) as i32;
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

/// 저장된 창 상태(window-state 플러그인의 파일)가 아직 없는가 — 설치 후 첫 실행.
/// 파일은 종료·닫기 때 만들어지므로 첫 실행의 setup 시점에는 없다. 경로를 못 구하면 첫 실행이 아닌 것으로 본다(크기를 건드리지 않는 쪽).
fn is_first_run(app: &tauri::AppHandle) -> bool {
    app.path()
        .app_config_dir()
        .map(|dir| !dir.join(tauri_plugin_window_state::DEFAULT_FILENAME).exists())
        .unwrap_or(false)
}

/// 앱 화면의 최대 폭(apps/mobile `WEB_SHELL_MAX_WIDTH`) — tauri.conf.json 의 초기 폭과 같다. 창이 이보다 넓으면 좌우에 배경 띠가 남는다.
const APP_SHELL_WIDTH: f64 = 1040.0;
/// 저장된 폭을 맞췄다는 표시 파일. 있으면 다시 맞추지 않는다.
const WIDTH_FIT_MARKER: &str = ".window-width-fit-1040";

/// 이전 버전이 저장해 둔 넓은 창 폭을 앱 화면 폭으로 한 번만 줄인다(2026-11-06 사용자 요청).
/// window-state 복원값이 초기 폭을 덮어써, 업데이트해도 좌우 배경 띠가 남기 때문이다.
/// 그 뒤에 사용자가 넓힌 폭은 존중한다(대화 탭은 더 넓게 쓸 수 있다). 높이·위치는 그대로 둔다.
fn fit_saved_width_once(app: &tauri::AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let marker = dir.join(WIDTH_FIT_MARKER);
    if marker.exists() {
        return;
    }
    if let Some(win) = app.get_webview_window("main") {
        if !win.is_maximized().unwrap_or(false) {
            if let (Ok(scale), Ok(inner)) = (win.scale_factor(), win.inner_size()) {
                let width = (APP_SHELL_WIDTH * scale).round() as u32;
                if inner.width > width {
                    let _ = win.set_size(tauri::PhysicalSize::new(width, inner.height));
                }
            }
        }
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(marker, b"");
}

/// 트레이 기본 아이콘 원본 — 뱃지 버전은 이 픽셀을 복사해 런타임에 그린다(에셋 추가 없이).
const TRAY_PNG: &[u8] = include_bytes!("../icons/32x32.png");

/// 메인 창을 보이거나(포커스) 숨긴다 — 트레이 토글용.
fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
    } else {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 트레이 아이콘 이미지. `unread` 면 우하단에 빨간 점(흰 테두리)을 덧그린다.
fn tray_image(unread: bool) -> Option<Image<'static>> {
    let img = Image::from_bytes(TRAY_PNG).ok()?;
    let (w, h) = (img.width(), img.height());
    let mut rgba = img.rgba().to_vec();
    if !unread {
        return Some(Image::new_owned(rgba, w, h));
    }

    // 우하단 1/3 지점을 중심으로 한 원. 바깥 반지름은 흰 테두리, 안쪽은 빨강.
    let cx = w as f32 - w as f32 * 0.29;
    let cy = h as f32 - h as f32 * 0.29;
    let outer = w as f32 * 0.30;
    let inner = outer - (w as f32 * 0.06).max(1.0);
    for y in 0..h {
        for x in 0..w {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let d = (dx * dx + dy * dy).sqrt();
            if d > outer {
                continue;
            }
            let i = ((y * w + x) * 4) as usize;
            let px: [u8; 4] = if d > inner {
                [255, 255, 255, 255]
            } else {
                [226, 87, 76, 255] // 상단 바 닫기 버튼과 같은 빨강
            };
            rgba[i..i + 4].copy_from_slice(&px);
        }
    }
    Some(Image::new_owned(rgba, w, h))
}

/// 안 읽은 메시지 수 반영 — 트레이 아이콘·툴팁 + 작업표시줄 뱃지.
/// 웹앱(iframe)이 폴링으로 알아낸 값을 상단 바(index.html)가 중계해 호출한다.
#[tauri::command]
fn set_unread(app: tauri::AppHandle, count: u32) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_icon(tray_image(count > 0));
        let _ = tray.set_tooltip(Some(if count > 0 {
            format!("MCM — 안 읽은 메시지 {count}건")
        } else {
            "MCM".to_string()
        }));
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_badge_count(if count > 0 { Some(count as i64) } else { None });
    }
}

/// 알림을 눌렀을 때처럼 창을 앞으로 — 상단 바에서 호출한다.
#[tauri::command]
fn focus_window(app: tauri::AppHandle) {
    show_main_window(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance 는 반드시 첫 플러그인. 두 번째 실행은 즉시 종료되고
        // 아래 콜백이 원래 인스턴스에서 실행돼 창을 띄운다(트레이에 숨어 있어도 복귀).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![set_unread, focus_window])
        .setup(|app| {
            // "항상 위 고정"은 창 상단 바의 토글 스위치가 담당한다(index.html) —
            // 두 곳에 두면 체크 상태가 갈라지므로 트레이 메뉴는 열기·종료만 둔다.
            let open_item = MenuItem::with_id(app, "open", "MCM 열기", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &sep, &quit_item])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("MCM")
                // 좌클릭은 메뉴 대신 창 토글로 쓴다(메신저 위젯 관례).
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            let first_run = is_first_run(app.handle());
            fit_saved_width_once(app.handle());
            fit_main_window_to_monitor(app.handle(), first_run);
            Ok(())
        })
        .on_window_event(|window, event| {
            // 주 창의 닫기 = 트레이로 숨김. 실제 종료는 트레이 메뉴의 "종료"에서만.
            // 대화 팝업 창(chat-<roomId>, 2026-11-06)은 그대로 닫힌다 — 주 창이 남아 있어 앱은 계속 돈다.
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MCM desktop widget");
}
