// Typed wrappers around the Rust (Tauri) commands. The backend owns all
// encryption and disk access; this module is the only place that talks to it.
import { invoke } from "@tauri-apps/api/core";

export interface EntrySummary {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  excerpt: string;
  folder_id: string | null;
  day: string | null;
  word_count: number;
  /** True when the entry is encrypted and currently locked (body hidden). */
  locked: boolean;
}

export interface Entry {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
  folder_id: string | null;
  day: string | null;
  locked: boolean;
}

export interface FolderSettings {
  /** Auto-create one page per calendar day (diary behavior). */
  auto_daily_page: boolean;
  /** Daily word goal (e.g. 750); null disables the tracker. */
  word_goal: number | null;
  /** Encrypt this folder's entries at rest behind the shared app password. */
  encrypted: boolean;
}

export interface Folder {
  id: string;
  name: string;
  created_at: number;
  sort_order: number;
  /** Lucide icon name; null falls back to a default glyph. */
  icon: string | null;
  settings: FolderSettings;
}

// ---- App password (for encrypted folders) -----------------------------------

/** Whether the shared app password has been set up yet. */
export const isPasswordSet = () => invoke<boolean>("is_password_set");

/** Whether encrypted folders are currently unlocked this session. */
export const isUnlocked = () => invoke<boolean>("is_unlocked");

/** Set the app password for the first time (and unlock for this session). */
export const setPassword = (password: string) =>
  invoke<void>("set_password", { password });

/** Unlock encrypted folders for this session. */
export const unlock = (password: string) => invoke<void>("unlock", { password });

/** Re-lock encrypted folders (drops the in-memory key). */
export const lock = () => invoke<void>("lock");

/** Whether `password` is the current app password (no side effects). */
export const verifyPassword = (password: string) =>
  invoke<boolean>("verify_password", { password });

/** Change the shared app password (re-encrypts all sealed entries). */
export const changePassword = (current: string, next: string) =>
  invoke<void>("change_password", { current, new: next });

// ---- Entries ----------------------------------------------------------------

export const listEntries = () => invoke<EntrySummary[]>("list_entries");

export const getEntry = (id: string) => invoke<Entry>("get_entry", { id });

export const createEntry = (
  folderId: string | null,
  title: string,
  content: string
) => invoke<Entry>("create_entry", { folderId, title, content });

export const saveEntry = (id: string, title: string, content: string) =>
  invoke<Entry>("save_entry", { id, title, content });

export const deleteEntry = (id: string) =>
  invoke<void>("delete_entry", { id });

export const moveEntry = (id: string, folderId: string | null) =>
  invoke<Entry>("move_entry", { id, folderId });

/** Return the diary day-page for `day` in a folder, creating it if absent. */
export const getOrCreateDailyEntry = (
  folderId: string,
  day: string,
  title: string
) => invoke<Entry>("get_or_create_daily_entry", { folderId, day, title });

// ---- Folders ----------------------------------------------------------------

export const listFolders = () => invoke<Folder[]>("list_folders");

export const createFolder = (
  name: string,
  icon: string | null,
  settings: FolderSettings
) => invoke<Folder>("create_folder", { name, icon, settings });

export const updateFolder = (
  id: string,
  name: string,
  icon: string | null,
  settings: FolderSettings
) => invoke<Folder>("update_folder", { id, name, icon, settings });

export const deleteFolder = (id: string) =>
  invoke<void>("delete_folder", { id });
