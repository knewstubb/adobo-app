"use client";

import { useState } from "react";
import { setCredentials } from "@/lib/credential-store";
import { setSyncAreaPath } from "@/lib/idb-cache";

interface SetupFlowProps {
  onComplete: () => void;
}

export function SetupFlow({ onComplete }: SetupFlowProps) {
  const [org, setOrg] = useState("");
  const [project, setProject] = useState("");
  const [team, setTeam] = useState("");
  const [pat, setPat] = useState("");
  const [areaPath, setAreaPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setValidating(true);

    try {
      const res = await fetch(
        `https://dev.azure.com/${encodeURIComponent(org)}/_apis/projects/${encodeURIComponent(project)}?api-version=7.1`,
        {
          headers: {
            Authorization: `Basic ${btoa(":" + pat)}`,
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

      setCredentials({ org, project, team, pat });
      if (areaPath.trim()) {
        await setSyncAreaPath(areaPath.trim(), true);
      }
      onComplete();
    } catch {
      setError("Cannot reach Azure DevOps. Check your network connection.");
    } finally {
      setValidating(false);
    }
  }

  const isDisabled = !org.trim() || !project.trim() || !team.trim() || !pat.trim() || validating;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-app p-4">
      <div className="w-full max-w-md rounded-lg border border-border-default bg-surface-elevated p-8">
        <h1 className="mb-1 text-lg font-semibold text-text-primary">
          Connect to Azure DevOps
        </h1>
        <p className="mb-6 text-sm text-text-muted">
          Enter your ADO credentials to get started. All data stays in your browser.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Organisation */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="org" className="text-xs font-medium text-text-secondary">
              Organisation
            </label>
            <input
              id="org"
              type="text"
              className="linear-input"
              placeholder="my-org"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-text-muted">
              The name in your ADO URL: dev.azure.com/<strong>my-org</strong>
            </p>
          </div>

          {/* Project */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="project" className="text-xs font-medium text-text-secondary">
              Project
            </label>
            <input
              id="project"
              type="text"
              className="linear-input"
              placeholder="MyProject"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-text-muted">
              Found under your org in Azure DevOps → select a project from the list.
            </p>
          </div>

          {/* Team */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="team" className="text-xs font-medium text-text-secondary">
              Team
            </label>
            <input
              id="team"
              type="text"
              className="linear-input"
              placeholder="MyProject Team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-text-muted">
              Project Settings → Teams. Use the team name exactly as shown.
            </p>
          </div>

          {/* PAT */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="areaPath" className="text-xs font-medium text-text-secondary">
              Area Path
            </label>
            <input
              id="areaPath"
              type="text"
              className="linear-input"
              placeholder="Spark\Tribes\No Tribe\UbiQuity Teams\CX-AI Team"
              value={areaPath}
              onChange={(e) => setAreaPath(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-text-muted">
              Scopes the sync to your team&apos;s area. Use backslashes. Leave blank to fetch all (may be slow for large projects).
            </p>
          </div>

          {/* PAT */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pat" className="text-xs font-medium text-text-secondary">
              Personal Access Token
            </label>
            <input
              id="pat"
              type="password"
              className="linear-input"
              placeholder="••••••••••••"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-text-muted">
              User Settings → Personal Access Tokens → New Token. Needs Work Items (Read &amp; Write) scope.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isDisabled}
            className="linear-btn mt-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {validating ? "Validating…" : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
}
