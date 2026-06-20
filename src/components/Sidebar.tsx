import { useState } from "react";
import {
  ChevronRight,
  FolderPlus,
  Lock,
  LockOpen,
  MoreHorizontal,
  NotebookText,
  Palette,
  Plus,
} from "lucide-react";
import type { EntrySummary, Folder } from "../lib/api";
import { FolderGlyph } from "../lib/icons";
import { ContextMenu, type MenuItem } from "./ContextMenu";

interface Props {
  entries: EntrySummary[];
  folders: Folder[];
  activeId: string | null;
  unlocked: boolean;
  onUnlock: () => void;
  onSelect: (id: string) => void;
  /** Create a new entry; for diary folders the parent opens today's page. */
  onNewEntry: (folderId: string | null) => void;
  onNewFolder: () => void;
  onFolderSettings: (folder: Folder) => void;
  onFolderStats: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onLock: () => void;
  onOpenThemes: () => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onDelete: (id: string) => void;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const isDiary = (f: Folder) => f.settings.auto_daily_page;

type Menu =
  | { kind: "entry"; id: string; x: number; y: number; stage: "main" | "move" }
  | { kind: "folder"; id: string; x: number; y: number };

export function Sidebar({
  entries,
  folders,
  activeId,
  unlocked,
  onUnlock,
  onSelect,
  onNewEntry,
  onNewFolder,
  onFolderSettings,
  onFolderStats,
  onDeleteFolder,
  onLock,
  onOpenThemes,
  onRename,
  onMove,
  onDelete,
}: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function startRename(entry: EntrySummary) {
    setRenamingId(entry.id);
    setRenameValue(entry.title);
  }

  function commitRename() {
    if (renamingId) onRename(renamingId, renameValue.trim());
    setRenamingId(null);
  }

  const notes = entries.filter((e) => !e.folder_id);
  const entriesIn = (folderId: string) =>
    entries.filter((e) => e.folder_id === folderId);

  function renderEntry(e: EntrySummary) {
    return renamingId === e.id ? (
      <input
        key={e.id}
        className="rename-input"
        value={renameValue}
        autoFocus
        onChange={(ev) => setRenameValue(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") commitRename();
          if (ev.key === "Escape") setRenamingId(null);
        }}
        onBlur={commitRename}
      />
    ) : (
      <button
        key={e.id}
        className={`entry-row ${e.id === activeId ? "active" : ""}`}
        onClick={() => onSelect(e.id)}
        onContextMenu={(ev) => {
          ev.preventDefault();
          setMenu({ kind: "entry", id: e.id, x: ev.clientX, y: ev.clientY, stage: "main" });
        }}
      >
        <div className="entry-row-title">
          {e.locked ? (
            <span className="locked-row">
              <Lock size={12} /> Locked
            </span>
          ) : (
            e.title || "Untitled"
          )}
        </div>
        <div className="entry-row-meta">{formatDate(e.updated_at)}</div>
        {e.excerpt && <div className="entry-row-excerpt">{e.excerpt}</div>}
      </button>
    );
  }

  function renderGroup(
    key: string,
    label: React.ReactNode,
    groupEntries: EntrySummary[],
    folder: Folder | null
  ) {
    // A locked, password-protected folder is forced collapsed and can't be
    // expanded until unlocked; clicking it prompts for the password instead.
    const isLocked = !!folder?.settings.encrypted && !unlocked;
    const open = !isLocked && !collapsed.has(key);
    return (
      <div className="folder-group" key={key}>
        <div
          className="folder-header"
          onContextMenu={
            folder
              ? (ev) => {
                  ev.preventDefault();
                  setMenu({ kind: "folder", id: folder.id, x: ev.clientX, y: ev.clientY });
                }
              : undefined
          }
        >
          <button
            className="folder-toggle"
            onClick={() => (isLocked ? onUnlock() : toggleCollapse(key))}
            title={isLocked ? "Locked — click to unlock" : open ? "Collapse" : "Expand"}
          >
            <ChevronRight className={`caret ${open ? "open" : ""}`} size={14} />
            <span className="folder-name">{label}</span>
            <span className="folder-count">{groupEntries.length}</span>
          </button>
          {/* Fixed slot (kept for every row so counts stay aligned); holds the
              per-folder lock toggle on password-protected folders. */}
          <span className="folder-lock-slot">
            {folder?.settings.encrypted &&
              (unlocked ? (
                <button
                  className="icon-btn tiny folder-lock"
                  title="Lock folder"
                  onClick={onLock}
                >
                  <LockOpen size={14} />
                </button>
              ) : (
                <button
                  className="icon-btn tiny folder-lock"
                  title="Unlock folder"
                  onClick={onUnlock}
                >
                  <Lock size={14} />
                </button>
              ))}
          </span>
          <div className="folder-actions">
            <button
              className="icon-btn tiny"
              title={folder && isDiary(folder) ? "Open today's page" : "New entry"}
              onClick={() => onNewEntry(folder ? folder.id : null)}
            >
              <Plus size={15} />
            </button>
            {folder && (
              <button
                className="icon-btn tiny"
                title="Folder menu"
                onClick={(ev) =>
                  setMenu({ kind: "folder", id: folder.id, x: ev.clientX, y: ev.clientY })
                }
              >
                <MoreHorizontal size={15} />
              </button>
            )}
          </div>
        </div>
        {open && (
          <div className="folder-entries">
            {groupEntries.length === 0 ? (
              <div className="empty-list small">Empty</div>
            ) : (
              groupEntries.map(renderEntry)
            )}
          </div>
        )}
      </div>
    );
  }

  function entryMenuItems(id: string): MenuItem[] {
    const entry = entries.find((e) => e.id === id);
    // Locked entries can't be renamed/moved without the password.
    if (entry?.locked) {
      return [{ label: "Delete", danger: true, onClick: () => onDelete(id) }];
    }
    return [
      {
        label: "Rename",
        onClick: () => entry && startRename(entry),
      },
      {
        label: "Move to…",
        // Keep the menu open and swap to the folder picker.
        keepOpen: true,
        onClick: () =>
          setMenu((m) => (m && m.kind === "entry" ? { ...m, stage: "move" } : m)),
      },
      { label: "Delete", danger: true, onClick: () => onDelete(id) },
    ];
  }

  function moveMenuItems(id: string): MenuItem[] {
    const entry = entries.find((e) => e.id === id);
    const items: MenuItem[] = [];
    if (entry?.folder_id) {
      items.push({ label: "↑ Notes", onClick: () => onMove(id, null) });
    }
    for (const f of folders) {
      if (entry?.folder_id === f.id) continue;
      items.push({ label: `→ ${f.name}`, onClick: () => onMove(id, f.id) });
    }
    if (items.length === 0) {
      items.push({ label: "No other folders", onClick: () => {}, disabled: true });
    }
    return items;
  }

  function folderMenuItems(folder: Folder): MenuItem[] {
    return [
      { label: "Settings", onClick: () => onFolderSettings(folder) },
      { label: "Progress", onClick: () => onFolderStats(folder) },
      { label: "Delete folder", danger: true, onClick: () => onDeleteFolder(folder) },
    ];
  }

  let menuItems: MenuItem[] = [];
  if (menu?.kind === "entry") {
    menuItems = menu.stage === "move" ? moveMenuItems(menu.id) : entryMenuItems(menu.id);
  } else if (menu?.kind === "folder") {
    const folder = folders.find((f) => f.id === menu.id);
    menuItems = folder ? folderMenuItems(folder) : [];
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">
          <span className="logo-f">f</span>
          <span className="brand-word">Folio</span>
        </div>
        <div className="sidebar-header-actions">
          <button className="icon-btn" title="New folder" onClick={onNewFolder}>
            <FolderPlus size={18} />
          </button>
          <button className="icon-btn" title="New entry" onClick={() => onNewEntry(null)}>
            <Plus size={18} />
          </button>
        </div>
      </div>

      <div className="entry-list">
        {folders.length === 0 && entries.length === 0 ? (
          <div className="empty-list">No entries yet. Start writing →</div>
        ) : (
          <>
            {folders.map((f) =>
              renderGroup(
                f.id,
                <span className="folder-label">
                  <FolderGlyph folder={f} /> {f.name}
                </span>,
                entriesIn(f.id),
                f
              )
            )}
            {notes.length > 0 &&
              renderGroup(
                "__notes__",
                <span className="folder-label">
                  <NotebookText size={15} /> Notes
                </span>,
                notes,
                null
              )}
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="ghost-btn" onClick={onOpenThemes} title="Themes">
          <Palette size={14} /> Themes
        </button>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={menuItems}
        />
      )}
    </aside>
  );
}
