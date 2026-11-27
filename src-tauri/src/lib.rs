mod pptx_fallback;

use pptx_fallback::ExtractedSlide;
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::net::{Ipv4Addr, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};

struct PendingOpenFile(Mutex<Option<String>>);

struct ShareServerHandle {
    stop_flag: Arc<AtomicBool>,
    join_handle: Option<std::thread::JoinHandle<()>>,
}

impl ShareServerHandle {
    fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

struct LocalShareServer(Mutex<Option<ShareServerHandle>>);

#[derive(serde::Serialize)]
struct LocalShareInfo {
    url: String,
    ip: String,
    port: u16,
}

fn is_supported_open_extension(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()) {
        Some(ext) => matches!(
            ext.as_str(),
            "cboard" | "pdf" | "pptx" | "ppt" | "png" | "jpg" | "jpeg" | "webp"
        ),
        None => false,
    }
}

fn extract_supported_file_arg(args: &[String]) -> Option<String> {
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let p = Path::new(arg);
        if p.exists() && is_supported_open_extension(p) {
            return Some(arg.clone());
        }
    }
    None
}

#[tauri::command]
fn take_startup_file_path(state: tauri::State<'_, PendingOpenFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut guard| guard.take())
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn new_hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Read any user-selected file into raw bytes for PDF.js / image import.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Could not read file '{}': {}", path, e))
}

/// Write raw bytes (e.g., exported PDF) to a user-selected destination path.
#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, &bytes).map_err(|e| format!("Could not write file '{}': {}", path, e))
}

/// Convert .pptx / .ppt to a temporary PDF via LibreOffice or PowerPoint COM (Windows),
/// returning the resulting PDF bytes directly to the frontend for instant PDF.js rendering.
#[tauri::command]
fn convert_ppt_to_pdf(input_path: String) -> Result<Vec<u8>, String> {
    let src = Path::new(&input_path);
    if !src.exists() {
        return Err("Presentation file not found.".to_string());
    }

    let temp_dir = std::env::temp_dir().join("captnz_board_ppt_cache");
    let _ = fs::create_dir_all(&temp_dir);

    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("presentation");
    let out_pdf = temp_dir.join(format!("{}.pdf", stem));
    let _ = fs::remove_file(&out_pdf);

    // 1. Try LibreOffice CLI (soffice)
    if let Some(soffice) = find_libreoffice() {
        let status = new_hidden_command(&soffice)
            .args([
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                temp_dir.to_str().unwrap_or("."),
                &input_path,
            ])
            .status();

        if let Ok(st) = status {
            if st.success() && out_pdf.exists() {
                let bytes = fs::read(&out_pdf)
                    .map_err(|e| format!("Converted PDF read error: {}", e))?;
                let _ = fs::remove_file(&out_pdf);
                return Ok(bytes);
            }
        }
    }

    // 2. On Windows, try Microsoft PowerPoint COM automation via PowerShell
    #[cfg(target_os = "windows")]
    {
        let escaped_in = input_path.replace('\'', "''");
        let escaped_out = out_pdf.to_string_lossy().replace('\'', "''");
        let ps_script = format!(
            "$ppt = New-Object -ComObject PowerPoint.Application; \
             try {{ \
               $pres = $ppt.Presentations.Open('{in_p}', $true, $false, $false); \
               $pres.SaveAs('{out_p}', 32); \
               $pres.Close(); \
             }} finally {{ \
               $ppt.Quit(); \
             }}",
            in_p = escaped_in,
            out_p = escaped_out
        );

        let status = new_hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &ps_script])
            .status();

        if let Ok(st) = status {
            if st.success() && out_pdf.exists() {
                let bytes = fs::read(&out_pdf)
                    .map_err(|e| format!("PowerPoint PDF read error: {}", e))?;
                let _ = fs::remove_file(&out_pdf);
                return Ok(bytes);
            }
        }
    }

    Err("NO_CONVERTER".to_string())
}

/// Fallback: extract .pptx slide text & embedded images in pure Rust when LibreOffice/PowerPoint aren't installed.
#[tauri::command]
fn extract_pptx_fallback(input_path: String) -> Result<Vec<ExtractedSlide>, String> {
    pptx_fallback::extract_slides(&input_path)
}

fn find_libreoffice() -> Option<PathBuf> {
    let candidates: Vec<&str> = if cfg!(target_os = "windows") {
        vec![
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
            "soffice.exe",
            "soffice",
        ]
    } else {
        vec!["soffice", "libreoffice", "/usr/bin/libreoffice", "/usr/bin/soffice"]
    };

    for cand in candidates {
        let p = PathBuf::from(cand);
        if p.exists() {
            return Some(p);
        }
        if new_hidden_command(cand).arg("--version").output().is_ok() {
            return Some(p);
        }
    }
    None
}

/// Atomic crash-recovery save to app local data directory.
#[tauri::command]
fn save_recovery_session(app: tauri::AppHandle, json_data: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("App data dir error: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Create dir error: {}", e))?;
    let tmp = dir.join("recovery_session.tmp.json");
    let final_path = dir.join("recovery_session.json");
    fs::write(&tmp, json_data).map_err(|e| format!("Recovery write error: {}", e))?;
    fs::rename(&tmp, &final_path).map_err(|e| format!("Recovery commit error: {}", e))?;
    Ok(())
}

#[tauri::command]
fn load_recovery_session(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("App data dir error: {}", e))?;
    let final_path = dir.join("recovery_session.json");
    if !final_path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&final_path).map_err(|e| format!("Recovery read error: {}", e))?;
    Ok(Some(data))
}

#[tauri::command]
fn clear_recovery_session(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("App data dir error: {}", e))?;
    let final_path = dir.join("recovery_session.json");
    if final_path.exists() {
        let _ = fs::remove_file(&final_path);
    }
    Ok(())
}

fn is_private_ipv4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 10
        || (o[0] == 172 && (16..=31).contains(&o[1]))
        || (o[0] == 192 && o[1] == 168)
}

fn detect_local_ipv4() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = new_hidden_command("ipconfig").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut candidates: Vec<Ipv4Addr> = Vec::new();
            for line in text.lines() {
                if !line.contains("IPv4") {
                    continue;
                }
                if let Some((_, rhs)) = line.split_once(':') {
                    let ip_str = rhs.trim().trim_end_matches("(Preferred)").trim();
                    if let Ok(ip) = ip_str.parse::<Ipv4Addr>() {
                        if !ip.is_loopback() && !(ip.octets()[0] == 169 && ip.octets()[1] == 254) {
                            candidates.push(ip);
                        }
                    }
                }
            }
            // Prefer Windows Mobile Hotspot default gateway IP if active
            if let Some(hotspot) = candidates
                .iter()
                .find(|ip| ip.octets() == [192, 168, 137, 1])
            {
                return hotspot.to_string();
            }
            if let Some(priv_ip) = candidates.iter().find(|ip| is_private_ipv4(**ip)) {
                return priv_ip.to_string();
            }
            if let Some(first) = candidates.first() {
                return first.to_string();
            }
        }
    }

    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                let ip = addr.ip();
                if !ip.is_loopback() {
                    return ip.to_string();
                }
            }
        }
    }

    "127.0.0.1".to_string()
}

#[tauri::command]
fn start_local_pdf_share(
    state: tauri::State<'_, LocalShareServer>,
    bytes: Vec<u8>,
    filename: Option<String>,
) -> Result<LocalShareInfo, String> {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut prev) = guard.take() {
            prev.stop();
        }
    }

    let server = tiny_http::Server::http("0.0.0.0:8765")
        .or_else(|_| tiny_http::Server::http("0.0.0.0:0"))
        .map_err(|e| format!("Could not start local share server: {}", e))?;

    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| "Could not determine local server port".to_string())?;
    let ip = detect_local_ipv4();
    let safe_name = filename
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "notes.pdf".to_string());
    let url = format!("http://{}:{}/notes.pdf", ip, port);

    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop_flag);
    let pdf_bytes = Arc::new(bytes);

    let join_handle = std::thread::spawn(move || {
        while !thread_stop.load(Ordering::SeqCst) {
            match server.recv_timeout(Duration::from_millis(250)) {
                Ok(Some(request)) => {
                    let req_url = request.url().split('?').next().unwrap_or("/");
                    if req_url == "/" || req_url == "/notes.pdf" {
                        let disposition = format!("inline; filename=\"{}\"", safe_name);
                        let mut response = tiny_http::Response::from_data(pdf_bytes.as_slice());
                        if let Ok(h) = tiny_http::Header::from_bytes(
                            &b"Content-Type"[..],
                            &b"application/pdf"[..],
                        ) {
                            response.add_header(h);
                        }
                        if let Ok(h) = tiny_http::Header::from_bytes(
                            &b"Content-Disposition"[..],
                            disposition.as_bytes(),
                        ) {
                            response.add_header(h);
                        }
                        if let Ok(h) = tiny_http::Header::from_bytes(
                            &b"Access-Control-Allow-Origin"[..],
                            &b"*"[..],
                        ) {
                            response.add_header(h);
                        }
                        if let Ok(h) = tiny_http::Header::from_bytes(
                            &b"Cache-Control"[..],
                            &b"no-store"[..],
                        ) {
                            response.add_header(h);
                        }
                        let _ = request.respond(response);
                    } else {
                        let response =
                            tiny_http::Response::from_string("Not Found").with_status_code(404);
                        let _ = request.respond(response);
                    }
                }
                Ok(None) => continue,
                Err(_) => break,
            }
        }
    });

    if let Ok(mut guard) = state.0.lock() {
        *guard = Some(ShareServerHandle {
            stop_flag,
            join_handle: Some(join_handle),
        });
    }

    Ok(LocalShareInfo { url, ip, port })
}

#[tauri::command]
fn stop_local_pdf_share(state: tauri::State<'_, LocalShareServer>) -> Result<(), String> {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut handle) = guard.take() {
            handle.stop();
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PendingOpenFile(Mutex::new(None)))
        .manage(LocalShareServer(Mutex::new(None)))
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            if let Some(path) = extract_supported_file_arg(&args) {
                let _ = app.emit("open-file-path", path);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = extract_supported_file_arg(&args) {
                if let Ok(mut guard) = app.state::<PendingOpenFile>().0.lock() {
                    *guard = Some(path);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file_bytes,
            write_file_bytes,
            convert_ppt_to_pdf,
            extract_pptx_fallback,
            save_recovery_session,
            load_recovery_session,
            clear_recovery_session,
            take_startup_file_path,
            start_local_pdf_share,
            stop_local_pdf_share
        ])
        .run(tauri::generate_context!())
        .expect("error while running Captnz Board");
}
