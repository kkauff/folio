// Central place for app iconography (Lucide). Folders may be assigned any Lucide
// icon by name; `FolderGlyph` renders a folder's chosen icon, defaulting to a
// notebook when none is set.
import { icons, Notebook, type LucideIcon } from "lucide-react";
import type { Folder as FolderType } from "./api";

/** All assignable icon names (PascalCase), for the searchable picker. */
export const ALL_ICON_NAMES: string[] = Object.keys(icons);

/** Look up a Lucide icon component by name (undefined if unknown). */
export function iconByName(name: string | null | undefined): LucideIcon | undefined {
  return name ? (icons as Record<string, LucideIcon>)[name] : undefined;
}

/** The default folder glyph when no icon is chosen. */
export const DEFAULT_FOLDER_ICON: LucideIcon = Notebook;

/** Render a folder's glyph: its chosen icon, or the notebook default. */
export function FolderGlyph({
  folder,
  size = 15,
}: {
  folder: FolderType;
  size?: number;
}) {
  const Icon = iconByName(folder.icon) ?? DEFAULT_FOLDER_ICON;
  return <Icon size={size} />;
}
