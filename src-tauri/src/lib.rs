//! Folio — a local-only markdown journal with optional per-folder encryption.
//!
//! The app opens without a password. Data is stored in plaintext by default; a
//! folder flagged "encrypted" has its entries sealed at rest with a key derived
//! from a single shared app password. That key lives only in memory (in
//! [`AppState`] behind a mutex) while unlocked, and is dropped on lock/quit.

mod crypto;
mod vault;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

use crypto::VaultKey;
use vault::{Entry, EntrySummary, Folder, FolderSettings};

#[derive(Default)]
struct AppState {
    /// The app-password key while encrypted folders are unlocked, else `None`.
    key: Mutex<Option<VaultKey>>,
}

/// Current wall-clock time in milliseconds since the Unix epoch.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Resolve (and lazily create) the app-data directory for Folio.
fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Run `f` with the currently cached key (or `None` while locked).
fn with_key<T>(
    state: &tauri::State<AppState>,
    f: impl FnOnce(Option<&VaultKey>) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.key.lock().map_err(|_| "state poisoned".to_string())?;
    f(guard.as_ref())
}

// ---- Password lifecycle ------------------------------------------------------

#[tauri::command]
fn is_password_set(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(vault::is_password_set(&app_data(&app)?))
}

#[tauri::command]
fn is_unlocked(state: tauri::State<AppState>) -> Result<bool, String> {
    let guard = state.key.lock().map_err(|_| "state poisoned".to_string())?;
    Ok(guard.is_some())
}

// Argon2-heavy commands are `async` + spawn_blocking so they run off the main
// UI thread (sync commands block the webview, freezing it and hiding spinners).
#[tauri::command]
async fn set_password(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    password: String,
) -> Result<(), String> {
    let data = app_data(&app)?;
    let key = tauri::async_runtime::spawn_blocking(move || vault::set_password(&data, &password))
        .await
        .map_err(|e| e.to_string())??;
    *state.key.lock().map_err(|_| "state poisoned".to_string())? = Some(key);
    Ok(())
}

#[tauri::command]
async fn unlock(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    password: String,
) -> Result<(), String> {
    let data = app_data(&app)?;
    let key = tauri::async_runtime::spawn_blocking(move || vault::unlock(&data, &password))
        .await
        .map_err(|e| e.to_string())??;
    *state.key.lock().map_err(|_| "state poisoned".to_string())? = Some(key);
    Ok(())
}

#[tauri::command]
fn lock(state: tauri::State<AppState>) -> Result<(), String> {
    *state.key.lock().map_err(|_| "state poisoned".to_string())? = None;
    Ok(())
}

// `async` so Tauri runs this off the main UI thread: it's called repeatedly as
// the user types, and Argon2 is heavy enough to freeze the webview if run on the
// main thread (which is what sync commands do).
#[tauri::command]
async fn verify_password(app: tauri::AppHandle, password: String) -> Result<bool, String> {
    let data = app_data(&app)?;
    tauri::async_runtime::spawn_blocking(move || vault::verify_password(&data, &password))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn change_password(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    current: String,
    new: String,
) -> Result<(), String> {
    let data = app_data(&app)?;
    let key =
        tauri::async_runtime::spawn_blocking(move || vault::change_password(&data, &current, &new))
            .await
            .map_err(|e| e.to_string())??;
    *state.key.lock().map_err(|_| "state poisoned".to_string())? = Some(key);
    Ok(())
}

// ---- Entry commands ----------------------------------------------------------

#[tauri::command]
fn list_entries(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<Vec<EntrySummary>, String> {
    let data = app_data(&app)?;
    with_key(&state, |key| vault::list_entries(&data, key))
}

#[tauri::command]
fn get_entry(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: String,
) -> Result<Entry, String> {
    let data = app_data(&app)?;
    with_key(&state, |key| vault::get_entry(&data, key, &id))
}

#[tauri::command]
fn create_entry(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    folder_id: Option<String>,
    title: String,
    content: String,
) -> Result<Entry, String> {
    let data = app_data(&app)?;
    with_key(&state, |key| {
        vault::create_entry(&data, key, folder_id.clone(), &title, &content, now_ms())
    })
}

#[tauri::command]
fn move_entry(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: String,
    folder_id: Option<String>,
) -> Result<Entry, String> {
    let data = app_data(&app)?;
    with_key(&state, |key| {
        vault::move_entry(&data, key, &id, folder_id.clone(), now_ms())
    })
}

#[tauri::command]
fn get_or_create_daily_entry(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    folder_id: String,
    day: String,
    title: String,
) -> Result<Entry, String> {
    let data = app_data(&app)?;
    with_key(&state, |key| {
        vault::get_or_create_daily_entry(&data, key, &folder_id, &day, &title, now_ms())
    })
}

#[tauri::command]
fn save_entry(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: String,
    title: String,
    content: String,
) -> Result<Entry, String> {
    let data = app_data(&app)?;
    with_key(&state, |key| {
        vault::save_entry(&data, key, &id, &title, &content, now_ms())
    })
}

#[tauri::command]
fn delete_entry(app: tauri::AppHandle, id: String) -> Result<(), String> {
    vault::delete_entry(&app_data(&app)?, &id)
}

// ---- Folder commands ---------------------------------------------------------

#[tauri::command]
fn list_folders(app: tauri::AppHandle) -> Result<Vec<Folder>, String> {
    vault::list_folders(&app_data(&app)?)
}

#[tauri::command]
fn create_folder(
    app: tauri::AppHandle,
    name: String,
    icon: Option<String>,
    settings: FolderSettings,
) -> Result<Folder, String> {
    vault::create_folder(&app_data(&app)?, &name, icon, settings, now_ms())
}

#[tauri::command]
fn update_folder(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: String,
    name: String,
    icon: Option<String>,
    settings: FolderSettings,
) -> Result<Folder, String> {
    let data = app_data(&app)?;
    with_key(&state, |key| {
        vault::update_folder(&data, key, &id, &name, icon.clone(), settings.clone())
    })
}

#[tauri::command]
fn delete_folder(app: tauri::AppHandle, id: String) -> Result<(), String> {
    vault::delete_folder(&app_data(&app)?, &id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            is_password_set,
            is_unlocked,
            set_password,
            unlock,
            lock,
            verify_password,
            change_password,
            list_entries,
            get_entry,
            create_entry,
            move_entry,
            get_or_create_daily_entry,
            save_entry,
            delete_entry,
            list_folders,
            create_folder,
            update_folder,
            delete_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
