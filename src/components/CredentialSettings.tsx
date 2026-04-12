"use client";

import { useState } from "react";
import { getCredentials, setCredentials, clearCredentials } from "@/lib/credential-store";
import { X } from "@phosphor-icons/react";

interface CredentialSettingsProps {
  onDisconnect: () => void;
  onClose: () => void;
}

export function CredentialSettings({ onDisconnect, onClose }: CredentialSettingsProps) {
  const creds = getCredentials();
  const [editing, setEditing] = useState(false);
  const [org, setOrg] = useState(creds?.org ?? "");
  const [project, setProject] = useState(creds?.project ?? "");
  const [team, setTeam] = useState(creds?.team ?? "");
  const [pat, setPat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setValidating(true);

    const newPat = pat.trim() || creds?.pat || "";

    try {
      const res = await fetch(
        `https://dev.azure.com/${encodeURIComponent(org)}/_apis/projects/${encodeURIComponent(project)}?api-version=7.1`,
        {
          headers: {
            Authorization: `Basic ${btoa(":" + newPat)}`,
          },
        }
      );

      if (res.status === 401) {
        setError("Invalid Personal Access Token. Check that the token hasn't expired and has the required scopes.");
        return;
      }
      if (res.status === 403) {
        setError("Insufficient permissions. The PAT needs Work Items (Read & Write) scope.");
        return;
      }
      if (res.status === 404) {
        setError("Project not found. Verify the organisation and project names.");
        return;
      }
      if (!res.ok) {
        setError(`Validation failed: ${res.status} ${res.statusText}`);
        return;
      }

      setCredentials({ org, project, team, pat: newPat });
      setEditing(false);
      setPat("");
      setError(null);
    } catch {
      setError("Cannot reach Azure DevOps. Check your network connection.");
    } finally {
      setValidating(false);
    }
  }

  function handleDisconnect() {
    clearCredentials();
    onDisconnect();
  }

  function handleStartEdit() {
    const current = getCredentials();
    setOrg(current?.org ?? "");
    setProject(current?.project ?? "");
    setTeam(current?.team ?? "");
    setPat("");
    setError(null);
    setEditing(true);
  }

  const isUpdateDisabled = !org.trim() || !project.trim() || !team.trim() || validating;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Credential settings"
    >
      <div className="w-full max-w-md rounded-lg border border-border-modal bg-surface-elevated shadow-xl animate-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <h2 className="text-sm font-semibold text-text-primary">ADO Connection</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-surface-button linear-btn"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4">
          {!editing ? (
            /* View mode — show current credentials */
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Organisation</span>
                  <span className="text-xs text-text-secondary">{creds?.org ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Project</span>
                  <span className="text-xs text-text-secondary">{creds?.project ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Team</span>
                  <span className="text-xs text-text-secondary">{creds?.team ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Personal Access Token</span>
                  <span className="text-xs text-text-secondary font-mono">••••••••</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-border-default">
                <button
                  onClick={handleStartEdit}
                  className="flex-1 rounded-md border border-border-button bg-surface-button px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary linear-btn"
                >
                  Update
                </button>
                <button
                  onClick={handleDisconnect}
                  className="flex-1 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 linear-btn"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            /* Edit mode — update credentials form */
            <form onSubmit={handleUpdate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cred-org" className="text-xs font-medium text-text-secondary">
                  Organisation
                </label>
                <input
                  id="cred-org"
                  type="text"
                  className="linear-input"
                  placeholder="my-org"
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="cred-project" className="text-xs font-medium text-text-secondary">
                  Project
                </label>
                <input
                  id="cred-project"
                  type="text"
                  className="linear-input"
                  placeholder="MyProject"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="cred-team" className="text-xs font-medium text-text-secondary">
                  Team
                </label>
                <input
                  id="cred-team"
                  type="text"
                  className="linear-input"
                  placeholder="MyProject Team"
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="cred-pat" className="text-xs font-medium text-text-secondary">
                  Personal Access Token
                </label>
                <input
                  id="cred-pat"
                  type="password"
                  className="linear-input"
                  placeholder="Leave blank to keep current PAT"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-xs text-text-muted">
                  Leave blank to keep your existing token.
                </p>
              </div>

              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setEditing(false); setError(null); }}
                  className="flex-1 rounded-md border border-border-button bg-surface-button px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary linear-btn"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdateDisabled}
                  className="flex-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 linear-btn"
                >
                  {validating ? "Validating…" : "Save"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
