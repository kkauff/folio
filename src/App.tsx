import { useEffect, useState } from "react";
import {
  changePassword,
  createEntry,
  createFolder,
  deleteEntry,
  deleteFolder,
  getEntry,
  getOrCreateDailyEntry,
  isPasswordSet,
  isUnlocked,
  listEntries,
  listFolders,
  lock as lockApi,
  moveEntry,
  saveEntry,
  setPassword,
  unlock as unlockApi,
  updateFolder,
  type Entry,
  type EntrySummary,
  type Folder,
  type FolderSettings,
} from "./lib/api";
import { localDay, formatDayTitle } from "./lib/stats";
import { applyTheme, applyTypography, findTheme, getActiveThemeId } from "./lib/themes";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { ThemePanel } from "./components/ThemePanel";
import { FolderSettings as FolderSettingsModal } from "./components/FolderSettings";
import { DiaryStats } from "./components/DiaryStats";
import { PasswordPrompt } from "./components/PasswordPrompt";
import { ConfirmDialog } from "./components/ConfirmDialog";
import "./styles.css";

/** Single-line excerpt of a markdown body, mirroring the backend's logic. */
function excerptOf(content: string): string {
  const line = content
    .split("\n")
    .map((l) => l.replace(/^#+/, "").trim())
    .find((l) => l.length > 0);
  return (line ?? "").slice(0, 120);
}

function wordCountOf(content: string): number {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function summaryFrom(entry: Entry): EntrySummary {
  return {
    id: entry.id,
    title: entry.title,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    excerpt: entry.locked ? "" : excerptOf(entry.content),
    folder_id: entry.folder_id,
    day: entry.day,
    word_count: entry.locked ? 0 : wordCountOf(entry.content),
    locked: entry.locked,
  };
}

/** Replace an entry's summary in the list (or prepend it), newest first. */
function upsertSummary(list: EntrySummary[], summary: EntrySummary): EntrySummary[] {
  const others = list.filter((e) => e.id !== summary.id);
  return [summary, ...others].sort((a, b) => b.updated_at - a.updated_at);
}

interface PromptRequest {
  mode: "set" | "unlock";
  /** Runs after the password is accepted, before the prompt closes. */
  onSuccess?: () => Promise<void> | void;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [active, setActive] = useState<Entry | null>(null);
  const [passwordSet, setPasswordSet] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [activeThemeId, setActiveThemeId] = useState(getActiveThemeId());
  const [pendingDelete, setPendingDelete] = useState<EntrySummary | null>(null);
  const [folderModal, setFolderModal] = useState<{ folder: Folder | null } | null>(null);
  const [statsFolder, setStatsFolder] = useState<Folder | null>(null);
  const [pendingFolderDelete, setPendingFolderDelete] = useState<Folder | null>(null);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  // Bumped when the open entry is changed externally (rename) so the editor reloads it.
  const [syncKey, setSyncKey] = useState(0);

  // Apply the saved theme and load the journal directly — no password gate.
  useEffect(() => {
    applyTheme(findTheme(getActiveThemeId()));
    applyTypography();
    Promise.all([isPasswordSet(), isUnlocked(), listFolders(), listEntries()])
      .then(([pw, unl, folderList, list]) => {
        setPasswordSet(pw);
        setUnlocked(unl);
        setFolders(folderList);
        setEntries(list);
        if (list.length > 0) void openEntry(list[0].id);
      })
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadEntries() {
    setEntries(await listEntries());
  }

  async function openEntry(id: string) {
    const entry = await getEntry(id);
    setActive(entry);
  }

  // ---- Password prompt ------------------------------------------------------

  function requestPassword(req: PromptRequest) {
    setPrompt(req);
  }

  async function submitPassword(password: string) {
    if (!prompt) return;
    if (prompt.mode === "set") await setPassword(password);
    else await unlockApi(password);
    setPasswordSet(true);
    setUnlocked(true);
    if (prompt.onSuccess) await prompt.onSuccess();
    await reloadEntries();
    if (active) {
      try {
        setActive(await getEntry(active.id));
      } catch {
        /* entry may have been removed */
      }
    }
    setPrompt(null);
  }

  function handleUnlock() {
    requestPassword({ mode: passwordSet ? "unlock" : "set" });
  }

  async function handleChangePassword(current: string, next: string) {
    await changePassword(current, next);
    setPasswordSet(true);
    setUnlocked(true);
    await reloadEntries();
  }

  async function handleLock() {
    await lockApi();
    setUnlocked(false);
    await reloadEntries();
    if (active) {
      try {
        setActive(await getEntry(active.id));
      } catch {
        /* ignore */
      }
    }
  }

  // ---- Entries --------------------------------------------------------------

  async function createOrOpen(folder: Folder | null, folderId: string | null) {
    if (folder && folder.settings.auto_daily_page) {
      const entry = await getOrCreateDailyEntry(folder.id, localDay(), formatDayTitle());
      setEntries((prev) => upsertSummary(prev, summaryFrom(entry)));
      setActive(entry);
      return;
    }
    const entry = await createEntry(folderId, "", "");
    setEntries((prev) => [summaryFrom(entry), ...prev]);
    setActive(entry);
  }

  async function handleNewEntry(folderId: string | null) {
    const folder = folderId ? folders.find((f) => f.id === folderId) ?? null : null;
    if (folder?.settings.encrypted && !unlocked) {
      requestPassword({
        mode: passwordSet ? "unlock" : "set",
        onSuccess: () => createOrOpen(folder, folderId),
      });
      return;
    }
    await createOrOpen(folder, folderId);
  }

  function handleSaved(updated: Entry) {
    setEntries((prev) => upsertSummary(prev, summaryFrom(updated)));
    setActive((cur) => (cur && cur.id === updated.id ? updated : cur));
  }

  async function handleRename(id: string, title: string) {
    const entry = await getEntry(id);
    if (entry.locked) return;
    const updated = await saveEntry(id, title, entry.content);
    handleSaved(updated);
    setActive((cur) => {
      if (cur && cur.id === id) {
        setSyncKey((k) => k + 1);
        return updated;
      }
      return cur;
    });
  }

  async function handleMove(id: string, folderId: string | null) {
    const target = folderId ? folders.find((f) => f.id === folderId) ?? null : null;
    const doMove = async () => {
      const updated = await moveEntry(id, folderId);
      handleSaved(updated);
    };
    if (target?.settings.encrypted && !unlocked) {
      requestPassword({ mode: passwordSet ? "unlock" : "set", onSuccess: doMove });
      return;
    }
    await doMove();
  }

  function requestDelete(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (entry) setPendingDelete(entry);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    await deleteEntry(id);
    setActive((cur) => (cur && cur.id === id ? null : cur));
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setPendingDelete(null);
  }

  // ---- Folders --------------------------------------------------------------

  async function doSaveFolder(
    editing: Folder | null,
    name: string,
    icon: string | null,
    settings: FolderSettings
  ) {
    if (editing) {
      const updated = await updateFolder(editing.id, name, icon, settings);
      setFolders((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    } else {
      const created = await createFolder(name, icon, settings);
      setFolders((prev) => [...prev, created].sort((a, b) => a.sort_order - b.sort_order));
    }
    setFolderModal(null);
    await reloadEntries();
  }

  function handleSaveFolder(
    name: string,
    icon: string | null,
    settings: FolderSettings
  ): void | Promise<void> {
    const editing = folderModal?.folder ?? null;
    const wasEncrypted = editing?.settings.encrypted ?? false;
    // Toggling encryption (either direction) needs the key to re-seal/un-seal.
    if (settings.encrypted !== wasEncrypted && !unlocked) {
      requestPassword({
        mode: passwordSet ? "unlock" : "set",
        onSuccess: () => doSaveFolder(editing, name, icon, settings),
      });
      return;
    }
    // Return the promise so the modal can show a spinner during the save.
    return doSaveFolder(editing, name, icon, settings);
  }

  async function confirmFolderDelete() {
    if (!pendingFolderDelete) return;
    const id = pendingFolderDelete.id;
    await deleteFolder(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setEntries((prev) => prev.filter((e) => e.folder_id !== id));
    setActive((cur) => (cur && cur.folder_id === id ? null : cur));
    setPendingFolderDelete(null);
  }

  if (!ready) return <div className="app-loading" />;

  const activeFolder = active?.folder_id
    ? folders.find((f) => f.id === active.folder_id) ?? null
    : null;
  const folderEntryCount = pendingFolderDelete
    ? entries.filter((e) => e.folder_id === pendingFolderDelete.id).length
    : 0;

  return (
    <div className="app">
      <Sidebar
        entries={entries}
        folders={folders}
        activeId={active?.id ?? null}
        unlocked={unlocked}
        onSelect={openEntry}
        onNewEntry={handleNewEntry}
        onNewFolder={() => setFolderModal({ folder: null })}
        onFolderSettings={(folder) => setFolderModal({ folder })}
        onFolderStats={(folder) => setStatsFolder(folder)}
        onDeleteFolder={(folder) => setPendingFolderDelete(folder)}
        onLock={handleLock}
        onUnlock={handleUnlock}
        onOpenThemes={() => setShowThemes(true)}
        onRename={handleRename}
        onMove={handleMove}
        onDelete={requestDelete}
      />

      <main className="main">
        {active ? (
          <Editor
            key={active.id}
            entry={active}
            syncKey={syncKey}
            goal={activeFolder?.settings.word_goal ?? null}
            locked={active.locked}
            onUnlock={handleUnlock}
            onSaved={handleSaved}
          />
        ) : (
          <div className="empty-editor">
            <div>
              <h2>No entry selected</h2>
              <p>
                Pick an entry on the left, or{" "}
                <button className="link inline" onClick={() => handleNewEntry(null)}>
                  start a new one
                </button>
                .
              </p>
            </div>
          </div>
        )}
      </main>

      {showThemes && (
        <ThemePanel
          activeId={activeThemeId}
          onActiveChange={setActiveThemeId}
          onClose={() => setShowThemes(false)}
        />
      )}

      {folderModal && (
        <FolderSettingsModal
          folder={folderModal.folder}
          canChangePassword={passwordSet}
          onSave={handleSaveFolder}
          onChangePassword={handleChangePassword}
          onClose={() => setFolderModal(null)}
        />
      )}

      {statsFolder && (
        <DiaryStats
          folder={statsFolder}
          entries={entries}
          onClose={() => setStatsFolder(null)}
        />
      )}

      {prompt && (
        <PasswordPrompt
          mode={prompt.mode}
          onSubmit={submitPassword}
          onCancel={() => setPrompt(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete entry"
          message={`Delete "${pendingDelete.title || "Untitled"}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingFolderDelete && (
        <ConfirmDialog
          title="Delete folder"
          message={`Delete "${pendingFolderDelete.name}"${
            folderEntryCount > 0
              ? ` and its ${folderEntryCount} ${folderEntryCount === 1 ? "entry" : "entries"}`
              : ""
          }? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmFolderDelete}
          onCancel={() => setPendingFolderDelete(null)}
        />
      )}
    </div>
  );
}
