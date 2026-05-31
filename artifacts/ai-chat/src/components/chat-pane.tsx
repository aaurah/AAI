import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGetOpenrouterConversation,
  useListOpenrouterMessages,
  useCreateOpenrouterConversation,
  getListOpenrouterConversationsQueryKey,
  getListOpenrouterMessagesQueryKey,
  getGetOpenrouterConversationQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send, Paperclip, X, ThumbsUp, ThumbsDown, Copy, Share2, Volume2, Mic,
  StopCircle, Plus, Github, Code2, Check, Search, Loader2, Cloud,
} from "lucide-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface RepoContext {
  fullName: string;
  owner: string;
  repo: string;
}

interface ChatPaneProps {
  conversationId?: number;
  prefilledInput?: string;
  autoSend?: boolean;
  repoContext?: RepoContext | null;
  onPrefilledInputClear?: () => void;
}

interface GHRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  language: string | null;
  updated_at: string;
}

const MODELS = [
  { id: "llama-3.3", name: "Llama 3.3 70B" },
  { id: "llama-4-scout", name: "Llama 4 Scout (Vision)" },
  { id: "mistral", name: "Mistral Small 3.1" },
  { id: "gemma", name: "Gemma 3 27B" },
  { id: "qwen", name: "QwQ-32B" },
];

type Attachment = { type: "image" | "video"; data: string; file?: File };

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const supportsSpeech = !!SpeechRecognition;

const parseMessage = (content: string) => {
  try {
    const parsed = JSON.parse(content);
    if (parsed.attachments && Array.isArray(parsed.attachments))
      return { text: parsed.text || "", attachments: parsed.attachments };
  } catch {}
  return { text: content, attachments: [] };
};

type CodePart = { type: "code"; lang: string; filename: string | null; code: string };
type TextPart = { type: "text"; content: string };
type Part = TextPart | CodePart;

function splitCodeBlocks(text: string): Part[] {
  const result: Part[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) result.push({ type: "text", content: text.slice(last, m.index) });
    const lang = m[1] || "";
    const rawCode = m[2];
    const lines = rawCode.split("\n");
    let filename: string | null = null;
    let codeStart = 0;
    const fileMatch = lines[0]?.trim().match(/^(?:\/\/|#|\/\*|<!--)\s*(?:file|filename):\s*(.+?)(?:\s*(?:\*\/|-->))?$/i);
    if (fileMatch) { filename = fileMatch[1].trim(); codeStart = lines[1]?.trim() === "" ? 2 : 1; }
    const code = lines.slice(codeStart).join("\n").trimEnd();
    result.push({ type: "code", lang, filename, code });
    last = m.index + m[0].length;
  }
  if (last < text.length) result.push({ type: "text", content: text.slice(last) });
  return result;
}

function CopyCodeBtn({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function MessageContent({
  text,
  activeRepo,
  onCommit,
}: {
  text: string;
  activeRepo: RepoContext | null;
  onCommit: (path: string, code: string) => void;
}) {
  const parts = splitCodeBlocks(text);
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <span key={i} className="whitespace-pre-wrap">
              {part.content}
            </span>
          );
        }
        const { lang, filename, code } = part;
        return (
          <div key={i} className="my-3 rounded-xl overflow-hidden border border-white/10 text-left">
            <div className="flex items-center justify-between bg-black/40 px-3 py-2">
              <div className="flex items-center gap-2 overflow-hidden">
                {lang && <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded font-mono text-primary/80">{lang}</span>}
                {filename && <span className="text-[11px] text-white/50 font-mono truncate max-w-[140px]">{filename}</span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <CopyCodeBtn code={code} />
                {filename && activeRepo && (
                  <button
                    onClick={() => onCommit(filename!, code)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary/20 hover:bg-primary/30 text-[10px] text-primary font-medium transition-colors"
                    data-testid={`commit-btn-${filename}`}
                  >
                    <Github className="h-3 w-3" /> Commit
                  </button>
                )}
              </div>
            </div>
            <pre className="p-3 text-[12.5px] leading-relaxed overflow-x-auto bg-[#0d1117] text-[#e6edf3] font-mono">
              <code>{code}</code>
            </pre>
          </div>
        );
      })}
    </>
  );
}

const REPO_SUGGESTIONS = [
  "Create or update my CLAUDE.md file",
  "Search for a TODO comment and fix it",
  "Recommend areas to improve our tests",
  "Explain the main architecture",
  "Review recent changes and suggest improvements",
];

export function ChatPane({ conversationId, prefilledInput, autoSend, repoContext, onPrefilledInputClear }: ChatPaneProps) {
  const [model, setModel] = useState("llama-3.3");
  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [queuedMessage, setQueuedMessage] = useState<{ text: string; attachments: Attachment[] } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [likes, setLikes] = useState<Record<string, "like" | "dislike">>(() => {
    try { return JSON.parse(localStorage.getItem("msg-likes") || "{}"); } catch { return {}; }
  });
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const synth = window.speechSynthesis;

  const [activeRepo, setActiveRepo] = useState<RepoContext | null>(() => {
    try { return JSON.parse(localStorage.getItem("active_repo") || "null"); } catch { return null; }
  });
  const [repos, setRepos] = useState<GHRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");

  const [commitTarget, setCommitTarget] = useState<{ path: string; code: string } | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);

  const repoPromptCache = useRef<Record<string, string>>({});

  const { data: conversation } = useGetOpenrouterConversation(conversationId!, {
    query: { enabled: !!conversationId, queryKey: getGetOpenrouterConversationQueryKey(conversationId!) },
  });
  const { data: messagesData } = useListOpenrouterMessages(conversationId!, {
    query: { enabled: !!conversationId, queryKey: getListOpenrouterMessagesQueryKey(conversationId!) },
  });
  const createConversation = useCreateOpenrouterConversation();
  const messages = messagesData || [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingContent, attachments, queuedMessage]);

  useEffect(() => {
    if (repoContext) {
      setActiveRepo(repoContext);
      localStorage.setItem("active_repo", JSON.stringify(repoContext));
    }
  }, [repoContext]);

  const handleSendRef = useRef<((override?: { text: string; attachments: Attachment[] }) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!prefilledInput) return;
    if (autoSend) {
      const t = setTimeout(() => { handleSendRef.current?.({ text: prefilledInput, attachments: [] }); }, 80);
      onPrefilledInputClear?.();
      return () => clearTimeout(t);
    } else {
      setInput(prefilledInput);
      onPrefilledInputClear?.();
    }
  }, [prefilledInput]);

  useEffect(() => {
    if (supportsSpeech) {
      const r = new SpeechRecognition();
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (ev: any) => {
        let final = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
        }
        if (final) setInput((p) => p + (p ? " " : "") + final);
      };
      r.onerror = () => setIsListening(false);
      r.onend = () => setIsListening(false);
      recognitionRef.current = r;
    }
    return () => synth?.cancel();
  }, []);

  const toggleListen = () => {
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); }
    else { recognitionRef.current?.start(); setIsListening(true); }
  };

  const compressImage = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1024;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round((height * MAX) / width); width = MAX; }
            else { width = Math.round((width * MAX) / height); height = MAX; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.75));
        };
        img.src = e.target!.result as string;
      };
      reader.readAsDataURL(file);
    });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 4 - attachments.length);
    files.forEach(async (file) => {
      if (file.type.startsWith("video/")) {
        const reader = new FileReader();
        reader.onload = (ev) => { if (ev.target?.result) setAttachments((p) => [...p, { type: "video", data: ev.target!.result as string, file }]); };
        reader.readAsDataURL(file);
      } else {
        const compressed = await compressImage(file);
        setAttachments((p) => [...p, { type: "image", data: compressed, file }]);
      }
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const buildRepoSystemPrompt = useCallback(async (repo: RepoContext): Promise<string> => {
    if (repoPromptCache.current[repo.fullName]) return repoPromptCache.current[repo.fullName];
    const token = localStorage.getItem("github_token");
    let readme = "";
    let fileTree = "";
    try {
      const headers: Record<string, string> = { Accept: "application/vnd.github.v3.raw" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const [readmeRes, treeRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${repo.fullName}/readme`, { headers }),
        fetch(`https://api.github.com/repos/${repo.fullName}/git/trees/HEAD?recursive=1`, {
          headers: { ...headers, Accept: "application/vnd.github.v3+json" },
        }),
      ]);
      if (readmeRes.ok) {
        readme = await readmeRes.text();
        if (readme.length > 6000) readme = readme.slice(0, 6000) + "\n...(truncated)";
      }
      if (treeRes.ok) {
        const treeData = await treeRes.json() as { tree: { path: string; type: string }[] };
        const paths = treeData.tree
          .filter((f) => f.type === "blob" && !f.path.includes("node_modules") && !f.path.startsWith("."))
          .map((f) => f.path)
          .slice(0, 200);
        fileTree = paths.join("\n");
      }
    } catch {}

    const prompt = `You are an AI coding assistant with full context of the GitHub repository: ${repo.fullName}.
Owner: ${repo.owner} | Repo: ${repo.repo}

${readme ? `## README\n\`\`\`\n${readme}\n\`\`\`\n` : ""}${fileTree ? `## File Tree\n\`\`\`\n${fileTree}\n\`\`\`` : ""}

When the user asks about this project, answer based on the repository context above. You can read files, suggest code changes, and help commit code back to the repo. When writing code to be committed, start the code block with \`// File: path/to/file\` so the user can commit it directly.`;

    repoPromptCache.current[repo.fullName] = prompt;
    return prompt;
  }, []);

  const handleSend = useCallback(async (overrideContent?: { text: string; attachments: Attachment[] }) => {
    const textToSend = overrideContent ? overrideContent.text : input;
    const attachmentsToSend = overrideContent ? overrideContent.attachments : attachments;
    if (!textToSend.trim() && attachmentsToSend.length === 0) return;

    if (isStreaming) {
      setQueuedMessage({ text: textToSend, attachments: attachmentsToSend });
      if (!overrideContent) { setInput(""); setAttachments([]); }
      return;
    }

    let payloadStr = textToSend;
    if (attachmentsToSend.length > 0) {
      payloadStr = JSON.stringify({ text: textToSend, attachments: attachmentsToSend.map((a) => ({ type: a.type, data: a.data })) });
    }
    if (!overrideContent) { setInput(""); setAttachments([]); }

    let targetId = conversationId;
    if (!targetId) {
      const title = textToSend.split(" ").slice(0, 6).join(" ") + "...";
      const newConv = await createConversation.mutateAsync({ data: { title: title.trim() || "New Chat" } });
      targetId = newConv.id;
      queryClient.invalidateQueries({ queryKey: getListOpenrouterConversationsQueryKey() });
      setLocation(`/c/${targetId}`);
    }

    setIsStreaming(true);
    setStreamingContent("");
    abortControllerRef.current = new AbortController();

    try {
      const systemPrompt = activeRepo ? await buildRepoSystemPrompt(activeRepo) : undefined;

      const authToken = localStorage.getItem("auth_token");
      const res = await fetch(`/api/openrouter/conversations/${targetId}/messages?model=${model}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ content: payloadStr, ...(systemPrompt ? { systemPrompt } : {}) }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error || `Request failed (${res.status})`);
      }

      queryClient.invalidateQueries({ queryKey: getListOpenrouterMessagesQueryKey(targetId) });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6);
          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr);
            if (data.done) break;
            if (data.error) throw new Error(data.error);
            if (data.content) { assistantText += data.content; setStreamingContent(assistantText); }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Stream error:", err);
        toast({
          title: "AI Error",
          description: err.message || "Failed to get a response. Check your API key and model availability.",
          variant: "destructive",
        });
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      abortControllerRef.current = null;
      if (targetId) {
        queryClient.invalidateQueries({ queryKey: getListOpenrouterMessagesQueryKey(targetId) });
        queryClient.invalidateQueries({ queryKey: getGetOpenrouterConversationQueryKey(targetId) });
      }
    }
  }, [input, attachments, isStreaming, conversationId, model, createConversation, queryClient, setLocation]);

  handleSendRef.current = handleSend;

  useEffect(() => {
    if (!isStreaming && queuedMessage) {
      const msg = queuedMessage;
      setQueuedMessage(null);
      handleSend(msg);
    }
  }, [isStreaming, queuedMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const setLike = (id: number, type: "like" | "dislike") => {
    setLikes((prev) => {
      const next = prev[id] === type ? null : type;
      const updated = { ...prev };
      if (next) updated[id] = next; else delete updated[id];
      localStorage.setItem("msg-likes", JSON.stringify(updated));
      return updated;
    });
  };

  const handleCopy = (text: string) => { navigator.clipboard.writeText(text); toast({ title: "Copied!", duration: 2000 }); };
  const toggleSpeech = (id: number, text: string) => {
    if (speakingId === id) { synth.cancel(); setSpeakingId(null); }
    else { synth.cancel(); const u = new SpeechSynthesisUtterance(text); u.onend = () => setSpeakingId(null); synth.speak(u); setSpeakingId(id); }
  };

  const fetchRepos = async () => {
    const token = localStorage.getItem("github_token");
    if (!token) return;
    setIsLoadingRepos(true);
    try {
      const res = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
      });
      if (res.ok) setRepos(await res.json());
    } catch {} finally {
      setIsLoadingRepos(false);
    }
  };

  const handleOpenRepoPicker = () => {
    setRepoPickerOpen(true);
    if (repos.length === 0) fetchRepos();
  };

  const handleSelectRepo = (repo: GHRepo) => {
    const ctx: RepoContext = { fullName: repo.full_name, owner: repo.owner.login, repo: repo.name };
    setActiveRepo(ctx);
    localStorage.setItem("active_repo", JSON.stringify(ctx));
    setRepoPickerOpen(false);
    setRepoSearch("");
  };

  const handleClearRepo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveRepo(null);
    localStorage.removeItem("active_repo");
  };

  const handleCommitOpen = (path: string, code: string) => {
    setCommitTarget({ path, code });
    setCommitMsg(`Update ${path} via AI Chat`);
  };

  const doCommit = async () => {
    if (!commitTarget || !activeRepo) return;
    const token = localStorage.getItem("github_token");
    if (!token) { toast({ title: "No GitHub token found", variant: "destructive" }); return; }
    setIsCommitting(true);
    try {
      let sha: string | undefined;
      try {
        const existing = await fetch(`https://api.github.com/repos/${activeRepo.fullName}/contents/${commitTarget.path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
        });
        if (existing.ok) sha = (await existing.json()).sha;
      } catch {}
      const body: Record<string, string> = { message: commitMsg || `Update ${commitTarget.path}`, content: encodeBase64(commitTarget.code) };
      if (sha) body.sha = sha;
      const res = await fetch(`https://api.github.com/repos/${activeRepo.fullName}/contents/${commitTarget.path}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast({ title: `Committed ${commitTarget.path}`, description: `To ${activeRepo.fullName}`, duration: 3000 });
        setCommitTarget(null);
      } else {
        const err = await res.json().catch(() => ({})) as Record<string, string>;
        throw new Error(err.message || `GitHub error ${res.status}`);
      }
    } catch (err: unknown) {
      toast({ title: "Commit failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsCommitting(false);
    }
  };

  const [hasToken, setHasToken] = useState(() => !!localStorage.getItem("github_token"));
  useEffect(() => {
    const handler = () => setHasToken(!!localStorage.getItem("github_token"));
    window.addEventListener("github-token-changed", handler);
    return () => window.removeEventListener("github-token-changed", handler);
  }, []);

  const filteredRepos = repos.filter((r) => r.full_name.toLowerCase().includes(repoSearch.toLowerCase()));
  const showSuggestions = !conversationId && messages.length === 0 && !isStreaming;

  return (
    <div className="flex h-full flex-col bg-background relative">
      {/* Header */}
      <div className="flex h-14 items-center border-b px-4 flex-shrink-0 relative">
        <div className="ml-10 md:ml-0 flex-1 flex justify-center md:justify-start">
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="border-0 bg-transparent shadow-none focus:ring-0 text-base font-semibold gap-1 w-auto px-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Active repo banner */}
      {activeRepo && (
        <div className="flex justify-center py-1.5 border-b border-border/40 shrink-0 bg-primary/5">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs text-muted-foreground border border-primary/20 bg-background/80">
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <Github className="h-3 w-3 text-primary/70 shrink-0" />
            <span className="font-medium text-foreground max-w-[200px] truncate">{activeRepo.fullName}</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground/80">context active</span>
            <button onClick={handleClearRepo} className="ml-1 text-muted-foreground/50 hover:text-foreground transition-colors">
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl space-y-8 pb-10">
          {showSuggestions && (
            <div className="flex flex-col space-y-6 pt-8">
              {activeRepo && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground px-1">Suggestions</p>
                  <div className="flex flex-col gap-2">
                    {REPO_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleSend({ text: s, attachments: [] })}
                        className="text-left px-4 py-3 rounded-xl border border-border/60 bg-muted/30 hover:bg-muted/60 text-sm transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!activeRepo && (
                <div className="flex h-[40vh] flex-col items-center justify-center text-center space-y-4">
                  <div className="rounded-full bg-primary/10 p-4">
                    <Code2 className="h-8 w-8 text-primary" />
                  </div>
                  <h1 className="text-2xl font-bold">How can I help you today?</h1>
                  <p className="text-muted-foreground max-w-md text-sm">Start a conversation or connect a GitHub repo to get coding assistance.</p>
                </div>
              )}
            </div>
          )}

          {messages.map((msg) => {
            const parsed = parseMessage(msg.content);
            const likeState = likes[msg.id];
            const isAssistant = msg.role !== "user";
            return (
              <div key={msg.id} className={`group flex w-full flex-col ${isAssistant ? "items-start" : "items-end"}`}>
                <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                  isAssistant ? "bg-muted text-foreground" : "bg-primary text-primary-foreground"
                } ${likeState === "like" ? "ring-2 ring-green-500 ring-offset-2 ring-offset-background" : ""}
                   ${likeState === "dislike" ? "ring-2 ring-red-500 ring-offset-2 ring-offset-background" : ""}` }>
                  {parsed.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {parsed.attachments.map((att: any, i: number) => (
                        <div key={i} className="relative rounded-md overflow-hidden bg-black/10">
                          {att.type === "image"
                            ? <img src={att.data} alt="attachment" className="max-w-[200px] max-h-[200px] object-cover" />
                            : <video src={att.data} controls className="max-w-[200px] max-h-[200px] object-cover" />}
                        </div>
                      ))}
                    </div>
                  )}
                  {isAssistant
                    ? <MessageContent text={parsed.text} activeRepo={activeRepo} onCommit={handleCommitOpen} />
                    : <span className="whitespace-pre-wrap">{parsed.text}</span>}
                </div>

                <div className={`flex items-center gap-1 mt-1.5 px-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity ${isAssistant ? "justify-start" : "justify-end"}`}>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => handleCopy(parsed.text)} data-testid="msg-action-copy">
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  </Button>
                  {isAssistant && (
                    <>
                      <Button variant="ghost" size="icon" className={`h-6 w-6 rounded-full ${likeState === "like" ? "bg-green-500/20" : ""}`} onClick={() => setLike(msg.id, "like")} data-testid="msg-action-like">
                        <ThumbsUp className={`h-3 w-3 ${likeState === "like" ? "text-green-500" : "text-muted-foreground"}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className={`h-6 w-6 rounded-full ${likeState === "dislike" ? "bg-red-500/20" : ""}`} onClick={() => setLike(msg.id, "dislike")} data-testid="msg-action-dislike">
                        <ThumbsDown className={`h-3 w-3 ${likeState === "dislike" ? "text-red-500" : "text-muted-foreground"}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className={`h-6 w-6 rounded-full ${speakingId === msg.id ? "bg-primary/20 text-primary" : ""}`} onClick={() => toggleSpeech(msg.id, parsed.text)} data-testid="msg-action-speak">
                        {speakingId === msg.id ? <StopCircle className="h-3 w-3" /> : <Volume2 className="h-3 w-3 text-muted-foreground" />}
                      </Button>
                    </>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" data-testid="msg-action-share">
                        <Share2 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-40 p-1" align={isAssistant ? "start" : "end"}>
                      <div className="flex flex-col">
                        <Button variant="ghost" size="sm" className="justify-start text-xs font-normal h-8" onClick={() => navigator.clipboard.writeText(window.location.href)}>Copy link</Button>
                        <Button variant="ghost" size="sm" className="justify-start text-xs font-normal h-8" onClick={() => handleCopy(parsed.text)}>Copy text</Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            );
          })}

          {isStreaming && (
            <div className="flex w-full justify-start">
              <div className="max-w-[88%] rounded-2xl px-4 py-3 bg-muted text-foreground">
                <MessageContent text={streamingContent} activeRepo={activeRepo} onCommit={handleCommitOpen} />
                <span className="ml-1 inline-block h-4 w-2 bg-primary animate-pulse align-middle" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t bg-card p-4 flex-shrink-0">
        <div className="mx-auto max-w-3xl space-y-2">

          {/* Top bar: + button + repo badge + queue indicator */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-full shrink-0"
              onClick={() => fileInputRef.current?.click()}
              disabled={attachments.length >= 4}
              data-testid="attach-btn"
            >
              <Plus className="h-4 w-4" />
            </Button>

            {hasToken ? (
              <button
                onClick={handleOpenRepoPicker}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-background hover:bg-muted transition-colors text-xs font-medium"
                data-testid="repo-picker-trigger"
              >
                <Github className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground max-w-[120px] truncate">
                  {activeRepo ? activeRepo.fullName : "Choose repo"}
                </span>
                {activeRepo && (
                  <X className="h-3 w-3 text-muted-foreground hover:text-foreground ml-0.5" onClick={handleClearRepo} />
                )}
              </button>
            ) : null}

            {queuedMessage && (
              <div className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-medium border border-primary/20 ml-auto">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                1 queued
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] hover:bg-primary/20" onClick={() => abortControllerRef.current?.abort()} data-testid="force-send-btn">
                  <X className="h-3 w-3 mr-0.5" /> Force
                </Button>
              </div>
            )}
          </div>

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {attachments.map((att, i) => (
                <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden bg-muted flex-shrink-0 border group">
                  {att.type === "image" ? <img src={att.data} alt="preview" className="w-full h-full object-cover" /> : <video src={att.data} className="w-full h-full object-cover" />}
                  <button className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input card */}
          <div className="rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-primary transition-shadow overflow-hidden">
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*,video/*" multiple onChange={handleFileChange} />
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeRepo ? "Code anything..." : "Message..."}
              className="min-h-[52px] max-h-48 w-full resize-none border-0 bg-transparent py-3.5 px-4 focus-visible:ring-0 rounded-none shadow-none text-[15px]"
              rows={1}
            />
            {/* Bottom bar of input card */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-border/40">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Code2 className="h-3.5 w-3.5" />
                <span className="font-medium">Code</span>
              </div>
              <div className="flex items-center gap-1">
                {supportsSpeech && (
                  <Button variant="ghost" size="icon" className={`h-8 w-8 transition-colors ${isListening ? "text-red-500 animate-pulse bg-red-500/10" : "text-muted-foreground hover:text-foreground"}`} onClick={toggleListen} data-testid="mic-btn">
                    <Mic className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  className={`h-8 w-8 rounded-lg transition-all ${input.trim() || attachments.length > 0 ? "opacity-100" : "opacity-40"}`}
                  disabled={!input.trim() && attachments.length === 0}
                  onClick={() => handleSend()}
                  data-testid="send-btn"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">AI can make mistakes. Verify important information.</p>
        </div>
      </div>

      {/* Repo Picker Bottom Sheet */}
      {repoPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setRepoPickerOpen(false)}>
          <div className="w-full max-w-2xl mx-auto bg-card rounded-t-2xl border-t border-x shadow-2xl max-h-[75vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center pt-2 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
            </div>
            <div className="flex items-center px-5 py-3 shrink-0">
              <button onClick={() => setRepoPickerOpen(false)} className="h-8 w-8 rounded-full bg-muted flex items-center justify-center mr-3" data-testid="close-repo-picker">
                <X className="h-4 w-4" />
              </button>
              <h3 className="font-semibold text-base">Choose repository</h3>
            </div>

            <ScrollArea className="flex-1 px-5">
              {isLoadingRepos ? (
                <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : filteredRepos.length === 0 && !isLoadingRepos ? (
                <div className="py-10 text-center text-sm text-muted-foreground">{repoSearch ? "No repos match" : "No repositories found"}</div>
              ) : (
                filteredRepos.map((repo) => {
                  const isSelected = activeRepo?.fullName === repo.full_name;
                  return (
                    <div
                      key={repo.id}
                      className="flex items-center justify-between py-3.5 border-b border-border/40 last:border-0 cursor-pointer hover:bg-muted/30 -mx-5 px-5 transition-colors"
                      onClick={() => handleSelectRepo(repo)}
                      data-testid={`repo-picker-item-${repo.id}`}
                    >
                      <div>
                        <div className="font-medium text-sm">{repo.full_name}</div>
                        <div className="text-xs text-muted-foreground">{repo.owner.login}</div>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </div>
                  );
                })
              )}
            </ScrollArea>

            <div className="p-4 border-t shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                  className="pl-9 bg-muted/40 border-0 focus-visible:ring-1"
                  data-testid="repo-picker-search"
                  autoFocus
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Commit Dialog */}
      {commitTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCommitTarget(null)}>
          <div className="bg-card border rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-semibold text-base mb-1">Commit to GitHub</h3>
              <p className="text-xs text-muted-foreground font-mono truncate bg-muted px-2 py-1 rounded">{activeRepo?.fullName} / {commitTarget.path}</p>
            </div>
            <Input
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message..."
              className="text-sm"
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setCommitTarget(null)}>Cancel</Button>
              <Button className="flex-1" onClick={doCommit} disabled={isCommitting} data-testid="do-commit-btn">
                {isCommitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Github className="h-4 w-4 mr-2" />}
                Commit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
