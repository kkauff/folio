import { useState } from "react";
import { Lock } from "lucide-react";
import { TypingDots } from "./TypingDots";

interface Props {
  /** "set" creates the shared app password; "unlock" enters the existing one. */
  mode: "set" | "unlock";
  /** Resolve to accept (parent then closes); throw to show an error. */
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Modal for the app password that protects encrypted folders. Used the first
 * time encryption is enabled ("set") and whenever an encrypted folder is opened
 * while locked ("unlock").
 */
export function PasswordPrompt({ mode, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "set") {
      if (!password) {
        setError("Enter a password.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
    }
    setBusy(true);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal unlock-card" onClick={(e) => e.stopPropagation()}>
        <div className="brand">
          <span className="brand-mark">
            <Lock size={28} />
          </span>
          <h1>{mode === "set" ? "Set a password" : "Unlock"}</h1>
          <p className="brand-tagline">
            {mode === "set"
              ? "Protects your encrypted folders."
              : "Enter your password to open encrypted folders."}
          </p>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "set" ? "Choose a strong password" : "Enter your password"}
            />
          </label>

          {mode === "set" && (
            <>
              <label className="field">
                <span>Confirm password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                />
              </label>
              <div className="notice">
                This password encrypts the folders you protect. There is no
                recovery — if you forget it, those folders cannot be opened.
              </div>
            </>
          )}

          {error && <div className="error">{error}</div>}

          {busy && (
            <div className="prompt-busy">
              <TypingDots label={mode === "set" ? "Setting password" : "Unlocking"} />
            </div>
          )}

          <button type="submit" className="primary" disabled={busy || !password}>
            {mode === "set" ? "Set password" : "Unlock"}
          </button>
          <button type="button" className="link" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
