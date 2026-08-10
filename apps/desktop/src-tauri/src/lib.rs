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

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

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
            Ok(())
        })
        .on_window_event(|window, event| {
            // 닫기 = 트레이로 숨김. 실제 종료는 트레이 메뉴의 "종료"에서만.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MCM desktop widget");
}
