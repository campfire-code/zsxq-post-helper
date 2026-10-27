use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const INJECT: &str = include_str!("inject.js");
const WIN: &str = "zsxq";
const HOME: &str = "https://wx.zsxq.com/";

/// 打开（或带到前面）知识星球网页版窗口。窗口用应用自己的浏览器数据，不读取、不同步本机浏览器。
#[tauri::command]
fn open_zsxq(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(WIN) {
        w.show().map_err(|e| e.to_string())?;
        return w.set_focus().map_err(|e| e.to_string());
    }
    let url = HOME.parse().map_err(|e| format!("{e}"))?;
    WebviewWindowBuilder::new(&app, WIN, WebviewUrl::External(url))
        .title("知识星球（在这里扫码登录）")
        .inner_size(1180.0, 820.0)
        .initialization_script(INJECT)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 在知识星球窗口里调用注入脚本的函数。只接受 `window.__campfire.函数名(参数)` 这一种形式。
#[tauri::command]
fn run_in_zsxq(app: AppHandle, script: String) -> Result<(), String> {
    let s = script.trim();
    let rest = s
        .strip_prefix("window.__campfire.")
        .ok_or("只允许调用 window.__campfire 里的函数")?;
    let name_len = rest.chars().take_while(|c| c.is_ascii_alphabetic()).count();
    if name_len == 0 || !rest[name_len..].starts_with('(') || !rest.ends_with(')') {
        return Err("脚本格式不对".into());
    }
    let w = app.get_webview_window(WIN).ok_or("还没有打开知识星球窗口")?;
    w.eval(s).map_err(|e| e.to_string())
}

/// 清除该窗口里保存的登录状态（换账号用）。
#[tauri::command]
fn clear_zsxq_login(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(WIN) {
        w.clear_all_browsing_data().map_err(|e| e.to_string())?;
        return w.close().map_err(|e| e.to_string());
    }
    // 窗口没开时先开一个看不见的再清
    let url = "about:blank".parse().map_err(|e| format!("{e}"))?;
    let w = WebviewWindowBuilder::new(&app, "zsxq-clear", WebviewUrl::External(url))
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    w.clear_all_browsing_data().map_err(|e| e.to_string())?;
    w.close().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_zsxq, run_in_zsxq, clear_zsxq_login])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
