import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Github, Search, ChevronLeft, Lock, Globe, File, Loader2, X } from "lucide-react";

interface CodePanelProps {
  onLoadFile: (filename: string, content: string) => void;
}

interface Repo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  language: string | null;
  updated_at: string;
}

interface FileNode {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

export function CodePanel({ onLoadFile }: CodePanelProps) {
  const [token, setToken] = useState<string>(() => localStorage.getItem("github_pat") || "");
  const [inputToken, setInputToken] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [loadingFileSha, setLoadingFileSha] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      fetchRepos(token);
    }
  }, [token]);

  const handleConnect = () => {
    if (inputToken.trim()) {
      localStorage.setItem("github_pat", inputToken.trim());
      setToken(inputToken.trim());
      setInputToken("");
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem("github_pat");
    setToken("");
    setRepos([]);
    setSelectedRepo(null);
    setFiles([]);
    setError(null);
  };

  const fetchRepos = async (pat: string) => {
    setIsLoadingRepos(true);
    setError(null);
    try {
      const res = await fetch("https://api.github.com/user/repos?sort=updated&per_page=50", {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error("Invalid token");
        if (res.status === 403) throw new Error("API rate limit exceeded or token expired");
        throw new Error("Failed to fetch repositories");
      }
      const data = await res.json();
      setRepos(data);
    } catch (err: any) {
      setError(err.message);
      setToken("");
      localStorage.removeItem("github_pat");
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const fetchFiles = async (repo: Repo) => {
    setSelectedRepo(repo);
    setIsLoadingFiles(true);
    setError(null);
    try {
      const res = await fetch(`https://api.github.com/repos/${repo.full_name}/git/trees/HEAD?recursive=1`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (!res.ok) throw new Error("Failed to fetch repository files");
      const data = await res.json();
      
      const blobs = data.tree.filter((node: FileNode) => node.type === "blob");
      // Sort by path
      blobs.sort((a: FileNode, b: FileNode) => a.path.localeCompare(b.path));
      setFiles(blobs);
    } catch (err: any) {
      setError(err.message);
      setSelectedRepo(null);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleLoadFile = async (file: FileNode) => {
    if (file.size && file.size > 100 * 1024) {
      setError("File is too large (> 100KB)");
      return;
    }
    
    setLoadingFileSha(file.sha);
    setError(null);
    try {
      const res = await fetch(`https://api.github.com/repos/${selectedRepo!.full_name}/contents/${file.path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (!res.ok) throw new Error("Failed to fetch file content");
      const data = await res.json();
      
      // Content is base64 encoded
      let content = "";
      if (data.encoding === "base64") {
        content = decodeURIComponent(escape(window.atob(data.content)));
      } else {
        throw new Error(`Unsupported encoding: ${data.encoding}`);
      }
      
      onLoadFile(file.path, content);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingFileSha(null);
    }
  };

  if (!token) {
    return (
      <div className="flex flex-col p-4 space-y-4 h-full" data-testid="code-panel-disconnected">
        <div>
          <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
            <Github className="h-5 w-5" />
            Connect GitHub
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Enter a Personal Access Token to access your repos
          </p>
        </div>
        
        <div className="space-y-3">
          <Input 
            type="password" 
            placeholder="ghp_..." 
            value={inputToken}
            onChange={(e) => setInputToken(e.target.value)}
            className="h-9 text-xs"
            data-testid="github-pat-input"
          />
          <Button 
            onClick={handleConnect} 
            className="w-full h-9 text-xs font-medium"
            disabled={!inputToken.trim()}
            data-testid="github-connect-btn"
          >
            Connect
          </Button>
          
          <div className="text-[10px] text-center text-muted-foreground/70 underline cursor-help">
            Create a token at github.com/settings/tokens
          </div>
        </div>
      </div>
    );
  }

  const filteredRepos = repos.filter(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="code-panel-connected">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between shrink-0 bg-sidebar">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Github className="h-4 w-4" />
          <span>Connected</span>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
          onClick={handleDisconnect}
          data-testid="github-disconnect-btn"
        >
          Disconnect
        </Button>
      </div>

      {error && (
        <div className="p-3 mx-3 mt-3 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 break-words shrink-0">
          {error}
        </div>
      )}

      {selectedRepo ? (
        // File Browser
        <div className="flex flex-col flex-1 overflow-hidden" data-testid="file-browser">
          <div className="p-3 border-b shrink-0 space-y-2">
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 px-0 text-xs text-muted-foreground hover:text-foreground -ml-1 justify-start gap-1"
              onClick={() => { setSelectedRepo(null); setFiles([]); setError(null); }}
              data-testid="back-to-repos-btn"
            >
              <ChevronLeft className="h-3 w-3" />
              Back to repos
            </Button>
            <h4 className="text-sm font-semibold truncate" title={selectedRepo.full_name}>
              {selectedRepo.name}
            </h4>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {isLoadingFiles ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : files.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No files found
                </div>
              ) : (
                files.map(file => (
                  <div 
                    key={file.path} 
                    className="flex items-center justify-between group p-1.5 hover:bg-sidebar-accent/50 rounded-md text-xs"
                    data-testid={`file-row-${file.sha}`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden mr-2">
                      <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate text-muted-foreground group-hover:text-foreground transition-colors" title={file.path}>
                        {file.path}
                      </span>
                    </div>
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      className="h-6 px-2 text-[10px] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleLoadFile(file)}
                      disabled={loadingFileSha === file.sha || (file.size ? file.size > 100 * 1024 : false)}
                      data-testid={`load-file-btn-${file.sha}`}
                    >
                      {loadingFileSha === file.sha ? <Loader2 className="h-3 w-3 animate-spin" /> : "Load"}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      ) : (
        // Repo List
        <div className="flex flex-col flex-1 overflow-hidden" data-testid="repo-browser">
          <div className="p-3 border-b shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search repos..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-7 text-xs pl-8 bg-background/50 border-sidebar-border"
                data-testid="repo-search-input"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {isLoadingRepos ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="p-3 rounded-md border border-transparent space-y-2 animate-pulse">
                    <div className="h-4 bg-muted rounded w-2/3"></div>
                    <div className="h-3 bg-muted rounded w-1/3"></div>
                  </div>
                ))
              ) : filteredRepos.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {searchQuery ? "No repos match search" : "No repositories found"}
                </div>
              ) : (
                filteredRepos.map(repo => (
                  <button
                    key={repo.id}
                    onClick={() => fetchFiles(repo)}
                    className="w-full text-left p-2.5 rounded-md hover:bg-sidebar-accent/50 transition-colors border border-transparent hover:border-sidebar-border group"
                    data-testid={`repo-row-${repo.id}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {repo.name}
                      </span>
                      {repo.private ? (
                        <Lock className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                      ) : (
                        <Globe className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      {repo.language && (
                        <span className="px-1.5 py-0.5 rounded-sm bg-muted font-medium">
                          {repo.language}
                        </span>
                      )}
                      <span className="truncate">
                        Updated {new Date(repo.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
