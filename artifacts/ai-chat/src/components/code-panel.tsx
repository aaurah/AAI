import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Github, Search, ChevronLeft, Lock, Globe, File, Loader2,
  X, KeyRound, ExternalLink, Copy, CheckCircle2, FolderOpen,
  MessageSquare, GitPullRequest, GitCommit, RefreshCw, Plus,
  Trash2, GitBranch, Upload, Download, Diff,
  ChevronDown, AlertCircle, Check, History, Terminal,
  FilePlus, GitMerge, Pencil, ChevronRight, Star,
  ArrowDown, ArrowUp, ArrowUpDown, GitFork, Merge,
  Shield, FileCode, FileText, FileJson, FileImage,
  Coffee, Layers, Zap,
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
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
}

interface FileNode {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

interface CommitEntry {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
  author: { login: string; avatar_url: string } | null;
  html_url: string;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  merged?: boolean;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
  user: { login: string; avatar_url?: string };
  created_at: string;
}

type AuthMethod = "pat" | "oauth";
type RepoView = "files" | "commits" | "prs";

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

async function ghPost(url: string, token: string, body: object) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.message as string) || `GitHub error ${res.status}`);
  return data;
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

async function ghDelete(url: string, token: string, body?: object) {
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.message as string) || `GitHub error ${res.status}`);
  return data;
}

function toBase64(str: string): string { return btoa(unescape(encodeURIComponent(str))); }
function fromBase64(b64: string): string { return decodeURIComponent(escape(atob(b64.replace(/\n/g, "")))); }

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f7df1e", Python: "#3572A5", Rust: "#dea584",
  Go: "#00ADD8", Java: "#b07219", "C++": "#f34b7d", C: "#555555", "C#": "#178600",
  Ruby: "#701516", Swift: "#ffac45", Kotlin: "#A97BFF", PHP: "#4F5D95",
  HTML: "#e34c26", CSS: "#563d7c", Dart: "#00B4AB", Scala: "#c22d40",
  Shell: "#89e051", Vue: "#41b883", Svelte: "#ff3e00",
};

function getFileIcon(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const icons: Record<string, { Icon: React.FC<{ className?: string }>, color: string }> = {
    ts: { Icon: FileCode, color: "text-blue-400" },
    tsx: { Icon: FileCode, color: "text-blue-400" },
    js: { Icon: FileCode, color: "text-yellow-400" },
    jsx: { Icon: FileCode, color: "text-yellow-400" },
    py: { Icon: FileCode, color: "text-green-400" },
    rs: { Icon: FileCode, color: "text-orange-400" },
    go: { Icon: FileCode, color: "text-cyan-400" },
    json: { Icon: FileJson, color: "text-yellow-300" },
    md: { Icon: FileText, color: "text-slate-400" },
    mdx: { Icon: FileText, color: "text-slate-400" },
    txt: { Icon: FileText, color: "text-slate-400" },
    svg: { Icon: FileImage, color: "text-purple-400" },
    png: { Icon: FileImage, color: "text-purple-400" },
    jpg: { Icon: FileImage, color: "text-purple-400" },
    jpeg: { Icon: FileImage, color: "text-purple-400" },
    css: { Icon: Layers, color: "text-pink-400" },
    scss: { Icon: Layers, color: "text-pink-400" },
    html: { Icon: FileCode, color: "text-orange-400" },
    java: { Icon: Coffee, color: "text-red-400" },
    toml: { Icon: FileText, color: "text-slate-400" },
    yaml: { Icon: FileText, color: "text-slate-400" },
    yml: { Icon: FileText, color: "text-slate-400" },
    sh: { Icon: Terminal, color: "text-green-300" },
    bash: { Icon: Terminal, color: "text-green-300" },
    env: { Icon: Shield, color: "text-yellow-500" },
  };
  return icons[ext] || { Icon: File, color: "text-muted-foreground" };
}

interface DiffLine { type: "add" | "del" | "ctx"; text: string; }

function computeDiff(original: string, edited: string): DiffLine[] {
  if (original === edited) return [];
  const a = original.split("\n");
  const b = edited.split("\n");
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
  const [gitAvatar, setGitAvatar] = useState<string>("");

  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [repoView, setRepoView] = useState<RepoView>("files");
  const [files, setFiles] = useState<FileNode[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadingFileSha, setLoadingFileSha] = useState<string | null>(null);
  const [openingRepoPk, setOpeningRepoPk] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState("HEAD");
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isDeletingBranch, setIsDeletingBranch] = useState(false);

  const [aheadBehind, setAheadBehind] = useState<{ ahead: number; behind: number } | null>(null);

  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);

  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [isLoadingPrs, setIsLoadingPrs] = useState(false);
  const [creatingPr, setCreatingPr] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prBase, setPrBase] = useState("");
  const [isSubmittingPr, setIsSubmittingPr] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [prSuccess, setPrSuccess] = useState<string | null>(null);
  const [mergingPrNum, setMergingPrNum] = useState<number | null>(null);

  const [editingFile, setEditingFile] = useState<FileNode | null>(null);
  const [editContent, setEditContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [fileSha, setFileSha] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const [creatingFile, setCreatingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [renamingFile, setRenamingFile] = useState<FileNode | null>(null);
  const [renameTarget, setRenameTarget] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [deletingFile, setDeletingFile] = useState<FileNode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCloning, setIsCloning] = useState(false);

  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => { if (token) fetchRepos(token); }, [token]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const fetchRepos = async (t: string) => {
    setIsLoadingRepos(true); setRepoError(null);
    try {
      const user = await ghFetch("https://api.github.com/user", t) as { login: string; avatar_url: string };
      setGitUser(user.login);
      setGitAvatar(user.avatar_url || "");
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
    } catch {}
  };

  const fetchAheadBehind = useCallback(async (repo: Repo, branch: string) => {
    if (branch === repo.default_branch || branch === "HEAD") { setAheadBehind(null); return; }
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/compare/${repo.default_branch}...${branch}`, token) as { ahead_by: number; behind_by: number };
      setAheadBehind({ ahead: data.ahead_by, behind: data.behind_by });
    } catch { setAheadBehind(null); }
  }, [token]);

  const fetchCommits = useCallback(async (repo: Repo, branch: string) => {
    setIsLoadingCommits(true);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/commits?sha=${branch}&per_page=40`, token) as CommitEntry[];
      setCommits(data);
    } catch { setCommits([]); }
    finally { setIsLoadingCommits(false); }
  }, [token]);

  const fetchPrs = useCallback(async (repo: Repo) => {
    setIsLoadingPrs(true);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/pulls?state=open&per_page=30`, token) as PullRequest[];
      setPrs(data);
    } catch { setPrs([]); }
    finally { setIsLoadingPrs(false); }
  }, [token]);

  const loadFiles = useCallback(async (repo: Repo, branch?: string) => {
    const ref = branch || currentBranch;
    setIsLoadingFiles(true); setFileError(null);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/git/trees/${ref}?recursive=1`, token) as { tree: FileNode[] };
      setFiles(data.tree.filter((n) => n.type === "blob").sort((a, b) => a.path.localeCompare(b.path)));
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
    setRepoError(null); setGitUser(""); setGitAvatar(""); setOauthStep("idle"); setDeviceData(null);
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
    setSelectedRepo(repo); setFiles([]); setFileError(null); setEditingFile(null);
    setCurrentBranch(repo.default_branch || "main"); setRepoView("files");
    setFileSearch(""); setCommits([]); setPrs([]); setAheadBehind(null);
    fetchBranches(repo);
    setIsLoadingFiles(true);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch || "HEAD"}?recursive=1`, token) as { tree: FileNode[] };
      setFiles(data.tree.filter((n) => n.type === "blob").sort((a, b) => a.path.localeCompare(b.path)));
    } catch (err: unknown) { setFileError(err instanceof Error ? err.message : "Failed to load files"); }
    finally { setIsLoadingFiles(false); }
  };

  const handleSwitchBranch = async (branch: string) => {
    setCurrentBranch(branch); setShowBranchPicker(false); setEditingFile(null); setFileSearch("");
    setAheadBehind(null);
    await loadFiles(selectedRepo!, branch);
    if (repoView === "commits") fetchCommits(selectedRepo!, branch);
    fetchAheadBehind(selectedRepo!, branch);
  };

  const handleSync = async () => {
    setIsSyncing(true); setSyncSuccess(false);
    try {
      await loadFiles(selectedRepo!, currentBranch);
      if (editingFile) await openEditor(editingFile);
      if (repoView === "commits") await fetchCommits(selectedRepo!, currentBranch);
      if (repoView === "prs") await fetchPrs(selectedRepo!);
      await fetchAheadBehind(selectedRepo!, currentBranch);
      setSyncSuccess(true);
      showToast("Synced with GitHub");
      setTimeout(() => setSyncSuccess(false), 2000);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Sync failed", "error");
    } finally { setIsSyncing(false); }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim() || !selectedRepo) return;
    setIsCreatingBranch(true); setFileError(null);
    try {
      const ref = await ghFetch(`https://api.github.com/repos/${selectedRepo.full_name}/git/ref/heads/${currentBranch}`, token) as { object: { sha: string } };
      await ghPost(`https://api.github.com/repos/${selectedRepo.full_name}/git/refs`, token, {
        ref: `refs/heads/${newBranchName.trim()}`,
        sha: ref.object.sha,
      });
      await fetchBranches(selectedRepo);
      await handleSwitchBranch(newBranchName.trim());
      setCreatingBranch(false); setNewBranchName("");
      showToast(`Branch "${newBranchName.trim()}" created`);
    } catch (err: unknown) { setFileError(err instanceof Error ? err.message : "Failed to create branch"); }
    finally { setIsCreatingBranch(false); }
  };

  const handleDeleteBranch = async (branch: string) => {
    if (!selectedRepo || branch === selectedRepo.default_branch) return;
    if (!confirm(`Delete branch "${branch}"? This cannot be undone.`)) return;
    setIsDeletingBranch(true);
    try {
      await ghDelete(`https://api.github.com/repos/${selectedRepo.full_name}/git/refs/heads/${branch}`, token);
      await fetchBranches(selectedRepo);
      if (currentBranch === branch) await handleSwitchBranch(selectedRepo.default_branch);
      showToast(`Branch "${branch}" deleted`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to delete branch", "error");
    } finally { setIsDeletingBranch(false); }
  };

  const handleCreatePr = async () => {
    if (!prTitle.trim() || !selectedRepo) return;
    setIsSubmittingPr(true); setPrError(null); setPrSuccess(null);
    try {
      const base = prBase || selectedRepo.default_branch;
      const data = await ghPost(`https://api.github.com/repos/${selectedRepo.full_name}/pulls`, token, {
        title: prTitle.trim(), body: prBody.trim(), head: currentBranch, base,
      }) as { html_url: string; number: number };
      setPrSuccess(`PR #${data.number} created!`);
      setPrTitle(""); setPrBody(""); setCreatingPr(false);
      fetchPrs(selectedRepo);
      showToast(`PR #${data.number} opened`);
      setTimeout(() => setPrSuccess(null), 4000);
    } catch (err: unknown) { setPrError(err instanceof Error ? err.message : "Failed to create PR"); }
    finally { setIsSubmittingPr(false); }
  };

  const handleMergePr = async (pr: PullRequest) => {
    if (!selectedRepo) return;
    if (!confirm(`Merge PR #${pr.number} "${pr.title}"?`)) return;
    setMergingPrNum(pr.number);
    try {
      await ghPut(`https://api.github.com/repos/${selectedRepo.full_name}/pulls/${pr.number}/merge`, token, {
        merge_method: "merge",
        commit_title: `Merge pull request #${pr.number} from ${pr.head.ref}`,
      });
      showToast(`PR #${pr.number} merged!`);
      await fetchPrs(selectedRepo);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Merge failed", "error");
    } finally { setMergingPrNum(null); }
  };

  const handleCloneToTerminal = () => {
    if (!selectedRepo) return;
    setIsCloning(true);
    window.dispatchEvent(new CustomEvent("terminal-run-command", { detail: { command: `git clone https://github.com/${selectedRepo.full_name}.git` } }));
    window.dispatchEvent(new CustomEvent("switch-to-terminal"));
    setTimeout(() => setIsCloning(false), 1500);
  };

  const openEditor = async (file: FileNode) => {
    if (file.size && file.size > 200 * 1024) { setFileError("File too large to edit (> 200KB)"); return; }
    setLoadingFileSha(file.sha); setSaveError(null);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${selectedRepo!.full_name}/contents/${encodeURIComponent(file.path)}?ref=${currentBranch}`, token) as { sha: string; content: string; encoding: string };
      const content = data.encoding === "base64" ? fromBase64(data.content) : (data.content as string);
      setFileSha(data.sha); setEditingFile(file); setEditContent(content);
      setOriginalContent(content); setCommitMessage(`Update ${file.path}`);
      setShowDiff(false); setSaveSuccess(false);
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
      setOriginalContent(editContent); setSaveSuccess(true);
      showToast("Committed & pushed to GitHub");
      setTimeout(() => setSaveSuccess(false), 3000);
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
        token, { message: `Create ${newFilePath.trim()}`, content: toBase64(""), branch },
      );
      setCreatingFile(false); setNewFilePath("");
      showToast(`Created ${newFilePath.trim()}`);
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
        token, { message: `Delete ${file.path}`, sha: file.sha, branch },
      );
      setDeletingFile(null);
      if (editingFile?.path === file.path) setEditingFile(null);
      showToast(`Deleted ${file.path}`);
      await loadFiles(selectedRepo, currentBranch);
    } catch (err: unknown) { setSaveError(err instanceof Error ? err.message : "Failed to delete"); }
    finally { setIsDeleting(false); }
  };

  const handleRenameFile = async () => {
    if (!renamingFile || !renameTarget.trim() || !selectedRepo) return;
    setIsRenaming(true); setSaveError(null);
    try {
      const branch = currentBranch === "HEAD" ? selectedRepo.default_branch : currentBranch;
      const data = await ghFetch(`https://api.github.com/repos/${selectedRepo.full_name}/contents/${encodeURIComponent(renamingFile.path)}?ref=${branch}`, token) as { sha: string; content: string; encoding: string };
      const content = data.encoding === "base64" ? data.content : toBase64(data.content);
      await ghPut(`https://api.github.com/repos/${selectedRepo.full_name}/contents/${encodeURIComponent(renameTarget.trim())}`, token,
        { message: `Rename ${renamingFile.path} → ${renameTarget.trim()}`, content: content.replace(/\n/g, ""), branch });
      await ghDelete(`https://api.github.com/repos/${selectedRepo.full_name}/contents/${encodeURIComponent(renamingFile.path)}`, token,
        { message: `Delete ${renamingFile.path} (renamed)`, sha: renamingFile.sha, branch });
      setRenamingFile(null); setRenameTarget("");
      if (editingFile?.path === renamingFile.path) setEditingFile(null);
      showToast("File renamed");
      await loadFiles(selectedRepo, currentBranch);
    } catch (err: unknown) { setSaveError(err instanceof Error ? err.message : "Failed to rename"); }
    finally { setIsRenaming(false); }
  };

  const isDirty = editContent !== originalContent;
  const diffLines = showDiff ? computeDiff(originalContent, editContent) : [];
  const filteredFiles = fileSearch ? files.filter(f => f.path.toLowerCase().includes(fileSearch.toLowerCase())) : files;
  const filteredRepos = repos.filter((r) => r.name.toLowerCase().includes(searchQuery.toLowerCase()) || (r.description || "").toLowerCase().includes(searchQuery.toLowerCase()));

  // ── Toast overlay ────────────────────────────────────────────────────────────
  const ToastEl = toast ? (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg text-xs shadow-lg border transition-all
      ${toast.type === "success" ? "bg-green-500/15 border-green-500/30 text-green-400" : "bg-destructive/15 border-destructive/30 text-destructive"}`}>
      {toast.type === "success" ? <Check className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
      {toast.msg}
    </div>
  ) : null;

  // ── Auth view ────────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-disconnected">
        {ToastEl}
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Github className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Connect GitHub</h3>
              <p className="text-[10px] text-muted-foreground">Access your repos & code</p>
            </div>
          </div>
        </div>
        <div className="flex border-b border-sidebar-border shrink-0">
          <button onClick={() => setAuthMethod("pat")} className={`flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${authMethod === "pat" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`} data-testid="auth-tab-pat">
            <KeyRound className="h-3 w-3" /> Access Token
          </button>
          <button onClick={() => setAuthMethod("oauth")} className={`flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${authMethod === "oauth" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`} data-testid="auth-tab-oauth">
            <Github className="h-3 w-3" /> OAuth App
          </button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {repoError && <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg border border-destructive/20">{repoError}</div>}
            {authMethod === "pat" && (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">Personal Access Token</p>
                  <p>Generate a token with <code className="bg-muted px-1 rounded text-[10px]">repo</code> and <code className="bg-muted px-1 rounded text-[10px]">read:user</code> scopes.</p>
                </div>
                <Input type="password" placeholder="ghp_... or github_pat_..." value={patInput} onChange={(e) => setPatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePatConnect()} className="h-9 text-xs font-mono" data-testid="github-pat-input" autoComplete="off" />
                <Button onClick={handlePatConnect} className="w-full h-9 text-sm font-medium gap-2 glossy" disabled={!patInput.trim()} data-testid="github-connect-btn">
                  <Github className="h-4 w-4" /> Connect GitHub
                </Button>
                <a href="https://github.com/settings/tokens/new?scopes=repo,read:user" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-primary transition-colors justify-center">
                  <ExternalLink className="h-3 w-3" /> Generate token on GitHub →
                </a>
              </div>
            )}
            {authMethod === "oauth" && oauthStep === "idle" && (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">OAuth Device Flow</p>
                  <p>Create an <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer" className="text-primary underline">OAuth App</a> on GitHub — no redirect URI needed.</p>
                </div>
                <Input placeholder="Client ID" value={clientIdInput} onChange={(e) => setClientIdInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleStartOAuth()} className="h-9 text-xs font-mono" data-testid="github-client-id-input" />
                <Button onClick={handleStartOAuth} className="w-full h-9 text-sm font-medium gap-2 glossy" disabled={!clientIdInput.trim()} data-testid="github-oauth-start-btn">
                  <Github className="h-4 w-4" /> Authorize with GitHub
                </Button>
              </div>
            )}
            {authMethod === "oauth" && oauthStep === "polling" && deviceData && (
              <div className="space-y-4">
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3 text-center">
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
                  <Loader2 className="h-3 w-3 animate-spin" /> Waiting for authorization…
                </div>
                <Button variant="ghost" size="sm" className="w-full text-xs" onClick={cancelOAuth} data-testid="cancel-oauth-btn">Cancel</Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // ── File editor view ─────────────────────────────────────────────────────────
  if (editingFile) {
    return (
      <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-editor">
        {ToastEl}
        <div className="px-3 py-2 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 px-1.5 text-[11px] text-muted-foreground -ml-1 gap-0.5" onClick={() => setEditingFile(null)}>
              <ChevronLeft className="h-3 w-3" /> Files
            </Button>
            <span className="text-[10px] text-muted-foreground/40">·</span>
            <span className="text-[10px] text-primary/80 font-mono truncate flex-1">{editingFile.path}</span>
            {isDirty && <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded-full border border-amber-500/20 shrink-0 animate-pulse">unsaved</span>}
          </div>
        </div>

        {saveError && (
          <div className="mx-3 mt-1.5 p-2 text-[10px] bg-destructive/10 text-destructive rounded-lg border border-destructive/20 flex items-start gap-1.5 shrink-0">
            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />{saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="mx-3 mt-1.5 p-2 text-[10px] bg-green-500/10 text-green-400 rounded-lg border border-green-500/20 flex items-center gap-1.5 shrink-0">
            <Check className="h-3 w-3" /> Committed & pushed to GitHub
          </div>
        )}

        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-sidebar-border/50 shrink-0">
          <button onClick={() => setShowDiff(d => !d)} className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md transition-colors ${showDiff ? "bg-primary/10 text-primary border border-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
            <Diff className="h-3 w-3" /> Diff {isDirty && !showDiff && <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
          </button>
          <button onClick={() => onLoadFile(editingFile.path, editContent)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <MessageSquare className="h-3 w-3" /> Send to AI
          </button>
          <span className="ml-auto text-[9px] text-muted-foreground/50 font-mono">{editContent.split("\n").length}L</span>
        </div>

        {showDiff ? (
          <ScrollArea className="flex-1 min-h-0">
            {diffLines.length === 0 ? (
              <div className="py-8 text-center text-[10px] text-muted-foreground">No changes</div>
            ) : (
              <div className="font-mono text-[10.5px] leading-5">
                {diffLines.map((line, i) => (
                  <div key={i} className={`px-3 flex ${line.type === "add" ? "bg-green-500/8 text-green-400" : line.type === "del" ? "bg-red-500/8 text-red-400 line-through opacity-60" : "text-muted-foreground/50"}`}>
                    <span className="w-3 shrink-0 select-none opacity-70">{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>
                    <span className="whitespace-pre break-all">{line.text || " "}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        ) : (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="flex-1 min-h-0 w-full font-mono text-[11px] leading-5 bg-transparent resize-none outline-none border-0 p-3 text-foreground placeholder:text-muted-foreground/40"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            data-testid="editor-textarea"
          />
        )}

        <div className="border-t border-sidebar-border/50 p-2.5 space-y-2 shrink-0 glass">
          <Input
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message…"
            className="h-8 text-[11px] font-mono bg-background/50 border-border/50"
            onKeyDown={(e) => e.key === "Enter" && !isSaving && isDirty && handleCommit()}
            data-testid="commit-message-input"
          />
          <div className="flex gap-1.5">
            <Button size="sm" className="flex-1 h-8 text-[11px] gap-1.5 glossy relative overflow-hidden" disabled={!isDirty || isSaving || !commitMessage.trim()} onClick={handleCommit} data-testid="commit-btn">
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {isSaving ? "Pushing…" : "Commit & Push"}
            </Button>
            {isDirty && (
              <Button size="sm" variant="ghost" className="h-8 text-[11px] text-muted-foreground border border-border/40" onClick={() => setEditContent(originalContent)} title="Discard changes">
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          {isDirty && (
            <p className="text-[9px] text-muted-foreground text-center">
              {editContent.split("\n").length - originalContent.split("\n").length > 0 ? "+" : ""}
              {editContent.split("\n").length - originalContent.split("\n").length} lines changed
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Repo selected view ───────────────────────────────────────────────────────
  if (selectedRepo) {
    const isDefaultBranch = currentBranch === selectedRepo.default_branch;

    return (
      <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-file-browser">
        {ToastEl}

        {/* Repo header */}
        <div className="px-3 pt-2 pb-1.5 border-b border-sidebar-border shrink-0 space-y-2">
          {/* Title row */}
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="h-6 px-1 text-[10px] text-muted-foreground -ml-1 gap-0.5"
              onClick={() => { setSelectedRepo(null); setFiles([]); setFileError(null); setBranches([]); setCommits([]); setPrs([]); setAheadBehind(null); }} data-testid="back-to-repos-btn">
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {selectedRepo.private
                ? <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                : <Globe className="h-3 w-3 text-muted-foreground shrink-0" />}
              <span className="text-xs font-semibold truncate">{selectedRepo.full_name}</span>
            </div>
            <a href={`https://github.com/${selectedRepo.full_name}`} target="_blank" rel="noreferrer"
              className="p-1 rounded-md hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground transition-colors" title="Open on GitHub">
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Branch picker row */}
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <button onClick={() => setShowBranchPicker(b => !b)}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border/60 glass text-[11px] w-full hover:border-primary/40 transition-colors"
                data-testid="branch-picker-btn">
                <GitBranch className="h-3 w-3 text-primary/70 shrink-0" />
                <span className="truncate flex-1 text-left font-medium">{currentBranch}</span>
                {aheadBehind && (
                  <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground shrink-0">
                    {aheadBehind.ahead > 0 && <><ArrowUp className="h-2.5 w-2.5 text-green-400" />{aheadBehind.ahead}</>}
                    {aheadBehind.behind > 0 && <><ArrowDown className="h-2.5 w-2.5 text-amber-400" />{aheadBehind.behind}</>}
                  </span>
                )}
                <ChevronDown className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              </button>

              {showBranchPicker && branches.length > 0 && (
                <div className="absolute top-8 left-0 z-20 w-full rounded-lg border border-border glass shadow-xl overflow-hidden">
                  <div className="px-2 py-1 border-b border-border/50 text-[9px] text-muted-foreground font-medium uppercase tracking-wide">Branches</div>
                  <ScrollArea className="max-h-44">
                    {branches.map(b => (
                      <div key={b} className={`flex items-center group w-full px-2 py-1.5 text-[10px] hover:bg-sidebar-accent/50 ${b === currentBranch ? "text-primary font-medium" : "text-muted-foreground"}`}>
                        <button onClick={() => handleSwitchBranch(b)} className="flex items-center gap-1.5 flex-1 text-left">
                          {b === currentBranch ? <Check className="h-2.5 w-2.5 shrink-0" /> : <span className="w-2.5 shrink-0" />}
                          <span className="truncate">{b}</span>
                          {b === selectedRepo.default_branch && <span className="text-[8px] px-1 py-0.5 bg-muted rounded text-muted-foreground ml-auto shrink-0">default</span>}
                        </button>
                        {b !== selectedRepo.default_branch && (
                          <button onClick={() => handleDeleteBranch(b)} disabled={isDeletingBranch} className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 text-muted-foreground hover:text-destructive transition-all" title="Delete branch">
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </ScrollArea>
                  <div className="border-t border-border/50">
                    {!creatingBranch ? (
                      <button onClick={() => { setCreatingBranch(true); setShowBranchPicker(false); setNewBranchName(""); }}
                        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-[10px] text-primary hover:bg-primary/5 transition-colors">
                        <Plus className="h-3 w-3" /> New branch from {currentBranch}
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            {/* New branch icon */}
            <button onClick={() => { setCreatingBranch(c => !c); setNewBranchName(""); setShowBranchPicker(false); }}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-sidebar-accent/50 transition-colors" title="New branch">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* New branch input */}
          {creatingBranch && (
            <div className="flex gap-1.5">
              <Input autoFocus value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                placeholder={`Branch name (from ${currentBranch})…`}
                className="h-7 text-[10px] font-mono flex-1 bg-background/50"
                onKeyDown={e => { if (e.key === "Enter") handleCreateBranch(); if (e.key === "Escape") { setCreatingBranch(false); setNewBranchName(""); } }} />
              <Button size="sm" className="h-7 px-2.5 text-[10px]" onClick={handleCreateBranch} disabled={!newBranchName.trim() || isCreatingBranch}>
                {isCreatingBranch ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Create"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => { setCreatingBranch(false); setNewBranchName(""); }}>✕</Button>
            </div>
          )}

          {/* Pull / Sync / Push row */}
          <div className="grid grid-cols-3 gap-1">
            <button onClick={handleSync} disabled={isSyncing}
              className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Pull / Sync latest from GitHub" data-testid="sync-btn">
              {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : syncSuccess ? <Check className="h-3.5 w-3.5 text-green-400" /> : <ArrowDown className="h-3.5 w-3.5" />}
              <span className="text-[9px]">Pull</span>
            </button>
            <button onClick={handleSync} disabled={isSyncing}
              className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg border border-primary/30 hover:border-primary/50 bg-primary/5 hover:bg-primary/10 transition-colors text-primary/70 hover:text-primary disabled:opacity-50"
              title="Sync with GitHub">
              {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="text-[9px]">Sync</span>
            </button>
            <button
              onClick={() => { if (editingFile) handleCommit(); else showToast("Open a file to commit & push", "error"); }}
              className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground"
              title="Commit & Push changes">
              <ArrowUp className="h-3.5 w-3.5" />
              <span className="text-[9px]">Push</span>
            </button>
          </div>

          {/* Secondary actions */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => { setCreatingFile(c => !c); setNewFilePath(""); }}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border/40 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors" data-testid="new-file-btn">
              <FilePlus className="h-3 w-3" /> New File
            </button>
            <button onClick={() => { setCreatingPr(true); setPrBase(selectedRepo.default_branch); setPrTitle(`Merge ${currentBranch}`); }}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border/40 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors">
              <GitPullRequest className="h-3 w-3" /> New PR
            </button>
            <button onClick={handleCloneToTerminal} disabled={isCloning}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border/40 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors ml-auto">
              {isCloning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Terminal className="h-3 w-3" />} Clone
            </button>
          </div>

          {/* New file input */}
          {creatingFile && (
            <div className="flex gap-1.5">
              <Input autoFocus value={newFilePath} onChange={e => setNewFilePath(e.target.value)}
                placeholder="path/to/newfile.ts" className="h-7 text-[10px] font-mono flex-1 bg-background/50"
                onKeyDown={e => { if (e.key === "Enter") handleCreateFile(); if (e.key === "Escape") { setCreatingFile(false); setNewFilePath(""); } }}
                data-testid="new-file-input" />
              <Button size="sm" className="h-7 px-2.5 text-[10px]" onClick={handleCreateFile} disabled={!newFilePath.trim() || isSaving}>
                {isSaving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Create"}
              </Button>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-sidebar-border shrink-0">
          {([
            ["files", "Files", File, files.length],
            ["commits", "Commits", History, null],
            ["prs", "PRs", GitMerge, prs.length || null],
          ] as [RepoView, string, React.FC<{ className?: string }>, number | null][]).map(([v, label, Icon, count]) => (
            <button key={v} onClick={() => {
              setRepoView(v);
              if (v === "commits" && commits.length === 0) fetchCommits(selectedRepo, currentBranch);
              if (v === "prs") fetchPrs(selectedRepo);
            }}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors ${repoView === v ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3 w-3" />
              {label}
              {count !== null && count > 0 && <span className="ml-0.5 px-1 py-0.5 rounded-full bg-muted text-[8px] font-bold">{count}</span>}
            </button>
          ))}
        </div>

        {/* Alerts */}
        {(fileError || saveError) && (
          <div className="mx-2 mt-1.5 p-2 text-[10px] bg-destructive/10 text-destructive rounded-lg border border-destructive/20 flex items-start gap-1 shrink-0">
            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{fileError || saveError}</span>
            <button onClick={() => { setFileError(null); setSaveError(null); }} className="ml-auto shrink-0"><X className="h-3 w-3" /></button>
          </div>
        )}
        {prSuccess && (
          <div className="mx-2 mt-1.5 p-2 text-[10px] bg-green-500/10 text-green-400 rounded-lg border border-green-500/20 flex items-center gap-1 shrink-0">
            <Check className="h-3 w-3" />{prSuccess}
          </div>
        )}

        {/* Delete confirm */}
        {deletingFile && (
          <div className="mx-2 mt-1.5 p-3 text-[10px] rounded-lg border border-destructive/30 bg-destructive/5 shrink-0 space-y-2">
            <p>Delete <span className="font-mono text-destructive font-medium">{deletingFile.path}</span>?</p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="destructive" className="h-7 text-[10px] flex-1" onClick={() => handleDeleteFile(deletingFile)} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Delete"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setDeletingFile(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Rename input */}
        {renamingFile && (
          <div className="mx-2 mt-1.5 p-3 text-[10px] rounded-lg border border-primary/20 bg-primary/5 shrink-0 space-y-2">
            <p className="text-muted-foreground">Rename <span className="font-mono text-foreground">{renamingFile.path}</span></p>
            <div className="flex gap-1.5">
              <Input autoFocus value={renameTarget} onChange={e => setRenameTarget(e.target.value)}
                placeholder="new/path/name.ts" className="h-7 text-[10px] font-mono flex-1"
                onKeyDown={e => { if (e.key === "Enter") handleRenameFile(); if (e.key === "Escape") { setRenamingFile(null); setRenameTarget(""); } }} />
              <Button size="sm" className="h-7 px-2.5 text-[10px]" onClick={handleRenameFile} disabled={!renameTarget.trim() || isRenaming}>
                {isRenaming ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Rename"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => { setRenamingFile(null); setRenameTarget(""); }}>✕</Button>
            </div>
          </div>
        )}

        {/* PR creation form */}
        {creatingPr && (
          <div className="mx-2 mt-1.5 p-3 rounded-lg border border-primary/20 bg-primary/5 shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold flex items-center gap-1.5"><GitPullRequest className="h-3 w-3 text-primary" /> New Pull Request</p>
              <button onClick={() => { setCreatingPr(false); setPrError(null); }} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
              <span className="font-mono text-primary">{currentBranch}</span>
              <ChevronRight className="h-3 w-3" />
              <select value={prBase} onChange={e => setPrBase(e.target.value)} className="bg-transparent border-0 text-[10px] text-foreground outline-none font-mono flex-1">
                {branches.filter(b => b !== currentBranch).map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <Input value={prTitle} onChange={e => setPrTitle(e.target.value)} placeholder="PR title…" className="h-7 text-[10px]" />
            <textarea value={prBody} onChange={e => setPrBody(e.target.value)}
              placeholder="Description (optional)…" rows={2}
              className="w-full text-[10px] bg-background/50 border border-border/50 rounded-md px-2 py-1.5 resize-none outline-none focus:border-primary/50 text-foreground" />
            {prError && <p className="text-[10px] text-destructive">{prError}</p>}
            <Button size="sm" className="w-full h-7 text-[10px] gap-1.5" onClick={handleCreatePr} disabled={!prTitle.trim() || isSubmittingPr || currentBranch === prBase}>
              {isSubmittingPr ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <GitPullRequest className="h-3 w-3" />}
              {isSubmittingPr ? "Creating…" : "Create Pull Request"}
            </Button>
          </div>
        )}

        {/* Files tab */}
        {repoView === "files" && (
          <>
            <div className="px-2 pt-1.5 pb-1 shrink-0">
              <div className="relative">
                <Search className="absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
                <Input value={fileSearch} onChange={e => setFileSearch(e.target.value)} placeholder="Filter files…" className="h-7 text-[10px] pl-6 bg-background/50" />
                {fileSearch && <button onClick={() => setFileSearch("")} className="absolute right-1.5 top-1.5 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>}
              </div>
            </div>
            <ScrollArea className="flex-1" onClick={() => setShowBranchPicker(false)}>
              <div className="p-1 space-y-0.5">
                {isLoadingFiles ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 animate-pulse">
                      <div className="w-3 h-3 rounded bg-muted" />
                      <div className="h-2.5 bg-muted rounded flex-1" style={{ width: `${50 + (i * 13) % 40}%` }} />
                    </div>
                  ))
                ) : filteredFiles.length === 0 ? (
                  <div className="py-8 text-center text-[10px] text-muted-foreground">{fileSearch ? "No files match" : "No files found"}</div>
                ) : (
                  filteredFiles.map((file) => {
                    const { Icon, color } = getFileIcon(file.path);
                    return (
                      <div key={file.path} className="flex items-center justify-between group px-1.5 py-1 hover:bg-sidebar-accent/50 rounded-md" data-testid={`file-row-${file.sha}`}>
                        <button className="flex items-center gap-1.5 overflow-hidden flex-1 text-left" onClick={() => openEditor(file)} disabled={loadingFileSha === file.sha} title={file.path}>
                          {loadingFileSha === file.sha
                            ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                            : <Icon className={`h-3 w-3 shrink-0 ${color}`} />}
                          <span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">{file.path}</span>
                        </button>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button onClick={() => { onLoadFile(file.path, ""); openEditor(file); }} className="p-1 rounded hover:bg-sidebar-border text-muted-foreground hover:text-foreground" title="Send to AI">
                            <MessageSquare className="h-2.5 w-2.5" />
                          </button>
                          <button onClick={() => { setRenamingFile(file); setRenameTarget(file.path); }} className="p-1 rounded hover:bg-sidebar-border text-muted-foreground hover:text-foreground" title="Rename">
                            <Pencil className="h-2.5 w-2.5" />
                          </button>
                          <button onClick={() => setDeletingFile(file)} className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive" title="Delete" data-testid={`delete-file-btn-${file.sha}`}>
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </>
        )}

        {/* Commits tab */}
        {repoView === "commits" && (
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {isLoadingCommits ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 animate-pulse">
                    <div className="w-5 h-5 rounded-full bg-muted shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-2.5 bg-muted rounded w-3/4" />
                      <div className="h-2 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                ))
              ) : commits.length === 0 ? (
                <div className="py-8 text-center text-[10px] text-muted-foreground">No commits found</div>
              ) : (
                commits.map(commit => (
                  <a key={commit.sha} href={commit.html_url} target="_blank" rel="noreferrer"
                    className="flex items-start gap-2 p-2 rounded-lg hover:bg-sidebar-accent/50 transition-colors group border border-transparent hover:border-sidebar-border/50">
                    {commit.author?.avatar_url
                      ? <img src={commit.author.avatar_url} alt="" className="h-5 w-5 rounded-full shrink-0 mt-0.5" />
                      : <div className="h-5 w-5 rounded-full bg-muted shrink-0 mt-0.5 flex items-center justify-center"><GitCommit className="h-2.5 w-2.5 text-muted-foreground" /></div>}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-foreground/90 leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                        {commit.commit.message.split("\n")[0]}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] font-mono bg-muted/50 px-1 rounded text-muted-foreground">{commit.sha.slice(0, 7)}</span>
                        <span className="text-[9px] text-muted-foreground">{commit.commit.author.name} · {relativeTime(commit.commit.author.date)}</span>
                      </div>
                    </div>
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-1" />
                  </a>
                ))
              )}
            </div>
          </ScrollArea>
        )}

        {/* PRs tab */}
        {repoView === "prs" && (
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1.5">
              <button onClick={() => { setCreatingPr(true); setPrBase(selectedRepo.default_branch); setPrTitle(`Merge ${currentBranch}`); setRepoView("files"); }}
                className="w-full flex items-center gap-2 p-2.5 rounded-lg border border-dashed border-primary/40 hover:bg-primary/5 hover:border-primary/60 text-[10px] text-primary/70 hover:text-primary transition-colors">
                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Plus className="h-3 w-3" /></div>
                Open New Pull Request
              </button>
              {isLoadingPrs ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 animate-pulse">
                    <div className="w-5 h-5 rounded-full bg-muted shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-2.5 bg-muted rounded w-3/4" />
                      <div className="h-2 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                ))
              ) : prs.length === 0 ? (
                <div className="py-6 text-center text-[10px] text-muted-foreground">
                  <GitPullRequest className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  No open pull requests
                </div>
              ) : (
                prs.map(pr => (
                  <div key={pr.number} className="rounded-lg border border-sidebar-border/60 hover:border-sidebar-border transition-colors overflow-hidden">
                    <a href={pr.html_url} target="_blank" rel="noreferrer" className="flex items-start gap-2 p-2.5 hover:bg-sidebar-accent/30 transition-colors group">
                      {pr.user.avatar_url
                        ? <img src={pr.user.avatar_url} alt="" className="h-5 w-5 rounded-full shrink-0 mt-0.5" />
                        : <div className="h-5 w-5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0 mt-0.5"><GitMerge className="h-2.5 w-2.5 text-green-400" /></div>}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-1">
                          <p className="text-[10px] text-foreground/90 leading-snug group-hover:text-primary transition-colors flex-1">{pr.title}</p>
                          <span className={`text-[8px] px-1.5 py-0.5 rounded-full border shrink-0 font-medium ${pr.draft ? "bg-muted/50 text-muted-foreground border-border" : "bg-green-500/10 text-green-400 border-green-500/20"}`}>
                            {pr.draft ? "Draft" : "Open"}
                          </span>
                        </div>
                        <p className="text-[9px] text-muted-foreground mt-0.5">
                          #{pr.number} · <span className="font-mono">{pr.head.ref}</span> → <span className="font-mono">{pr.base.ref}</span>
                        </p>
                        <p className="text-[9px] text-muted-foreground">{pr.user.login} · {relativeTime(pr.created_at)}</p>
                      </div>
                    </a>
                    {!pr.draft && (
                      <div className="border-t border-sidebar-border/40 px-2.5 py-1.5 flex items-center gap-1.5">
                        <button onClick={() => handleMergePr(pr)} disabled={mergingPrNum === pr.number}
                          className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-md bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 hover:text-green-300 transition-colors font-medium disabled:opacity-50">
                          {mergingPrNum === pr.number ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Merge className="h-2.5 w-2.5" />}
                          {mergingPrNum === pr.number ? "Merging…" : "Merge"}
                        </button>
                        <a href={pr.html_url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-md border border-border/40 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors ml-auto">
                          <ExternalLink className="h-2.5 w-2.5" /> View
                        </a>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    );
  }

  // ── Repo list view ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-connected">
      {ToastEl}

      {/* Header */}
      <div className="px-3 py-2 border-b border-sidebar-border flex items-center gap-2 shrink-0">
        {gitAvatar
          ? <img src={gitAvatar} alt={gitUser} className="h-6 w-6 rounded-full shrink-0" />
          : <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Github className="h-3.5 w-3.5 text-primary" /></div>}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{gitUser || "Connected"}</p>
          <p className="text-[9px] text-muted-foreground">{repos.length} repos</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => fetchRepos(token)} title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-muted-foreground hover:text-destructive" onClick={handleDisconnect} data-testid="github-disconnect-btn">
          Disconnect
        </Button>
      </div>

      {repoError && <div className="mx-3 mt-2 p-2 text-xs bg-destructive/10 text-destructive rounded-lg border border-destructive/20 break-words shrink-0">{repoError}</div>}

      <div className="px-3 py-2 border-b border-sidebar-border shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search repositories…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 text-xs pl-8 bg-background/50" data-testid="repo-search-input" />
          {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoadingRepos ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-3 rounded-lg border border-transparent space-y-2 animate-pulse">
                <div className="flex items-center gap-2"><div className="h-3.5 bg-muted rounded w-1/3" /><div className="h-3 bg-muted rounded w-8 ml-auto" /></div>
                <div className="h-2.5 bg-muted rounded w-2/3" />
                <div className="h-2 bg-muted rounded w-1/4" />
              </div>
            ))
          ) : filteredRepos.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              <Github className="h-8 w-8 mx-auto mb-2 opacity-20" />
              {searchQuery ? "No repos match" : "No repositories found"}
            </div>
          ) : (
            filteredRepos.map((repo) => {
              const langColor = repo.language ? (LANG_COLORS[repo.language] || "#8b949e") : null;
              return (
                <div key={repo.id} className="group relative rounded-lg border border-transparent hover:border-sidebar-border hover:bg-sidebar-accent/40 transition-all" data-testid={`repo-row-${repo.id}`}>
                  <button onClick={() => handleSelectRepo(repo)} disabled={openingRepoPk === repo.id} className="w-full text-left p-2.5 pr-12">
                    <div className="flex items-center gap-2 mb-1">
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                      <span className="text-xs font-semibold truncate group-hover:text-primary transition-colors">{repo.name}</span>
                      {repo.private
                        ? <span className="ml-auto shrink-0 text-[8px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">Private</span>
                        : <span className="ml-auto shrink-0 text-[8px] px-1.5 py-0.5 rounded-full bg-primary/5 text-primary/60 border border-primary/15">Public</span>}
                    </div>
                    {repo.description && (
                      <p className="text-[10px] text-muted-foreground/70 pl-5 truncate mb-1.5">{repo.description}</p>
                    )}
                    <div className="flex items-center gap-2.5 text-[9px] text-muted-foreground pl-5">
                      {langColor && repo.language && (
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: langColor }} />
                          {repo.language}
                        </span>
                      )}
                      {(repo.stargazers_count ?? 0) > 0 && (
                        <span className="flex items-center gap-0.5"><Star className="h-2.5 w-2.5" />{repo.stargazers_count}</span>
                      )}
                      {(repo.forks_count ?? 0) > 0 && (
                        <span className="flex items-center gap-0.5"><GitFork className="h-2.5 w-2.5" />{repo.forks_count}</span>
                      )}
                      <span className="ml-auto">{relativeTime(repo.updated_at)}</span>
                    </div>
                  </button>

                  <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                    <button onClick={() => handleOpenRepoInChat(repo)} disabled={openingRepoPk === repo.id}
                      className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors" title="Chat about this repo" data-testid={`chat-repo-btn-${repo.id}`}>
                      {openingRepoPk === repo.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
