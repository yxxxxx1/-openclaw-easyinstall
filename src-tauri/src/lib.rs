use serde::{Deserialize, Serialize};
use std::{
    fs,
    collections::HashSet,
    io::ErrorKind,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use sysinfo::Disks;
use sysinfo::{ProcessesToUpdate, System};
use tauri::Emitter;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AiSettings {
    provider: String,
    api_key: String,
    model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppState {
    install_path: Option<String>,
    ai_settings: Option<AiSettings>,
    auto_start: Option<bool>,
    auto_update: Option<bool>,
}

#[derive(Clone, Default)]
struct TaskControl {
    install_cancelled: Arc<AtomicBool>,
    uninstall_cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskProgressPayload {
    task: String,
    progress: u8,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskDonePayload {
    task: String,
    success: bool,
    code: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UninstallPreview {
    install_path: String,
    app_state_file: String,
    remove_install_files: Vec<String>,
    remove_if_delete_data: Vec<String>,
}

fn state_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;

    fs::create_dir_all(&base).map_err(|e| format!("创建应用数据目录失败: {e}"))?;

    Ok(base.join("state.json"))
}

fn read_state(app: &tauri::AppHandle) -> Result<AppState, String> {
    let file = state_file(app)?;
    if !file.exists() {
        return Ok(AppState::default());
    }

    let content = fs::read_to_string(&file).map_err(|e| format!("读取状态文件失败: {e}"))?;
    serde_json::from_str::<AppState>(&content).map_err(|e| format!("解析状态文件失败: {e}"))
}

fn write_state(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let file = state_file(app)?;
    let content =
        serde_json::to_string_pretty(state).map_err(|e| format!("序列化状态失败: {e}"))?;
    fs::write(file, content).map_err(|e| format!("写入状态文件失败: {e}"))
}

fn detect_disk_available(path: &PathBuf) -> Option<u64> {
    let disks = Disks::new_with_refreshed_list();
    let mut best_match: Option<(usize, u64)> = None;

    for disk in &disks {
        let mount = disk.mount_point();
        if path.starts_with(mount) {
            let len = mount.as_os_str().len();
            let available = disk.available_space();
            match best_match {
                Some((best_len, _)) if best_len >= len => {}
                _ => best_match = Some((len, available)),
            }
        }
    }

    best_match.map(|(_, available)| available)
}

fn classify_install_error(error: &str) -> String {
    if error.contains("权限") || error.contains("permission") || error.contains("拒绝访问") {
        return "E_AUTH_003".to_string();
    }
    if error.contains("空间") || error.contains("disk") || error.contains("存储") {
        return "E_DISK_002".to_string();
    }
    if error.contains("网络") || error.contains("连接") || error.contains("timeout") {
        return "E_NET_101".to_string();
    }
    "E_INST_301".to_string()
}

fn classify_uninstall_error(error: &str) -> String {
    if error.contains("占用") || error.contains("运行") || error.contains("PermissionDenied") {
        return "E_OCC_501".to_string();
    }
    if error.contains("权限") || error.contains("拒绝访问") {
        return "E_AUTH_003".to_string();
    }
    "E_ROLL_401".to_string()
}

fn validate_install_environment(path: &PathBuf) -> Result<(), String> {
    if let Some(available) = detect_disk_available(path) {
        let required_bytes: u64 = 220 * 1024 * 1024;
        if available < required_bytes {
            return Err("磁盘空间不足，请至少预留 220 MB 后重试".to_string());
        }
    }

    Ok(())
}

fn detect_uninstall_blockers(install_path: &str) -> Vec<String> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let lower_path = install_path.to_lowercase();
    let mut blockers = HashSet::new();

    for (pid, process) in system.processes() {
        let process_name = process.name().to_string_lossy().to_string();
        if let Some(exe) = process.exe() {
            let exe_text = exe.to_string_lossy().to_lowercase();
            if exe_text.starts_with(&lower_path) {
                blockers.insert(format!("{} (PID {})", process_name, pid));
            }
        }
    }

    let mut sorted: Vec<String> = blockers.into_iter().collect();
    sorted.sort();
    sorted
}

fn explain_ai_status(provider: &str, status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        400 => format!("{provider} 请求参数不正确，请检查模型名称"),
        401 => format!("{provider} 认证失败，请检查 API Key"),
        403 => format!("{provider} 无访问权限，请检查账号权限"),
        404 => format!("{provider} 模型不存在或接口地址错误"),
        408 => format!("{provider} 请求超时，请稍后重试"),
        429 => format!("{provider} 请求过于频繁或额度不足"),
        500..=599 => format!("{provider} 服务暂时不可用，请稍后重试"),
        _ => format!("{provider} 连接失败，状态码 {}", status),
    }
}

#[tauri::command]
fn pick_install_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择 OpenClaw 安装位置")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn run_install(app: tauri::AppHandle, install_path: String) -> Result<(), String> {
    let path = PathBuf::from(&install_path);

    validate_install_environment(&path)?;

    fs::create_dir_all(&path).map_err(|e| {
        if e.kind() == ErrorKind::PermissionDenied {
            format!("权限不足，请以管理员身份运行安装器: {e}")
        } else {
            format!("创建安装目录失败: {e}")
        }
    })?;

    let marker = path.join("openclaw.installed");
    fs::write(marker, "installed=true\n").map_err(|e| format!("写入安装标记失败: {e}"))?;

    let mut state = read_state(&app)?;
    state.install_path = Some(install_path);
    write_state(&app, &state)
}

fn emit_progress(
    app: &tauri::AppHandle,
    task: &str,
    progress: u8,
    message: &str,
) -> Result<(), String> {
    app.emit(
        "task-progress",
        TaskProgressPayload {
            task: task.to_string(),
            progress,
            message: message.to_string(),
        },
    )
    .map_err(|e| format!("发送进度事件失败: {e}"))
}

fn emit_done(
    app: &tauri::AppHandle,
    task: &str,
    success: bool,
    code: Option<&str>,
    message: &str,
) -> Result<(), String> {
    app.emit(
        "task-done",
        TaskDonePayload {
            task: task.to_string(),
            success,
            code: code.map(|value| value.to_string()),
            message: message.to_string(),
        },
    )
    .map_err(|e| format!("发送完成事件失败: {e}"))
}

#[tauri::command]
fn start_install_task(
    app: tauri::AppHandle,
    control: tauri::State<TaskControl>,
    install_path: String,
) -> Result<(), String> {
    control.install_cancelled.store(false, Ordering::Relaxed);
    let install_cancelled = control.install_cancelled.clone();
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        let _ = emit_progress(&app_handle, "install", 4, "正在检测网络环境");
        let probe_result: Result<(), String> = match reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .build()
        {
            Ok(client) => match client.get("https://docs.openclaw.ai").send().await {
                Ok(_) => Ok(()),
                Err(e) => Err(format!("网络检测失败，请检查网络后重试: {e}")),
            },
            Err(e) => Err(format!("创建网络检测客户端失败: {e}")),
        };

        if let Err(error) = probe_result {
            let _ = emit_done(&app_handle, "install", false, Some("E_NET_101"), &error);
            return;
        }

        let steps: Vec<(u8, &str)> = vec![
            (8, "正在准备安装环境"),
            (22, "正在创建安装目录"),
            (45, "正在部署核心文件"),
            (68, "正在初始化组件"),
            (88, "正在写入配置"),
            (100, "安装完成"),
        ];

        for (progress, message) in &steps {
            if install_cancelled.load(Ordering::Relaxed) {
                let _ = emit_done(&app_handle, "install", false, Some("E_TASK_000"), "安装已取消");
                return;
            }

            let _ = emit_progress(&app_handle, "install", *progress, message);
            std::thread::sleep(Duration::from_millis(500));
        }

        let result = run_install(app_handle.clone(), install_path);
        match result {
            Ok(_) => {
                let _ = emit_done(&app_handle, "install", true, None, "安装任务已完成");
            }
            Err(error) => {
                let code = classify_install_error(&error);
                let _ = emit_done(&app_handle, "install", false, Some(&code), &error);
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn run_uninstall(
    app: tauri::AppHandle,
    install_path: String,
    delete_data: bool,
) -> Result<(), String> {
    let blockers = detect_uninstall_blockers(&install_path);
    if !blockers.is_empty() {
        return Err(format!(
            "检测到以下进程正在占用安装目录，请先关闭后重试: {}",
            blockers.join("、")
        ));
    }

    let path = PathBuf::from(&install_path);
    let marker = path.join("openclaw.installed");

    if marker.exists() {
        fs::remove_file(&marker).map_err(|e| format!("删除安装标记失败: {e}"))?;
    }

    if path.exists() {
        let is_openclaw_dir = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.eq_ignore_ascii_case("openclaw"))
            .unwrap_or(false);

        if is_openclaw_dir {
            fs::remove_dir_all(&path).map_err(|e| format!("删除安装目录失败: {e}"))?;
        }
    }

    let mut state = read_state(&app)?;
    state.install_path = None;

    if delete_data {
        let file = state_file(&app)?;
        if file.exists() {
            fs::remove_file(file).map_err(|e| format!("清理应用数据失败: {e}"))?;
        }
        return Ok(());
    }

    write_state(&app, &state)
}

#[tauri::command]
fn start_uninstall_task(
    app: tauri::AppHandle,
    control: tauri::State<TaskControl>,
    install_path: String,
    delete_data: bool,
) -> Result<(), String> {
    control.uninstall_cancelled.store(false, Ordering::Relaxed);
    let uninstall_cancelled = control.uninstall_cancelled.clone();
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        let steps: Vec<(u8, &str)> = vec![
            (15, "正在停止相关服务"),
            (35, "正在移除程序组件"),
            (60, "正在清理安装目录"),
            (82, "正在更新本地状态"),
            (100, "卸载完成"),
        ];

        for (progress, message) in &steps {
            if uninstall_cancelled.load(Ordering::Relaxed) {
                let _ = emit_done(&app_handle, "uninstall", false, Some("E_TASK_000"), "卸载已取消");
                return;
            }

            let _ = emit_progress(&app_handle, "uninstall", *progress, message);
            std::thread::sleep(Duration::from_millis(450));
        }

        let result = run_uninstall(app_handle.clone(), install_path, delete_data);
        match result {
            Ok(_) => {
                let _ = emit_done(&app_handle, "uninstall", true, None, "卸载任务已完成");
            }
            Err(error) => {
                let code = classify_uninstall_error(&error);
                let _ = emit_done(&app_handle, "uninstall", false, Some(&code), &error);
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn cancel_task(control: tauri::State<TaskControl>, task: String) -> Result<(), String> {
    match task.as_str() {
        "install" => {
            control.install_cancelled.store(true, Ordering::Relaxed);
            Ok(())
        }
        "uninstall" => {
            control.uninstall_cancelled.store(true, Ordering::Relaxed);
            Ok(())
        }
        _ => Err("未知任务类型".to_string()),
    }
}

#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<AppState, String> {
    read_state(&app)
}

#[tauri::command]
fn save_ai_settings(app: tauri::AppHandle, settings: AiSettings) -> Result<(), String> {
    let mut state = read_state(&app)?;
    state.ai_settings = Some(settings);
    write_state(&app, &state)
}

#[tauri::command]
fn save_preferences(
    app: tauri::AppHandle,
    auto_start: bool,
    auto_update: bool,
) -> Result<(), String> {
    let mut state = read_state(&app)?;
    state.auto_start = Some(auto_start);
    state.auto_update = Some(auto_update);
    write_state(&app, &state)
}

#[tauri::command]
fn get_uninstall_blockers(install_path: String) -> Vec<String> {
    detect_uninstall_blockers(&install_path)
}

#[tauri::command]
fn get_uninstall_preview(app: tauri::AppHandle, install_path: String) -> Result<UninstallPreview, String> {
    let state_path = state_file(&app)?;
    Ok(UninstallPreview {
        install_path: install_path.clone(),
        app_state_file: state_path.to_string_lossy().to_string(),
        remove_install_files: vec![
            format!("{}\\openclaw.installed", install_path),
            install_path,
        ],
        remove_if_delete_data: vec![state_path.to_string_lossy().to_string()],
    })
}

#[tauri::command]
async fn test_ai_connection(provider: String, api_key: String, model: String) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API Key 不能为空".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("创建网络请求失败: {e}"))?;

    match provider.as_str() {
        "Kimi" => {
            let resp = client
                .post("https://api.moonshot.cn/v1/chat/completions")
                .bearer_auth(key)
                .json(&serde_json::json!({
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 8,
                }))
                .send()
                .await
                .map_err(|e| format!("网络请求失败: {e}"))?;
            if resp.status().is_success() {
                return Ok("连接成功".to_string());
            }
            return Err(explain_ai_status("Kimi", resp.status()));
        }
        "DeepSeek" => {
            let resp = client
                .post("https://api.deepseek.com/chat/completions")
                .bearer_auth(key)
                .json(&serde_json::json!({
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 8,
                }))
                .send()
                .await
                .map_err(|e| format!("网络请求失败: {e}"))?;
            if resp.status().is_success() {
                return Ok("连接成功".to_string());
            }
            return Err(explain_ai_status("DeepSeek", resp.status()));
        }
        "Moonshot" => {
            let resp = client
                .post("https://api.moonshot.cn/v1/chat/completions")
                .bearer_auth(key)
                .json(&serde_json::json!({
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 8,
                }))
                .send()
                .await
                .map_err(|e| format!("网络请求失败: {e}"))?;
            if resp.status().is_success() {
                return Ok("连接成功".to_string());
            }
            return Err(explain_ai_status("Moonshot", resp.status()));
        }
        "Qwen" => {
            let resp = client
                .post("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")
                .bearer_auth(key)
                .json(&serde_json::json!({
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 8,
                }))
                .send()
                .await
                .map_err(|e| format!("网络请求失败: {e}"))?;
            if resp.status().is_success() {
                return Ok("连接成功".to_string());
            }
            return Err(explain_ai_status("Qwen", resp.status()));
        }
        "GLM" => {
            let resp = client
                .post("https://open.bigmodel.cn/api/paas/v4/chat/completions")
                .bearer_auth(key)
                .json(&serde_json::json!({
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 8,
                }))
                .send()
                .await
                .map_err(|e| format!("网络请求失败: {e}"))?;
            if resp.status().is_success() {
                return Ok("连接成功".to_string());
            }
            return Err(explain_ai_status("GLM", resp.status()));
        }
        "OpenAI" => {
            let resp = client
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(key)
                .json(&serde_json::json!({
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 8,
                }))
                .send()
                .await
                .map_err(|e| format!("网络请求失败: {e}"))?;
            if resp.status().is_success() {
                return Ok("连接成功".to_string());
            }
            return Err(explain_ai_status("OpenAI", resp.status()));
        }
        "Anthropic" => {
            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
                .json(&serde_json::json!({
                    "model": model,
                    "max_tokens": 8,
                    "messages": [{"role": "user", "content": "ping"}],
                }))
                .send()
                .await
                .map_err(|e| format!("网络请求失败: {e}"))?;
            if resp.status().is_success() {
                return Ok("连接成功".to_string());
            }
            return Err(explain_ai_status("Anthropic", resp.status()));
        }
        _ => Err("当前平台暂不支持自动测试，请直接保存后在聊天页验证".to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TaskControl::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_install_directory,
            run_install,
            start_install_task,
            run_uninstall,
            start_uninstall_task,
            cancel_task,
            load_state,
            save_ai_settings,
            save_preferences,
            test_ai_connection,
            get_uninstall_preview,
            get_uninstall_blockers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
