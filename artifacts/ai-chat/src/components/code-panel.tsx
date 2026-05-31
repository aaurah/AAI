import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Github, Search, ChevronLeft, Lock, Globe, File, Loader2,
  X, KeyRound, ExternalLink, Copy, CheckCircle2, FolderOpen, MessageSquare,
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

  useEffect(() => { if (token) fetchRepos(token); }, [token]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const fetchRepos = async (t: string) => {
    setIsLoadingRepos(true);
    setRepoError(null);
    try {
      const user = await ghFetch("https://api.github.com/user", t) as { login: string };
      setGitUser(user.login);
      const data = await ghFetch("https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator", t) as Repo[];
      setRepos(data);
    } catch (err: unknown) {
      setRepoError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const handlePatConnect = () => {
    const t = patInput.trim();
    if (!t) return;
    localStorage.setItem(GH_TOKEN_KEY, t);
    setToken(t);
    setPatInput("");
  };

  const handleDisconnect = () => {
    localStorage.removeItem(GH_TOKEN_KEY);
    setToken("");
    setRepos([]);
    setSelectedRepo(null);
    setFiles([]);
    setRepoError(null);
    setGitUser("");
    setOauthStep("idle");
    setDeviceData(null);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const handleStartOAuth = async () => {
    const cid = clientIdInput.trim();
    if (!cid) return;
    localStorage.setItem(GH_CLIENT_ID_KEY, cid);
    setRepoError(null);
    try {
      const res = await fetch("/api/github/device/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: cid }),
      });
      const data = await res.json() as { user_code?: string; verification_uri?: string; device_code?: string; interval?: number; error?: string };
      if (data.error || !data.user_code) throw new Error(data.error || "Failed to start OAuth");
      setDeviceData({ user_code: data.user_code!, verification_uri: data.verification_uri!, device_code: data.device_code!, interval: data.interval || 5 });
      setOauthStep("polling");
      startPolling(cid, data.device_code!, data.interval || 5);
    } catch (err: unknown) {
      setRepoError(err instanceof Error ? err.message : "Failed to start OAuth flow");
    }
  };

  const startPolling = (cid: string, deviceCode: string, interval: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/github/device/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: cid, deviceCode }),
        });
        const data = await res.json() as { access_token?: string; error?: string; interval?: number };
        if (data.access_token) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          localStorage.setItem(GH_TOKEN_KEY, data.access_token);
          setToken(data.access_token);
          setOauthStep("idle");
          setDeviceData(null);
        } else if (data.error === "slow_down") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          startPolling(cid, deviceCode, (data.interval ?? interval) + 5);
        } else if (data.error === "expired_token") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setOauthStep("idle");
          setDeviceData(null);
          setRepoError("Device code expired. Please start the authorization again.");
        }
      } catch {}
    }, interval * 1000);
  };

  const cancelOAuth = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setOauthStep("idle");
    setDeviceData(null);
  };

  const copyCode = () => {
    if (deviceData) {
      navigator.clipboard.writeText(deviceData.user_code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  };

  const handleOpenRepoInChat = async (repo: Repo) => {
    setOpeningRepoPk(repo.id);
    setRepoError(null);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/git/trees/HEAD?recursive=1`, token) as { tree: FileNode[] };
      const files = data.tree
        .filter((n) => n.type === "blob")
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((f) => f.path);
      onOpenRepoChat(repo.full_name, repo.owner.login, repo.name, files);
    } catch (err: unknown) {
      setRepoError(err instanceof Error ? err.message : "Failed to load repo files");
    } finally {
      setOpeningRepoPk(null);
    }
  };

  const handleBrowseFiles = async (repo: Repo, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedRepo(repo);
    setFiles([]);
    setIsLoadingFiles(true);
    setFileError(null);
    try {
      const data = await ghFetch(`https://api.github.com/repos/${repo.full_name}/git/trees/HEAD?recursive=1`, token) as { tree: FileNode[] };
      const blobs = data.tree.filter((n) => n.type === "blob").sort((a, b) => a.path.localeCompare(b.path));
      setFiles(blobs);
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "Failed to load files");
      setSelectedRepo(null);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleLoadFile = async (file: FileNode) => {
    if (file.size && file.size > 100 * 1024) { setFileError("File too large (> 100KB)."); return; }
    setLoadingFileSha(file.sha);
    setFileError(null);
    try {
      const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
      const data = await ghFetch(`https://api.github.com/repos/${selectedRepo!.full_name}/contents/${encodedPath}`, token) as { encoding: string; content: string };
      if (data.encoding !== "base64") throw new Error("Unsupported encoding");
      const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
      const content = new TextDecoder().decode(bytes);
      onLoadFile(file.path, content);
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setLoadingFileSha(null);
    }
  };

  if (!token) {
    return (
      <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-disconnected">
        <div className="p-4 border-b border-sidebar-border">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Github className="h-4 w-4 text-primary" />
            Connect GitHub
          </h3>
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
                <p className="text-xs text-muted-foreground">Create a GitHub OAuth App at <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer" className="text-primary underline">github.com/settings/applications/new</a> — no redirect URI needed for Device Flow.</p>
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

  const filteredRepos = repos.filter((r) => r.name.toLowerCase().includes(searchQuery.toLowerCase()));

  if (selectedRepo) {
    return (
      <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-file-browser">
        <div className="p-3 border-b border-sidebar-border shrink-0 space-y-1">
          <Button variant="ghost" size="sm" className="h-7 px-0 text-xs text-muted-foreground -ml-1 justify-start gap-1"
            onClick={() => { setSelectedRepo(null); setFiles([]); setFileError(null); }} data-testid="back-to-repos-btn">
            <ChevronLeft className="h-3 w-3" /> Back
          </Button>
          <p className="text-xs font-semibold truncate">{selectedRepo.name}</p>
        </div>
        {fileError && <div className="mx-3 mt-2 p-2 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 shrink-0">{fileError}</div>}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {isLoadingFiles ? (
              <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : files.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No files found</div>
            ) : (
              files.map((file) => (
                <div key={file.sha} className="flex items-center justify-between group p-1.5 hover:bg-sidebar-accent/50 rounded-md text-xs" data-testid={`file-row-${file.sha}`}>
                  <div className="flex items-center gap-2 overflow-hidden mr-2">
                    <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate text-muted-foreground group-hover:text-foreground" title={file.path}>{file.path}</span>
                  </div>
                  <Button variant="secondary" size="sm" className="h-6 px-2 text-[10px] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleLoadFile(file)} disabled={loadingFileSha === file.sha || (!!file.size && file.size > 100 * 1024)}
                    title={file.size && file.size > 100 * 1024 ? "File too large" : "Load into chat"} data-testid={`load-file-btn-${file.sha}`}>
                    {loadingFileSha === file.sha ? <Loader2 className="h-3 w-3 animate-spin" /> : "Load"}
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

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

      {repoError && (
        <div className="mx-3 mt-2 p-2 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 break-words shrink-0">
          {repoError}
        </div>
      )}

      <div className="p-3 border-b border-sidebar-border shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search repos..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-7 text-xs pl-8 bg-background/50" data-testid="repo-search-input" />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
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
                <button
                  onClick={() => handleOpenRepoInChat(repo)}
                  disabled={openingRepoPk === repo.id}
                  className="w-full text-left p-2.5 pr-10"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      {openingRepoPk === repo.id
                        ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                        : <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                      }
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
                  onClick={(e) => handleBrowseFiles(repo, e)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-sidebar-border text-muted-foreground hover:text-foreground"
                  title="Browse files"
                  data-testid={`browse-files-btn-${repo.id}`}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
