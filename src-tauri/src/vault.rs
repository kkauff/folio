//! Local store for Folio.
//!
//! Folio opens without a password. Data lives in plaintext by default; an
//! individual folder can be flagged "encrypted", in which case its entries'
//! titles/bodies are sealed at rest with a key derived from a single shared
//! app password. The folder structure (names, membership) stays plaintext so
//! the sidebar works even while encrypted folders are locked.
//!
//! On-disk layout (under the OS app-data directory):
//!
//! ```text
//! <app_data>/store/
//!     secret.json          # salt + verifier; created only once a password is set
//!     folders.json         # plaintext folder list (names + settings)
//!     entries/<uuid>.json   # entry "envelope" (metadata plaintext; body maybe sealed)
//! ```

use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::crypto::{self, VaultKey, SALT_LEN};

/// Plaintext used to verify the app password. Sealed when the password is set;
/// if it decrypts cleanly on unlock, the password (hence key) is correct.
const VERIFIER_PLAINTEXT: &[u8] = b"folio-verify-v1";

/// Secret metadata stored unencrypted in `secret.json` (no secrets in it).
#[derive(Serialize, Deserialize)]
pub struct Secret {
    pub version: u32,
    /// Base64 Argon2 salt.
    pub salt: String,
    /// Base64 `nonce || ciphertext` of [`VERIFIER_PLAINTEXT`].
    pub verifier: String,
}

/// A journal entry as exposed to the frontend.
#[derive(Serialize, Deserialize, Clone)]
pub struct Entry {
    pub id: String,
    pub title: String,
    pub content: String,
    /// Milliseconds since the Unix epoch.
    pub created_at: i64,
    pub updated_at: i64,
    pub folder_id: Option<String>,
    pub day: Option<String>,
    /// True when the entry is encrypted but no key is available to open it.
    #[serde(default)]
    pub locked: bool,
}

/// Lightweight entry summary for the sidebar list (no full content).
#[derive(Serialize, Clone)]
pub struct EntrySummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub excerpt: String,
    pub folder_id: Option<String>,
    pub day: Option<String>,
    pub word_count: u32,
    pub locked: bool,
}

/// On-disk entry "envelope". Metadata is always plaintext; the title/content
/// are inline when `encrypted` is false, or sealed into `payload` when true.
#[derive(Serialize, Deserialize)]
struct EntryFile {
    id: String,
    folder_id: Option<String>,
    day: Option<String>,
    created_at: i64,
    updated_at: i64,
    encrypted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    /// Base64 `nonce || ciphertext` of the JSON `{ "title", "content" }`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    payload: Option<String>,
}

/// The plaintext title/content sealed inside an encrypted entry's payload.
#[derive(Serialize, Deserialize)]
struct SealedBody {
    title: String,
    content: String,
}

/// Per-folder behavior. A "Diary" folder enables daily pages + word goal; the
/// `encrypted` flag protects the folder's contents with the app password.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct FolderSettings {
    #[serde(default)]
    pub auto_daily_page: bool,
    #[serde(default)]
    pub word_goal: Option<u32>,
    #[serde(default)]
    pub encrypted: bool,
}

/// A folder grouping entries. Folders are flat (no nesting).
#[derive(Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub sort_order: i32,
    /// Lucide icon name chosen for the folder; `None` falls back to a default.
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub settings: FolderSettings,
}

// ---- Paths -------------------------------------------------------------------

fn store_dir(app_data: &Path) -> PathBuf {
    app_data.join("store")
}

fn secret_path(app_data: &Path) -> PathBuf {
    store_dir(app_data).join("secret.json")
}

fn folders_path(app_data: &Path) -> PathBuf {
    store_dir(app_data).join("folders.json")
}

fn entries_dir(app_data: &Path) -> PathBuf {
    store_dir(app_data).join("entries")
}

fn entry_path(app_data: &Path, id: &str) -> PathBuf {
    entries_dir(app_data).join(format!("{id}.json"))
}

// ---- App password ------------------------------------------------------------

/// Whether the shared app password has been set up.
pub fn is_password_set(app_data: &Path) -> bool {
    secret_path(app_data).exists()
}

/// Set the app password for the first time and return the derived key.
pub fn set_password(app_data: &Path, password: &str) -> Result<VaultKey, String> {
    if password.is_empty() {
        return Err("password must not be empty".to_string());
    }
    if is_password_set(app_data) {
        return Err("a password is already set".to_string());
    }
    let salt = crypto::random_bytes(SALT_LEN);
    let key = crypto::derive_key(password, &salt)?;
    let verifier = crypto::encrypt(&key, VERIFIER_PLAINTEXT)?;
    let secret = Secret {
        version: 1,
        salt: B64.encode(&salt),
        verifier: B64.encode(&verifier),
    };
    fs::create_dir_all(store_dir(app_data)).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(&secret).map_err(|e| e.to_string())?;
    fs::write(secret_path(app_data), raw).map_err(|e| e.to_string())?;
    Ok(key)
}

/// Verify `password` against the stored secret and return the derived key.
pub fn unlock(app_data: &Path, password: &str) -> Result<VaultKey, String> {
    let raw = fs::read_to_string(secret_path(app_data))
        .map_err(|_| "no password has been set".to_string())?;
    let secret: Secret =
        serde_json::from_str(&raw).map_err(|e| format!("corrupt secret: {e}"))?;
    let salt = B64.decode(&secret.salt).map_err(|e| e.to_string())?;
    let verifier = B64.decode(&secret.verifier).map_err(|e| e.to_string())?;

    let key = crypto::derive_key(password, &salt)?;
    let opened =
        crypto::decrypt(&key, &verifier).map_err(|_| "incorrect password".to_string())?;
    if opened != VERIFIER_PLAINTEXT {
        return Err("incorrect password".to_string());
    }
    Ok(key)
}

/// Check whether `password` is the current app password, without unlocking
/// (no state change). Returns false if no password is set.
pub fn verify_password(app_data: &Path, password: &str) -> Result<bool, String> {
    let path = secret_path(app_data);
    if !path.exists() {
        return Ok(false);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let secret: Secret =
        serde_json::from_str(&raw).map_err(|e| format!("corrupt secret: {e}"))?;
    let salt = B64.decode(&secret.salt).map_err(|e| e.to_string())?;
    let verifier = B64.decode(&secret.verifier).map_err(|e| e.to_string())?;
    let key = crypto::derive_key(password, &salt)?;
    Ok(crypto::decrypt(&key, &verifier)
        .map(|opened| opened == VERIFIER_PLAINTEXT)
        .unwrap_or(false))
}

/// Change the shared app password: verify `current`, then re-encrypt every
/// sealed entry from the old key to a key derived from `new`, and rewrite the
/// secret. Returns the new key so the caller can keep the session unlocked.
pub fn change_password(app_data: &Path, current: &str, new: &str) -> Result<VaultKey, String> {
    if new.is_empty() {
        return Err("password must not be empty".to_string());
    }
    let old_key = unlock(app_data, current)?; // verifies the current password

    let new_salt = crypto::random_bytes(SALT_LEN);
    let new_key = crypto::derive_key(new, &new_salt)?;

    // Re-seal every encrypted entry with the new key.
    let dir = entries_dir(app_data);
    if dir.exists() {
        for dirent in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let dirent = dirent.map_err(|e| e.to_string())?;
            let path = dirent.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let id = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let file = read_entry_file(app_data, &id)?;
            if file.encrypted {
                let entry = entry_from_file(file, Some(&old_key))?;
                save_entry_file(app_data, Some(&new_key), &entry, true)?;
            }
        }
    }

    // Persist the new salt + verifier (sealed with the new key).
    let verifier = crypto::encrypt(&new_key, VERIFIER_PLAINTEXT)?;
    let secret = Secret {
        version: 1,
        salt: B64.encode(&new_salt),
        verifier: B64.encode(&verifier),
    };
    let raw = serde_json::to_string_pretty(&secret).map_err(|e| e.to_string())?;
    fs::write(secret_path(app_data), raw).map_err(|e| e.to_string())?;

    Ok(new_key)
}

// ---- Entry envelope I/O ------------------------------------------------------

/// Decode an envelope into an `Entry`, decrypting the body if a key is present.
fn entry_from_file(file: EntryFile, key: Option<&VaultKey>) -> Result<Entry, String> {
    let (title, content, locked) = if file.encrypted {
        match (&file.payload, key) {
            (Some(payload), Some(key)) => {
                let sealed = B64.decode(payload).map_err(|e| e.to_string())?;
                let plain = crypto::decrypt(key, &sealed)?;
                let body: SealedBody =
                    serde_json::from_slice(&plain).map_err(|e| format!("corrupt entry: {e}"))?;
                (body.title, body.content, false)
            }
            // Encrypted but no key (locked) or missing payload: hide the body.
            _ => (String::new(), String::new(), true),
        }
    } else {
        (file.title.unwrap_or_default(), file.content.unwrap_or_default(), false)
    };
    Ok(Entry {
        id: file.id,
        title,
        content,
        created_at: file.created_at,
        updated_at: file.updated_at,
        folder_id: file.folder_id,
        day: file.day,
        locked,
    })
}

/// Build an envelope from an `Entry`, sealing the body when `encrypted`.
fn entry_to_file(entry: &Entry, encrypted: bool, key: Option<&VaultKey>) -> Result<EntryFile, String> {
    let mut file = EntryFile {
        id: entry.id.clone(),
        folder_id: entry.folder_id.clone(),
        day: entry.day.clone(),
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        encrypted,
        title: None,
        content: None,
        payload: None,
    };
    if encrypted {
        let key = key.ok_or_else(|| "vault is locked".to_string())?;
        let body = SealedBody {
            title: entry.title.clone(),
            content: entry.content.clone(),
        };
        let plain = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
        let sealed = crypto::encrypt(key, &plain)?;
        file.payload = Some(B64.encode(&sealed));
    } else {
        file.title = Some(entry.title.clone());
        file.content = Some(entry.content.clone());
    }
    Ok(file)
}

fn read_entry_file(app_data: &Path, id: &str) -> Result<EntryFile, String> {
    let raw = fs::read_to_string(entry_path(app_data, id))
        .map_err(|_| format!("entry '{id}' not found"))?;
    serde_json::from_str(&raw).map_err(|e| format!("corrupt entry: {e}"))
}

fn write_entry_file(app_data: &Path, file: &EntryFile) -> Result<(), String> {
    fs::create_dir_all(entries_dir(app_data)).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(entry_path(app_data, &file.id), raw).map_err(|e| e.to_string())
}

/// Read an entry, decrypting if a key is available (else returns it `locked`).
pub fn get_entry(app_data: &Path, key: Option<&VaultKey>, id: &str) -> Result<Entry, String> {
    let file = read_entry_file(app_data, id)?;
    entry_from_file(file, key)
}

/// Persist an entry, sealing it when its folder is encrypted.
fn save_entry_file(app_data: &Path, key: Option<&VaultKey>, entry: &Entry, encrypted: bool) -> Result<(), String> {
    let file = entry_to_file(entry, encrypted, key)?;
    write_entry_file(app_data, &file)
}

// ---- Entries -----------------------------------------------------------------

/// Whether the folder owning `folder_id` is flagged encrypted.
fn folder_is_encrypted(folders: &[Folder], folder_id: &Option<String>) -> bool {
    match folder_id {
        Some(id) => folders
            .iter()
            .find(|f| &f.id == id)
            .map(|f| f.settings.encrypted)
            .unwrap_or(false),
        None => false,
    }
}

/// Decrypt/scan every entry and return summaries, newest first.
pub fn list_entries(app_data: &Path, key: Option<&VaultKey>) -> Result<Vec<EntrySummary>, String> {
    let dir = entries_dir(app_data);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut summaries = Vec::new();
    for dirent in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let dirent = dirent.map_err(|e| e.to_string())?;
        let path = dirent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let file = read_entry_file(app_data, &id)?;
        let entry = entry_from_file(file, key)?;
        summaries.push(summary_of(&entry));
    }
    summaries.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    Ok(summaries)
}

/// Build a sidebar summary from an entry (empty body when locked).
fn summary_of(entry: &Entry) -> EntrySummary {
    EntrySummary {
        id: entry.id.clone(),
        title: entry.title.clone(),
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        excerpt: if entry.locked { String::new() } else { excerpt_of(&entry.content) },
        folder_id: entry.folder_id.clone(),
        day: entry.day.clone(),
        word_count: if entry.locked { 0 } else { word_count_of(&entry.content) },
        locked: entry.locked,
    }
}

fn word_count_of(content: &str) -> u32 {
    content.split_whitespace().count() as u32
}

/// Build a short, single-line excerpt from markdown body text.
fn excerpt_of(content: &str) -> String {
    content
        .lines()
        .map(|l| l.trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .take(120)
        .collect()
}

/// Create a new entry, sealing it when the target folder is encrypted.
pub fn create_entry(
    app_data: &Path,
    key: Option<&VaultKey>,
    folder_id: Option<String>,
    title: &str,
    content: &str,
    now: i64,
) -> Result<Entry, String> {
    let folders = list_folders(app_data)?;
    let encrypted = folder_is_encrypted(&folders, &folder_id);
    let entry = Entry {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.to_string(),
        content: content.to_string(),
        created_at: now,
        updated_at: now,
        folder_id,
        day: None,
        locked: false,
    };
    save_entry_file(app_data, key, &entry, encrypted)?;
    Ok(entry)
}

/// Overwrite an existing entry's title/content and return the updated entry.
pub fn save_entry(
    app_data: &Path,
    key: Option<&VaultKey>,
    id: &str,
    title: &str,
    content: &str,
    now: i64,
) -> Result<Entry, String> {
    let file = read_entry_file(app_data, id)?;
    let encrypted = file.encrypted;
    if encrypted && key.is_none() {
        return Err("vault is locked".to_string());
    }
    let entry = Entry {
        id: id.to_string(),
        title: title.to_string(),
        content: content.to_string(),
        created_at: file.created_at,
        updated_at: now,
        folder_id: file.folder_id,
        day: file.day,
        locked: false,
    };
    save_entry_file(app_data, key, &entry, encrypted)?;
    Ok(entry)
}

/// Move an entry to a different folder, re-sealing if it crosses an encryption
/// boundary. Requires the key when either side is encrypted.
pub fn move_entry(
    app_data: &Path,
    key: Option<&VaultKey>,
    id: &str,
    folder_id: Option<String>,
    now: i64,
) -> Result<Entry, String> {
    let folders = list_folders(app_data)?;
    let target_encrypted = folder_is_encrypted(&folders, &folder_id);
    // Decode the current entry (needs key if currently encrypted).
    let mut entry = get_entry(app_data, key, id)?;
    if entry.locked {
        return Err("vault is locked".to_string());
    }
    if target_encrypted && key.is_none() {
        return Err("vault is locked".to_string());
    }
    entry.folder_id = folder_id;
    entry.updated_at = now;
    save_entry_file(app_data, key, &entry, target_encrypted)?;
    Ok(entry)
}

/// Return the diary day-page for `day` in `folder_id`, creating it if absent.
pub fn get_or_create_daily_entry(
    app_data: &Path,
    key: Option<&VaultKey>,
    folder_id: &str,
    day: &str,
    title: &str,
    now: i64,
) -> Result<Entry, String> {
    let folders = list_folders(app_data)?;
    let encrypted = folder_is_encrypted(&folders, &Some(folder_id.to_string()));
    if encrypted && key.is_none() {
        return Err("vault is locked".to_string());
    }

    let dir = entries_dir(app_data);
    if dir.exists() {
        for dirent in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let dirent = dirent.map_err(|e| e.to_string())?;
            let path = dirent.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let entry_id = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let file = read_entry_file(app_data, &entry_id)?;
            if file.day.as_deref() == Some(day)
                && file.folder_id.as_deref() == Some(folder_id)
            {
                return entry_from_file(file, key);
            }
        }
    }

    let entry = Entry {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.to_string(),
        content: String::new(),
        created_at: now,
        updated_at: now,
        folder_id: Some(folder_id.to_string()),
        day: Some(day.to_string()),
        locked: false,
    };
    save_entry_file(app_data, key, &entry, encrypted)?;
    Ok(entry)
}

pub fn delete_entry(app_data: &Path, id: &str) -> Result<(), String> {
    let path = entry_path(app_data, id);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---- Folders -----------------------------------------------------------------

/// Read the plaintext folder list; an absent file means no folders yet.
pub fn list_folders(app_data: &Path) -> Result<Vec<Folder>, String> {
    let path = folders_path(app_data);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut folders: Vec<Folder> =
        serde_json::from_str(&raw).map_err(|e| format!("corrupt folders: {e}"))?;
    folders.sort_by_key(|f| f.sort_order);
    Ok(folders)
}

fn write_folders(app_data: &Path, folders: &[Folder]) -> Result<(), String> {
    fs::create_dir_all(store_dir(app_data)).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(folders).map_err(|e| e.to_string())?;
    fs::write(folders_path(app_data), raw).map_err(|e| e.to_string())
}

/// Create a folder and return it.
pub fn create_folder(
    app_data: &Path,
    name: &str,
    icon: Option<String>,
    settings: FolderSettings,
    now: i64,
) -> Result<Folder, String> {
    let mut folders = list_folders(app_data)?;
    let sort_order = folders.iter().map(|f| f.sort_order).max().unwrap_or(-1) + 1;
    let folder = Folder {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        created_at: now,
        sort_order,
        icon,
        settings,
    };
    folders.push(folder.clone());
    write_folders(app_data, &folders)?;
    Ok(folder)
}

/// Update a folder's name and settings. When the `encrypted` flag flips, every
/// entry in the folder is rewritten into the new format (requires the key).
pub fn update_folder(
    app_data: &Path,
    key: Option<&VaultKey>,
    id: &str,
    name: &str,
    icon: Option<String>,
    settings: FolderSettings,
) -> Result<Folder, String> {
    let mut folders = list_folders(app_data)?;
    let prev_encrypted = folders
        .iter()
        .find(|f| f.id == id)
        .map(|f| f.settings.encrypted)
        .ok_or_else(|| format!("folder '{id}' not found"))?;

    if settings.encrypted != prev_encrypted {
        reencrypt_folder_entries(app_data, key, id, settings.encrypted)?;
    }

    let folder = folders
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("folder '{id}' not found"))?;
    folder.name = name.to_string();
    folder.icon = icon;
    folder.settings = settings;
    let updated = folder.clone();
    write_folders(app_data, &folders)?;
    Ok(updated)
}

/// Rewrite every entry in a folder to be sealed (`encrypt = true`) or plaintext
/// (`encrypt = false`). Requires the key (to seal new, or to read existing).
fn reencrypt_folder_entries(
    app_data: &Path,
    key: Option<&VaultKey>,
    folder_id: &str,
    encrypt: bool,
) -> Result<(), String> {
    if key.is_none() {
        return Err("vault is locked".to_string());
    }
    let dir = entries_dir(app_data);
    if !dir.exists() {
        return Ok(());
    }
    for dirent in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let dirent = dirent.map_err(|e| e.to_string())?;
        let path = dirent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let entry_id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let file = read_entry_file(app_data, &entry_id)?;
        if file.folder_id.as_deref() != Some(folder_id) {
            continue;
        }
        // Decode with the key, then re-save in the requested format.
        let entry = entry_from_file(file, key)?;
        save_entry_file(app_data, key, &entry, encrypt)?;
    }
    Ok(())
}

/// Delete a folder and cascade-delete every entry it contains.
pub fn delete_folder(app_data: &Path, id: &str) -> Result<(), String> {
    let dir = entries_dir(app_data);
    if dir.exists() {
        for dirent in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let dirent = dirent.map_err(|e| e.to_string())?;
            let path = dirent.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let file = read_entry_file(
                app_data,
                path.file_stem().and_then(|s| s.to_str()).unwrap_or(""),
            )?;
            if file.folder_id.as_deref() == Some(id) {
                fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
        }
    }
    let mut folders = list_folders(app_data)?;
    folders.retain(|f| f.id != id);
    write_folders(app_data, &folders)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway app-data dir, removed on drop.
    struct TempData(PathBuf);
    impl TempData {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("folio-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            TempData(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempData {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn raw_entry_json(data: &Path, id: &str) -> String {
        fs::read_to_string(entry_path(data, id)).unwrap()
    }

    #[test]
    fn plaintext_folder_stores_readable_content() {
        let tmp = TempData::new();
        let data = tmp.path();
        let folder = create_folder(data, "Work", None, FolderSettings::default(), 1).unwrap();
        let entry =
            create_entry(data, None, Some(folder.id), "My title", "secret body text", 1).unwrap();

        // On disk: plaintext title/content present, no payload.
        let raw = raw_entry_json(data, &entry.id);
        assert!(raw.contains("secret body text"));
        assert!(!raw.contains("payload"));
        // Readable without any key.
        let got = get_entry(data, None, &entry.id).unwrap();
        assert_eq!(got.content, "secret body text");
        assert!(!got.locked);
    }

    #[test]
    fn encrypted_folder_seals_content_and_locks_without_key() {
        let tmp = TempData::new();
        let data = tmp.path();
        let key = set_password(data, "hunter2hunter2").unwrap();

        let settings = FolderSettings { encrypted: true, ..Default::default() };
        let folder = create_folder(data, "Therapy", None, settings, 1).unwrap();
        let entry = create_entry(
            data,
            Some(&key),
            Some(folder.id),
            "Private title",
            "do not leak this",
            1,
        )
        .unwrap();

        // On disk: no plaintext title/content; a sealed payload instead.
        let raw = raw_entry_json(data, &entry.id);
        assert!(!raw.contains("do not leak this"), "content leaked: {raw}");
        assert!(!raw.contains("Private title"), "title leaked: {raw}");
        assert!(raw.contains("payload"));

        // With the key: readable. Without it: locked with empty body.
        let opened = get_entry(data, Some(&key), &entry.id).unwrap();
        assert_eq!(opened.content, "do not leak this");
        assert!(!opened.locked);

        let locked = get_entry(data, None, &entry.id).unwrap();
        assert!(locked.locked);
        assert_eq!(locked.content, "");
        assert_eq!(locked.title, "");
    }

    #[test]
    fn toggling_encryption_reseals_then_restores_plaintext() {
        let tmp = TempData::new();
        let data = tmp.path();
        let key = set_password(data, "correcthorse").unwrap();
        let folder = create_folder(data, "Journal", None, FolderSettings::default(), 1).unwrap();
        let entry =
            create_entry(data, Some(&key), Some(folder.id.clone()), "t", "plain words", 1).unwrap();

        // Turn encryption ON → content sealed on disk.
        let enc = FolderSettings { encrypted: true, ..Default::default() };
        update_folder(data, Some(&key), &folder.id, "Journal", None, enc).unwrap();
        assert!(!raw_entry_json(data, &entry.id).contains("plain words"));
        assert!(get_entry(data, None, &entry.id).unwrap().locked);

        // Turn encryption OFF → content readable again on disk.
        let dec = FolderSettings::default();
        update_folder(data, Some(&key), &folder.id, "Journal", None, dec).unwrap();
        assert!(raw_entry_json(data, &entry.id).contains("plain words"));
        let got = get_entry(data, None, &entry.id).unwrap();
        assert_eq!(got.content, "plain words");
        assert!(!got.locked);
    }

    #[test]
    fn wrong_password_does_not_unlock() {
        let tmp = TempData::new();
        let data = tmp.path();
        set_password(data, "the-right-one").unwrap();
        assert!(unlock(data, "the-wrong-one").is_err());
        assert!(unlock(data, "the-right-one").is_ok());
    }

    #[test]
    fn verify_password_no_unlock_no_panic() {
        let tmp = TempData::new();
        let data = tmp.path();
        // No password set yet → false, no panic.
        assert!(!verify_password(data, "anything").unwrap());
        set_password(data, "right").unwrap();
        assert!(verify_password(data, "right").unwrap());
        assert!(!verify_password(data, "wrong").unwrap());
        assert!(!verify_password(data, "").unwrap());
    }

    #[test]
    fn change_password_reencrypts_and_swaps_verifier() {
        let tmp = TempData::new();
        let data = tmp.path();
        // Short password is allowed.
        let key = set_password(data, "ab").unwrap();
        let settings = FolderSettings { encrypted: true, ..Default::default() };
        let folder = create_folder(data, "Secret", None, settings, 1).unwrap();
        let entry = create_entry(data, Some(&key), Some(folder.id), "t", "hidden words", 1).unwrap();

        // Wrong current password is rejected.
        assert!(change_password(data, "wrong", "new").is_err());

        // Change to a new password.
        let new_key = change_password(data, "ab", "new-pass").unwrap();
        assert!(unlock(data, "ab").is_err(), "old password should stop working");
        assert!(unlock(data, "new-pass").is_ok(), "new password should work");

        // The entry decrypts with the new key and its content is intact.
        let got = get_entry(data, Some(&new_key), &entry.id).unwrap();
        assert_eq!(got.content, "hidden words");
        // And it's still sealed (locked without a key).
        assert!(get_entry(data, None, &entry.id).unwrap().locked);
    }
}
