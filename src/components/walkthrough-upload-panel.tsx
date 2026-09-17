"use client";

import { useEffect, useMemo, useState } from "react";
import { fileValidationMessage, MAX_WALKTHROUGH_UPLOAD_BYTES } from "@/lib/walkthroughs/upload-policy";

type Project = { id: string; name: string };
type Run = { id: string; status: string; retryCount: number; errorMessage: string | null };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "The request failed.");
  return body;
}

function uploadWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (value: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("The media upload failed."));
    request.onerror = () => reject(new Error("The media upload could not reach private storage."));
    request.send(file);
  });
}

export function WalkthroughUploadPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [walkthroughId, setWalkthroughId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [uploadIntentKey, setUploadIntentKey] = useState<string | null>(null);

  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId), [projects, projectId]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/projects")
      .then((response) => readJson<{ projects: Project[] }>(response))
      .then((result) => {
        if (cancelled) return;
        setProjects(result.projects);
        if (result.projects[0]) setProjectId(result.projects[0].id);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Projects could not be loaded.");
      })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function createProject() {
    setError(null);
    try {
      const result = await readJson<{ project: Project }>(await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newProjectName }) }));
      setProjects((current) => [result.project, ...current]);
      setProjectId(result.project.id);
      setUploadIntentKey(null);
      setNewProjectName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The project could not be created.");
    }
  }

  async function startUpload() {
    if (!projectId || !file) return;
    const fileError = fileValidationMessage(file);
    if (fileError) { setError(fileError); return; }
    const idempotencyKey = uploadIntentKey ?? crypto.randomUUID();
    if (!uploadIntentKey) setUploadIntentKey(idempotencyKey);
    setBusy(true); setError(null); setMessage("Preparing a private upload…"); setProgress(0); setRun(null);
    try {
      const intent = await readJson<{ walkthroughId: string; uploadUrl: string | null; requiredHeaders: Record<string, string> }>(await fetch(`/api/projects/${projectId}/walkthroughs/upload-intent`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, byteSize: file.size, idempotencyKey }),
      }));
      setWalkthroughId(intent.walkthroughId);
      if (!intent.uploadUrl) {
        const existing = await readJson<{ run: Run | null }>(await fetch(`/api/walkthroughs/${intent.walkthroughId}/status`, { cache: "no-store" }));
        setRun(existing.run);
        setMessage("This upload intent is already finalized; no new browser upload URL was issued.");
        return;
      }
      setMessage("Uploading directly to private storage…");
      await uploadWithProgress(intent.uploadUrl, file, intent.requiredHeaders, setProgress);
      setMessage("Verifying the upload and queueing processing…");
      const finalized = await readJson<{ run: Run }>(await fetch(`/api/walkthroughs/${intent.walkthroughId}/finalize`, { method: "POST" }));
      setRun(finalized.run);
      setMessage("The walkthrough is queued. Livepeer processing will be attached by the next pipeline issue.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The walkthrough could not be uploaded.");
      setMessage(null);
    } finally { setBusy(false); }
  }

  async function retryProcessing() {
    if (!walkthroughId) return;
    setBusy(true); setError(null);
    try {
      const result = await readJson<{ run: Run }>(await fetch(`/api/walkthroughs/${walkthroughId}/retry`, { method: "POST" }));
      setRun(result.run); setMessage("The processing run was queued again.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The run could not be retried."); }
    finally { setBusy(false); }
  }

  return (
    <section className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-[1fr_1.2fr]" aria-label="Upload a walkthrough">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Project context</p>
          <h2 className="mt-1 text-xl font-semibold">Start a site walkthrough</h2>
        </div>
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Existing project
          <select value={projectId} onChange={(event) => { setProjectId(event.target.value); setUploadIntentKey(null); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2" disabled={busy || projectsLoading}>
            <option value="">Select a project</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        {projectsLoading && <p className="text-sm text-slate-500" role="status">Loading projects…</p>}
        <div className="flex gap-2">
          <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="New project name" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled={busy} />
          <button type="button" onClick={() => void createProject()} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !newProjectName.trim()}>Create</button>
        </div>
        <p className="text-sm text-slate-600">Upload boundary: MP4 video only, up to {Math.round(MAX_WALKTHROUGH_UPLOAD_BYTES / 1024 / 1024)} MiB. Codec and duration are not validated at this boundary.</p>
      </div>
      <div className="space-y-4">
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Walkthrough video
          <input type="file" accept="video/mp4,.mp4" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setUploadIntentKey(null); }} className="block w-full rounded-lg border border-slate-300 p-3 text-sm" disabled={busy} />
        </label>
        {file && <p className="text-sm text-slate-600">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
        <button type="button" onClick={() => void startUpload()} disabled={busy || !selectedProject || !file} className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Working…" : "Upload walkthrough"}</button>
        {progress > 0 && progress < 100 && <progress value={progress} max={100} className="h-2 w-full" aria-label={`Upload ${progress}% complete`} />}
        {message && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700" role="status">{message}</p>}
        {run?.status === "PROCESSING_FAILED" && <button type="button" onClick={() => void retryProcessing()} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Retry processing</button>}
        {run && <p className="text-sm font-medium text-slate-700">Run status: <span className="font-mono">{run.status}</span>{walkthroughId && <> · <a className="underline" href={`/walkthroughs/${walkthroughId}`}>Open status page</a></>}</p>}
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      </div>
    </section>
  );
}
