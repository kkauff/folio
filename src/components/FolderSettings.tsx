import { useRef, useState } from "react";
import { Check, Lock, X } from "lucide-react";
import { verifyPassword, type Folder, type FolderSettings as Settings } from "../lib/api";
import { IconPicker } from "./IconPicker";
import { TypingDots } from "./TypingDots";

interface Props {
  /** The folder being edited, or null when creating a new one. */
  folder: Folder | null;
  /** Whether an app password already exists (enables "Change password"). */
  canChangePassword: boolean;
  onSave: (name: string, icon: string | null, settings: Settings) => void | Promise<void>;
  onChangePassword: (current: string, next: string) => Promise<void>;
  onClose: () => void;
}

/** Create/edit a folder: icon, name, diary settings, and encryption. */
export function FolderSettings({
  folder,
  canChangePassword,
  onSave,
  onChangePassword,
  onClose,
}: Props) {
  const [name, setName] = useState(folder?.name ?? "");
  const [icon, setIcon] = useState<string | null>(folder?.icon ?? null);
  const [autoDaily, setAutoDaily] = useState(
    folder?.settings.auto_daily_page ?? false
  );
  const [goal, setGoal] = useState<string>(
    folder?.settings.word_goal != null ? String(folder.settings.word_goal) : ""
  );
  const [encrypted, setEncrypted] = useState(folder?.settings.encrypted ?? false);
  const [saving, setSaving] = useState(false);

  // Change-password panel state.
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwDone, setPwDone] = useState(false);
  // null = unchecked; true/false = current password correct (checked on blur).
  const [curValid, setCurValid] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Single-flight guard: never run more than one password hash at a time.
  const verifyingRef = useRef(false);

  // Verify the current password once, when the field loses focus — never per
  // keystroke (the hash is deliberately expensive) and never concurrently.
  async function checkCurrentPassword() {
    if (verifyingRef.current || !curPw) return;
    verifyingRef.current = true;
    try {
      setCurValid(await verifyPassword(curPw));
    } catch {
      setCurValid(null); // backend hiccup → leave it to submit-time validation
    } finally {
      verifyingRef.current = false;
    }
  }

  // New password must be typed twice the same (and non-empty) — purely local.
  const confirmValid = confirmPw === "" ? null : newPw !== "" && newPw === confirmPw;
  const canSubmitPw =
    curPw !== "" && newPw !== "" && newPw === confirmPw && curValid !== false && !pwBusy;

  async function submitPwChange() {
    setPwError(null);
    setPwDone(false);
    if (!curPw) return setPwError("Enter your current password.");
    if (!newPw) return setPwError("Enter a new password.");
    if (newPw !== confirmPw) return setPwError("New passwords do not match.");
    setPwBusy(true);
    try {
      // The backend verifies the current password as part of the change.
      await onChangePassword(curPw, newPw);
      setPwDone(true);
      setPwOpen(false); // collapse the form once the password is updated
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (e) {
      setPwError(String(e));
      // A failed change is almost always a wrong current password.
      setCurValid(false);
    } finally {
      setPwBusy(false);
    }
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const parsedGoal = goal.trim() === "" ? null : Math.max(1, Number(goal));
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(trimmed, icon, {
        auto_daily_page: autoDaily,
        word_goal: Number.isFinite(parsedGoal as number) ? parsedGoal : null,
        encrypted,
      });
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal folder-settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{folder ? "Folder settings" : "New folder"}</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="folder-settings-body">
          <div className="field">
            <span>Name</span>
            <div className="name-row">
              <IconPicker value={icon} onChange={setIcon} />
              <input
                type="text"
                value={name}
                autoFocus
                placeholder="Folder name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") onClose();
                }}
              />
            </div>
          </div>

          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={autoDaily}
              onChange={(e) => setAutoDaily(e.target.checked)}
            />
            <span>New File Per Day</span>
          </label>

          <label className="field">
            <span>Daily word goal</span>
            <input
              type="number"
              min={1}
              value={goal}
              placeholder="Off"
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>

          <button
            type="button"
            className={`encrypt-btn ${encrypted ? "active" : ""}`}
            onClick={() => setEncrypted((v) => !v)}
          >
            <Lock size={16} />
            <span className="encrypt-btn-text">
              {encrypted ? "Encrypted & password protected" : "Encrypt & password protect"}
              <span className="hint inline-hint">
                {encrypted
                  ? "Contents are sealed on disk; your password is required to open."
                  : "Seal this folder's contents on disk behind your password."}
              </span>
            </span>
            {encrypted && <Check size={18} className="encrypt-check" />}
          </button>

          {encrypted && canChangePassword && (
            <div className="pw-change">
              {!pwOpen ? (
                <div className="pw-change-collapsed">
                  {pwDone && <span className="pw-done">Password updated.</span>}
                  <button
                    type="button"
                    className="link pw-change-toggle"
                    onClick={() => {
                      setPwOpen(true);
                      setPwDone(false);
                      setPwError(null);
                    }}
                  >
                    Change password
                  </button>
                </div>
              ) : (
                <div className="pw-change-form">
                  <label className="field">
                    <span>Current password</span>
                    <input
                      type="password"
                      className={curValid === true ? "valid" : curValid === false ? "invalid" : ""}
                      value={curPw}
                      autoFocus
                      onChange={(e) => {
                        setCurPw(e.target.value);
                        setCurValid(null);
                      }}
                      onBlur={checkCurrentPassword}
                    />
                  </label>
                  <label className="field">
                    <span>New password</span>
                    <input
                      type="password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Confirm new password</span>
                    <input
                      type="password"
                      className={
                        confirmValid === true ? "valid" : confirmValid === false ? "invalid" : ""
                      }
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                    />
                  </label>
                  {pwError && <div className="error">{pwError}</div>}
                  {pwDone && <div className="pw-done">Password updated.</div>}
                  <div className="pw-change-actions">
                    {pwBusy && <TypingDots label="Updating password" />}
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setPwOpen(false);
                        setPwError(null);
                        setPwDone(false);
                      }}
                      disabled={pwBusy}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={submitPwChange}
                      disabled={!canSubmitPw}
                    >
                      Update password
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {saveError && <div className="error">{saveError}</div>}

          <div className="folder-settings-actions">
            {saving && <TypingDots label="Saving" />}
            <button className="link" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={save}
              disabled={!name.trim() || saving}
            >
              {folder ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
