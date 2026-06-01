import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Github, Search, ChevronLeft, Lock, Globe, File, Loader2,
  X, KeyRound, ExternalLink, Copy, CheckCircle2, FolderOpen,
  MessageSquare, GitPullRequest, GitCommit, RefreshCw, Plus,
  Trash2, Eye, EyeOff, GitBranch, Upload, Download, Diff,
  ChevronDown, AlertCircle, Check,
} from "lucide-react";

interface CodePanelProps {
  onLoadFile: (filename: string, content: string) => void;
  onOpenRepoChat: (fullName: string, owner: string, repo: string, files: string[]) => void;
}

interface Repo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  language: string | null;
  updated_at: string;
  default_branch: string;
}

interface FileNode {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

type AuthMethod = "pat" | "oauth";

const GH_TOKEN_KEY = "github_token";
const GH_CLIENT_ID_KEY = "github_client_id";

async function ghFetch(url: string, token: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const msg = (body.message as string) || res.statusText;
    if (res.status === 401) throw new Error("Invalid or expired token. Please reconnect.");
    if (res.status === 403) throw new Error(`Access denied: ${msg}`);
    throw new Error(msg || `GitHub error ${res.status}`);
  }
  return res.json();
}

async function ghPut(url: string, token: string, body: object) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.message as string) || `GitHub error ${res.status}`);
  return data;
}

async function ghDelete(url: string, token: string, body: object) {
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.message as string) || `GitHub error ${res.status}`);
  return data;
}

function toBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}
function fromBase64(b64: string): string {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
}

// ── Simple unified diff ───────────────────────────────────────────────────────
interface DiffLine { type: "add" | "del" | "ctx"; text: string; }

function computeDiff(original: string, edited: string): DiffLine[] {
  if (original === edited) return [];
  const a = original.split("\n");
  const b = edited.split("\n");
  // LCS-based diff (simple O(n²) — good enough for files < 2000 lines)
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const lines: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { lines.push({ type: "ctx", text: a[i] }); i++; j++; }
    else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) { lines.push({ type: "add", text: b[j] }); j++; }
    else { lines.push({ type: "del", text: a[i] }); i++; }
  }
  return lines;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function CodePanel({ onLoadFile, onOpenRepoChat }: CodePanelProps) {
  const [token, setToken] = useState<string>(() => localStorage.getItem(GH_TOKEN_KEY) || "");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("pat");
  const [patInput, setPatInput] = useState("");
  const [clientIdInput, setClientIdInput] = useState<string>(() => localStorage.getItem(GH_CLIENT_ID_KEY) || "");
  const [oauthStep, setOauthStep] = useState<"idle" | "polling">("idle");
  const [deviceData, setDeviceData] = useState<{ user_code: string; verification_uri: string; device_code: string; interval: number } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [repos, setRepos] = useState<Repo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [gitUser, setGitUser] = useState<string>("");

  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadingFileSha, setLoadingFileSha] = useState<string | null>(null);
  const [openingRepoPk, setOpeningRepoPk] = useState<number | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [pullSuccess, setPullSuccess] = useState(false);

  // Branch state
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState("HEAD");
  const [showBranchPicker, setShowBranchPicker] = useState(false);

  // Editor state
  const [editingFile, setEditingFile] = useState<FileNode | null>(null);
  const [editContent, setEditContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [fileSha, setFileSha] = useState(""); // latest sha from GitHub
  const [commitMessage, setCommitMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  // New file state
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");

  // Delete state
  const [deletingFile, setDeletingFile] = useState<FileNode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => { if (token) fetchRepos(token); }, [token]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const fetchRepos = async (t: string) => {
    setIsLoadingRepos(true); setRepoError(null);
    try {
      const user = await ghFetch("https://api.github.com/user", t) as { login: string };
      setGitUser(user.login);
      const data = await ghFetch("https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator", t) as Repo[];
      setRepos(data);
    } catch (err: unknown) {
      setRepoError(err instanceof Error ? err.message : "Unknown error");
    } finally { setIsLoadingRepos(false); }
  };

  const fetchBranches = async (repo: Repo) => {
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/branches?per_page=100`, token) as { name: string }[];
      setBranches(data.map(b => b.name));
      setCurrentBranch(repo.default_branch || "main");
    } catch {}
  };

  const loadFiles = useCallback(async (repo: Repo, branch?: string) => {
    const ref = branch || currentBranch;
    setIsLoadingFiles(true); setFileError(null);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/git/trees/${ref}?recursive=1`, token) as { tree: FileNode[] };
      const blobs = data.tree.filter((n) => n.type === "blob").sort((a, b) => a.path.localeCompare(b.path));
      setFiles(blobs);
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "Failed to load files");
    } finally { setIsLoadingFiles(false); }
  }, [token, currentBranch]);

  const handlePatConnect = () => {
    const t = patInput.trim(); if (!t) return;
    localStorage.setItem(GH_TOKEN_KEY, t);
    window.dispatchEvent(new Event("github-token-changed"));
    setToken(t); setPatInput("");
  };

  const handleDisconnect = () => {
    localStorage.removeItem(GH_TOKEN_KEY);
    window.dispatchEvent(new Event("github-token-changed"));
    setToken(""); setRepos([]); setSelectedRepo(null); setFiles([]);
    setRepoError(null); setGitUser(""); setOauthStep("idle"); setDeviceData(null);
    setEditingFile(null); setBranches([]); setCurrentBranch("HEAD");
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const handleStartOAuth = async () => {
    const cid = clientIdInput.trim(); if (!cid) return;
    localStorage.setItem(GH_CLIENT_ID_KEY, cid); setRepoError(null);
    try {
      const res = await fetch("/api/github/device/code", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: cid }),
      });
      const data = await res.json() as { user_code?: string; verification_uri?: string; device_code?: string; interval?: number; error?: string };
      if (data.error || !data.user_code) throw new Error(data.error || "Failed to start OAuth");
      setDeviceData({ user_code: data.user_code!, verification_uri: data.verification_uri!, device_code: data.device_code!, interval: data.interval || 5 });
      setOauthStep("polling");
      startPolling(cid, data.device_code!, data.interval || 5);
    } catch (err: unknown) { setRepoError(err instanceof Error ? err.message : "Failed to start OAuth flow"); }
  };

  const startPolling = (cid: string, deviceCode: string, interval: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/github/device/token", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: cid, deviceCode }),
        });
        const data = await res.json() as { access_token?: string; error?: string };
        if (data.access_token) {
          clearInterval(pollRef.current!); pollRef.current = null;
          localStorage.setItem(GH_TOKEN_KEY, data.access_token);
          window.dispatchEvent(new Event("github-token-changed"));
          setToken(data.access_token); setOauthStep("idle"); setDeviceData(null);
        }
      } catch {}
    }, interval * 1000);
  };

  const cancelOAuth = () => { if (pollRef.current) clearInterval(pollRef.current); setOauthStep("idle"); setDeviceData(null); };
  const copyCode = () => { if (deviceData) { navigator.clipboard.writeText(deviceData.user_code); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); } };

  const handleOpenRepoInChat = async (repo: Repo) => {
    setOpeningRepoPk(repo.id); setRepoError(null);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/git/trees/HEAD?recursive=1`, token) as { tree: FileNode[] };
      const fileList = data.tree.filter((n) => n.type === "blob").sort((a, b) => a.path.localeCompare(b.path)).map((f) => f.path);
      onOpenRepoChat(repo.full_name, repo.owner.login, repo.name, fileList);
    } catch (err: unknown) { setRepoError(err instanceof Error ? err.message : "Failed to load repo"); }
    finally { setOpeningRepoPk(null); }
  };

  const handleSelectRepo = async (repo: Repo) => {
    setSelectedRepo(repo); setFiles([]); setFileError(null); setEditingFile(null); setCurrentBranch(repo.default_branch || "main");
    fetchBranches(repo);
    setIsLoadingFiles(true);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch || "HEAD"}?recursive=1`, token) as { tree: FileNode[] };
      setFiles(data.tree.filter((n) => n.type === "blob").sort((a, b) => a.path.localeCompare(b.path)));
    } catch (err: unknown) { setFileError(err instanceof Error ? err.message : "Failed to load files"); }
    finally { setIsLoadingFiles(false); }
  };

  const handleSwitchBranch = async (branch: string) => {
    setCurrentBranch(branch); setShowBranchPicker(false); setEditingFile(null);
    await loadFiles(selectedRepo!, branch);
  };

  const handlePull = async () => {
    setIsPulling(true); setPullSuccess(false);
    try {
      await loadFiles(selectedRepo!, currentBranch);
      if (editingFile) await openEditor(editingFile);
      setPullSuccess(true); setTimeout(() => setPullSuccess(false), 2000);
    } finally { setIsPulling(false); }
  };

  const openEditor = async (file: FileNode) => {
    if (file.size && file.size > 200 * 1024) { setFileError("File too large to edit (> 200KB)"); return; }
    setLoadingFileSha(file.sha); setSaveError(null);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${selectedRepo!.full_name}/contents/${encodeURIComponent(file.path)}?ref=${currentBranch}`, token) as { sha: string; content: string; encoding: string };
      const content = data.encoding === "base64" ? fromBase64(data.content) : (data.content as string);
      setFileSha(data.sha);
      setEditingFile(file);
      setEditContent(content);
      setOriginalContent(content);
      setCommitMessage(`Update ${file.path}`);
      setShowDiff(false);
      setSaveSuccess(false);
    } catch (err: unknown) { setFileError(err instanceof Error ? err.message : "Failed to load file"); }
    finally { setLoadingFileSha(null); }
  };

  const handleCommit = async () => {
    if (!editingFile || !selectedRepo) return;
    setIsSaving(true); setSaveError(null); setSaveSuccess(false);
    try {
      const branch = currentBranch === "HEAD" ? selectedRepo.default_branch : currentBranch;
      await ghPut(
        `https://api.github.com/repos/${selectedRepo.full_name}/contents/${encodeURIComponent(editingFile.path)}`,
        token,
        { message: commitMessage || `Update ${editingFile.path}`, content: toBase64(editContent), sha: fileSha, branch },
      );
      setOriginalContent(editContent);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      // Refresh file tree to update SHAs
      loadFiles(selectedRepo, currentBranch);
    } catch (err: unknown) { setSaveError(err instanceof Error ? err.message : "Commit failed"); }
    finally { setIsSaving(false); }
  };

  const handleCreateFile = async () => {
    if (!newFilePath.trim() || !selectedRepo) return;
    setIsSaving(true); setSaveError(null);
    try {
      const branch = currentBranch === "HEAD" ? selectedRepo.default_branch : currentBranch;
      await ghPut(
        `https://api.github.com/repos/${selectedRepo.full_name}/contents/${encodeURIComponent(newFilePath.trim())}`,
        token,
        { message: `Create ${newFilePath.trim()}`, content: toBase64(""), branch },
      );
      setCreatingFile(false); setNewFilePath("");
      await loadFiles(selectedRepo, currentBranch);
    } catch (err: unknown) { setSaveError(err instanceof Error ? err.message : "Failed to create file"); }
    finally { setIsSaving(false); }
  };

  const handleDeleteFile = async (file: FileNode) => {
    if (!selectedRepo) return;
    setIsDeleting(true); setSaveError(null);
    try {
      const branch = currentBranch === "HEAD" ? selectedRepo.default_branch : currentBranch;
      await ghDelete(
        `https://api.github.com/repos/${selectedRepo.full_name}/contents/${encodeURIComponent(file.path)}`,
        token,
        { message: `Delete ${file.path}`, sha: file.sha, branch },
      );
      setDeletingFile(null);
      if (editingFile?.path === file.path) setEditingFile(null);
      await loadFiles(selectedRepo, currentBranch);
    } catch (err: unknown) { setSaveError(err instanceof Error ? err.message : "Failed to delete file"); }
    finally { setIsDeleting(false); }
  };

  const isDirty = editContent !== originalContent;
  const diffLines = showDiff ? computeDiff(originalContent, editContent) : [];

  // ── Auth view ───────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-disconnected">
        <div className="p-4 border-b border-sidebar-border">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Github className="h-4 w-4 text-primary" />Connect GitHub</h3>
        </div>
        <div className="flex border-b border-sidebar-border">
          <button onClick={() => setAuthMethod("pat")} className={`flex-1 py-2 text-xs font-medium transition-colors ${authMethod === "pat" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`} data-testid="auth-tab-pat">
            <KeyRound className="h-3 w-3 inline mr-1" />Access Token
          </button>
          <button onClick={() => setAuthMethod("oauth")} className={`flex-1 py-2 text-xs font-medium transition-colors ${authMethod === "oauth" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`} data-testid="auth-tab-oauth">
            <Github className="h-3 w-3 inline mr-1" />OAuth App
          </button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {repoError && <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20">{repoError}</div>}
            {authMethod === "pat" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Generate a token with <strong>repo</strong> scope for private repos.</p>
                <Input type="password" placeholder="ghp_... or github_pat_..." value={patInput} onChange={(e) => setPatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePatConnect()} className="h-9 text-xs font-mono" data-testid="github-pat-input" autoComplete="off" />
                <Button onClick={handlePatConnect} className="w-full h-9 text-xs font-medium" disabled={!patInput.trim()} data-testid="github-connect-btn">Connect</Button>
                <a href="https://github.com/settings/tokens/new?scopes=repo,read:user" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors justify-center">
                  <ExternalLink className="h-3 w-3" />Generate token on GitHub
                </a>
              </div>
            )}
            {authMethod === "oauth" && oauthStep === "idle" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Create a GitHub OAuth App at <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer" className="text-primary underline">github.com/settings/applications/new</a> — no redirect URI needed.</p>
                <Input placeholder="Client ID" value={clientIdInput} onChange={(e) => setClientIdInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleStartOAuth()} className="h-9 text-xs font-mono" data-testid="github-client-id-input" />
                <Button onClick={handleStartOAuth} className="w-full h-9 text-xs font-medium" disabled={!clientIdInput.trim()} data-testid="github-oauth-start-btn">
                  <Github className="h-4 w-4 mr-2" />Authorize with GitHub
                </Button>
              </div>
            )}
            {authMethod === "oauth" && oauthStep === "polling" && deviceData && (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3 text-center">
                  <p className="text-xs text-muted-foreground">Enter this code on GitHub:</p>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-2xl font-mono font-bold tracking-widest text-primary">{deviceData.user_code}</span>
                    <button onClick={copyCode} className="text-muted-foreground hover:text-primary transition-colors" data-testid="copy-device-code">
                      {codeCopied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <a href={deviceData.verification_uri} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 text-xs text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" />{deviceData.verification_uri}
                  </a>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />Waiting for authorization...
                </div>
                <Button variant="ghost" size="sm" className="w-full text-xs" onClick={cancelOAuth} data-testid="cancel-oauth-btn">Cancel</Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // ── File editor view ────────────────────────────────────────────────────────
  if (editingFile) {
    return (
      <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-editor">
        {/* Editor header */}
        <div className="px-3 py-1.5 border-b border-sidebar-border shrink-0 space-y-1">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-1 text-[10px] text-muted-foreground -ml-1 gap-0.5"
              onClick={() => setEditingFile(null)}>
              <ChevronLeft className="h-3 w-3" /> Files
            </Button>
            <span className="text-[10px] text-muted-foreground/40">·</span>
            <span className="text-[10px] text-primary/80 font-mono truncate flex-1">{editingFile.path}</span>
            {isDirty && <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded-full border border-amber-500/20 shrink-0">unsaved</span>}
          </div>
        </div>

        {saveError && (
          <div className="mx-3 mt-1.5 p-2 text-[10px] bg-destructive/10 text-destructive rounded border border-destructive/20 flex items-start gap-1.5 shrink-0">
            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />{saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="mx-3 mt-1.5 p-2 text-[10px] bg-green-500/10 text-green-400 rounded border border-green-500/20 flex items-center gap-1.5 shrink-0">
            <Check className="h-3 w-3" />Committed successfully
          </div>
        )}

        {/* Diff toggle */}
        <div className="flex items-center gap-1 px-3 py-1 border-b border-sidebar-border/50 shrink-0">
          <button
            onClick={() => setShowDiff(d => !d)}
            className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors ${showDiff ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Diff className="h-3 w-3" />{showDiff ? "Diff" : "Diff"}
          </button>
          <span className="ml-auto text-[9px] text-muted-foreground/50 font-mono">{editContent.split("\n").length} lines</span>
        </div>

        {showDiff ? (
          /* Diff view */
          <ScrollArea className="flex-1 min-h-0">
            {diffLines.length === 0 ? (
              <div className="py-8 text-center text-[10px] text-muted-foreground">No changes</div>
            ) : (
              <div className="font-mono text-[10.5px] leading-5">
                {diffLines.map((line, i) => (
                  <div key={i} className={`px-3 flex ${
                    line.type === "add" ? "bg-green-500/8 text-green-400" :
                    line.type === "del" ? "bg-red-500/8 text-red-400 line-through opacity-60" :
                    "text-muted-foreground/50"
                  }`}>
                    <span className="w-3 shrink-0 select-none opacity-70">
                      {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                    </span>
                    <span className="whitespace-pre break-all">{line.text || " "}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        ) : (
          /* Edit view */
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="flex-1 min-h-0 w-full font-mono text-[11px] leading-5 bg-transparent resize-none outline-none border-0 p-3 text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            data-testid="editor-textarea"
          />
        )}

        {/* Commit bar */}
        <div className="border-t border-sidebar-border/50 p-2 space-y-2 shrink-0 glass">
          <Input
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message…"
            className="h-7 text-[11px] font-mono bg-background/50 border-border/50"
            onKeyDown={(e) => e.key === "Enter" && !isSaving && isDirty && handleCommit()}
            data-testid="commit-message-input"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="flex-1 h-7 text-[11px] gap-1 glossy relative overflow-hidden"
              disabled={!isDirty || isSaving || !commitMessage.trim()}
              onClick={handleCommit}
              data-testid="commit-btn"
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCommit className="h-3 w-3" />}
              {isSaving ? "Pushing…" : "Commit & Push"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 border-border/50"
              onClick={handlePull}
              disabled={isPulling}
              title="Pull latest from remote"
              data-testid="pull-btn"
            >
              {isPulling ? <Loader2 className="h-3 w-3 animate-spin" /> :
               pullSuccess ? <Check className="h-3 w-3 text-green-400" /> :
               <Download className="h-3 w-3" />}
            </Button>
            {isDirty && (
              <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={() => setEditContent(originalContent)} title="Discard changes">
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <p className="text-[9px] text-muted-foreground/50 text-center">Commits directly to <span className="font-mono">{currentBranch}</span></p>
        </div>
      </div>
    );
  }

  // ── File browser view ────────────────────────────────────────────────────────
  if (selectedRepo) {
    return (
      <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-file-browser">
        {/* Repo header */}
        <div className="px-3 py-1.5 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-1 mb-1">
            <Button variant="ghost" size="sm" className="h-6 px-1 text-[10px] text-muted-foreground -ml-1 gap-0.5"
              onClick={() => { setSelectedRepo(null); setFiles([]); setFileError(null); setBranches([]); }} data-testid="back-to-repos-btn">
              <ChevronLeft className="h-3 w-3" /> Repos
            </Button>
            <span className="text-[10px] font-semibold truncate flex-1">{selectedRepo.name}</span>
          </div>

          {/* Branch picker + actions */}
          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <button
                onClick={() => setShowBranchPicker(b => !b)}
                className="flex items-center gap-1 h-6 px-2 rounded border border-border/50 glass text-[10px] w-full"
                data-testid="branch-picker-btn"
              >
                <GitBranch className="h-3 w-3 text-primary/70 shrink-0" />
                <span className="truncate flex-1 text-left">{currentBranch}</span>
                <ChevronDown className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              </button>
              {showBranchPicker && branches.length > 0 && (
                <div className="absolute top-7 left-0 z-20 w-full rounded-md border border-border glass shadow-lg overflow-hidden">
                  <ScrollArea className="max-h-40">
                    {branches.map(b => (
                      <button
                        key={b}
                        onClick={() => handleSwitchBranch(b)}
                        className={`flex items-center gap-2 w-full px-2 py-1 text-[10px] hover:bg-sidebar-accent/50 ${b === currentBranch ? "text-primary font-medium" : "text-muted-foreground"}`}
                      >
                        {b === currentBranch && <Check className="h-2.5 w-2.5 shrink-0" />}
                        <span className="truncate">{b}</span>
                      </button>
                    ))}
                  </ScrollArea>
                </div>
              )}
            </div>

            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Pull / Refresh" onClick={handlePull} disabled={isPulling} data-testid="refresh-btn">
              {isPulling ? <Loader2 className="h-3 w-3 animate-spin" /> :
               pullSuccess ? <Check className="h-3 w-3 text-green-400" /> :
               <RefreshCw className="h-3 w-3" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="New file" onClick={() => setCreatingFile(c => !c)} data-testid="new-file-btn">
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {/* New file input */}
          {creatingFile && (
            <div className="flex gap-1 mt-1">
              <Input
                autoFocus
                value={newFilePath}
                onChange={e => setNewFilePath(e.target.value)}
                placeholder="path/to/newfile.ts"
                className="h-6 text-[10px] font-mono flex-1 bg-background/50"
                onKeyDown={e => { if (e.key === "Enter") handleCreateFile(); if (e.key === "Escape") { setCreatingFile(false); setNewFilePath(""); } }}
                data-testid="new-file-input"
              />
              <Button size="sm" className="h-6 px-2 text-[10px]" onClick={handleCreateFile} disabled={!newFilePath.trim() || isSaving}>
                {isSaving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Create"}
              </Button>
            </div>
          )}
        </div>

        {(fileError || saveError) && (
          <div className="mx-2 mt-1.5 p-2 text-[10px] bg-destructive/10 text-destructive rounded border border-destructive/20 shrink-0">
            {fileError || saveError}
          </div>
        )}

        {/* Delete confirm dialog */}
        {deletingFile && (
          <div className="mx-2 mt-1.5 p-2 text-[10px] rounded border border-destructive/30 bg-destructive/5 shrink-0 space-y-2">
            <p>Delete <span className="font-mono text-destructive">{deletingFile.path}</span>?</p>
            <div className="flex gap-1">
              <Button size="sm" variant="destructive" className="h-6 text-[10px] flex-1" onClick={() => handleDeleteFile(deletingFile)} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Delete"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setDeletingFile(null)}>Cancel</Button>
            </div>
          </div>
        )}

        <ScrollArea className="flex-1" onClick={() => setShowBranchPicker(false)}>
          <div className="p-2 space-y-0.5">
            {isLoadingFiles ? (
              <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : files.length === 0 ? (
              <div className="py-8 text-center text-[10px] text-muted-foreground">No files found</div>
            ) : (
              files.map((file) => (
                <div key={file.path} className="flex items-center justify-between group p-1.5 hover:bg-sidebar-accent/50 rounded-md" data-testid={`file-row-${file.sha}`}>
                  <button
                    className="flex items-center gap-1.5 overflow-hidden flex-1 text-left"
                    onClick={() => openEditor(file)}
                    disabled={loadingFileSha === file.sha}
                    title={file.path}
                  >
                    {loadingFileSha === file.sha
                      ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                      : <File className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground">{file.path}</span>
                  </button>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => { onLoadFile(file.path, ""); openEditor(file); }}
                      className="p-1 rounded hover:bg-sidebar-border text-muted-foreground hover:text-foreground"
                      title="Load into chat"
                    >
                      <MessageSquare className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setDeletingFile(file)}
                      className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                      title="Delete file"
                      data-testid={`delete-file-btn-${file.sha}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // ── Repo list view ──────────────────────────────────────────────────────────
  const filteredRepos = repos.filter((r) => r.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-connected">
      <div className="p-3 border-b border-sidebar-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium truncate">
          <Github className="h-4 w-4 text-primary shrink-0" />
          <span className="truncate text-xs">{gitUser || "Connected"}</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive shrink-0" onClick={handleDisconnect} data-testid="github-disconnect-btn">
          Disconnect
        </Button>
      </div>

      {repoError && <div className="mx-3 mt-2 p-2 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 break-words shrink-0">{repoError}</div>}

      <div className="p-3 border-b border-sidebar-border shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search repos..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-7 text-xs pl-8 bg-background/50" data-testid="repo-search-input" />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoadingRepos ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-3 rounded-md space-y-2 animate-pulse">
                <div className="h-3.5 bg-muted rounded w-2/3" />
                <div className="h-3 bg-muted rounded w-1/3" />
              </div>
            ))
          ) : filteredRepos.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">{searchQuery ? "No repos match" : "No repositories found"}</div>
          ) : (
            filteredRepos.map((repo) => (
              <div key={repo.id} className="group relative rounded-md border border-transparent hover:border-sidebar-border hover:bg-sidebar-accent/50 transition-colors" data-testid={`repo-row-${repo.id}`}>
                <button onClick={() => handleSelectRepo(repo)} disabled={openingRepoPk === repo.id} className="w-full text-left p-2.5 pr-16">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                      <span className="text-xs font-medium truncate group-hover:text-primary transition-colors">{repo.name}</span>
                    </div>
                    {repo.private ? <Lock className="h-3 w-3 text-muted-foreground shrink-0" /> : <Globe className="h-3 w-3 text-muted-foreground shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-5">
                    {repo.language && <span className="px-1.5 py-0.5 rounded-sm bg-muted font-medium">{repo.language}</span>}
                    <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
                  </div>
                </button>
                <button
                  onClick={() => handleOpenRepoInChat(repo)}
                  disabled={openingRepoPk === repo.id}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-sidebar-border text-muted-foreground hover:text-foreground"
                  title="Chat about this repo"
                  data-testid={`chat-repo-btn-${repo.id}`}
                >
                  {openingRepoPk === repo.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
