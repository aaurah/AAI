import { useState, useRef, useEffect, useCallback } from "react";
import { Terminal, ChevronRight, X, Copy, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function getToken(): string | null {
  try { return localStorage.getItem("auth_token"); } catch { return null; }
}

// ── ANSI colour parser ────────────────────────────────────────────────────────
const ANSI_COLOURS_16: Record<number, string> = {
  30: "#4d4d4d", 31: "#ff5555", 32: "#50fa7b", 33: "#f1fa8c",
  34: "#6272a4", 35: "#ff79c6", 36: "#8be9fd", 37: "#f8f8f2",
  90: "#6d6d6d", 91: "#ff6e6e", 92: "#69ff94", 93: "#ffffa5",
  94: "#d6acff", 95: "#ff92df", 96: "#a4ffff", 97: "#ffffff",
};
const ANSI_BG_16: Record<number, string> = {
  40: "#1e1e2e", 41: "#45020b", 42: "#014b20", 43: "#4b4500",
  44: "#00204b", 45: "#4b0033", 46: "#00434b", 47: "#4b4b4b",
};

interface Span { text: string; fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; }

function ansiToSpans(raw: string): Span[] {
  const spans: Span[] = [];
  let fg: string | undefined;
  let bg: string | undefined;
  let bold = false, dim = false, italic = false, underline = false;
  // strip carriage returns (overwrite lines → just keep last)
  const cleaned = raw.replace(/[^\r\n]*\r([^\n])/g, "$1").replace(/\r/g, "");
  const parts = cleaned.split(/(\x1b\[[0-9;]*m|\x1b\[[0-9;]*[A-HJKSTfhl]|\x1b\[\?[0-9]+[lh]|\x1b\[[0-9]*[dGr])/);
  for (const part of parts) {
    if (part.startsWith("\x1b[")) {
      const inner = part.slice(2, -1);
      if (!inner || inner === "0") { fg = bg = undefined; bold = dim = italic = underline = false; continue; }
      const codes = inner.split(";").map(Number);
      let i = 0;
      while (i < codes.length) {
        const c = codes[i];
        if (c === 1) { bold = true; }
        else if (c === 2) { dim = true; }
        else if (c === 3) { italic = true; }
        else if (c === 4) { underline = true; }
        else if (c === 22) { bold = false; dim = false; }
        else if (c === 23) { italic = false; }
        else if (c === 24) { underline = false; }
        else if (c === 39) { fg = undefined; }
        else if (c === 49) { bg = undefined; }
        else if (c >= 30 && c <= 37) { fg = ANSI_COLOURS_16[c]; }
        else if (c >= 90 && c <= 97) { fg = ANSI_COLOURS_16[c]; }
        else if (c >= 40 && c <= 47) { bg = ANSI_BG_16[c]; }
        else if (c === 38 && codes[i + 1] === 5) { fg = xterm256(codes[i + 2]); i += 2; }
        else if (c === 38 && codes[i + 1] === 2) { fg = `rgb(${codes[i+2]},${codes[i+3]},${codes[i+4]})`; i += 4; }
        else if (c === 48 && codes[i + 1] === 5) { bg = xterm256(codes[i + 2]); i += 2; }
        else if (c === 48 && codes[i + 1] === 2) { bg = `rgb(${codes[i+2]},${codes[i+3]},${codes[i+4]})`; i += 4; }
        i++;
      }
    } else if (part) {
      spans.push({ text: part, fg, bg, bold, dim, italic, underline });
    }
  }
  return spans;
}

function xterm256(n: number): string {
  if (n < 16) return Object.values(ANSI_COLOURS_16)[n] || "#888";
  if (n < 232) {
    const idx = n - 16;
    const b = idx % 6, g = Math.floor(idx / 6) % 6, r = Math.floor(idx / 36);
    const v = (x: number) => x ? x * 40 + 55 : 0;
    return `rgb(${v(r)},${v(g)},${v(b)})`;
  }
  const l = 8 + (n - 232) * 10;
  return `rgb(${l},${l},${l})`;
}

function AnsiLine({ text }: { text: string }) {
  const spans = ansiToSpans(text);
  return (
    <span>
      {spans.map((s, i) => (
        <span key={i} style={{
          color: s.fg,
          background: s.bg,
          fontWeight: s.bold ? "bold" : undefined,
          opacity: s.dim ? 0.6 : undefined,
          fontStyle: s.italic ? "italic" : undefined,
          textDecoration: s.underline ? "underline" : undefined,
        }}>{s.text}</span>
      ))}
    </span>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
type LineKind = "stdout" | "stderr" | "system" | "input";
interface Line { id: number; kind: LineKind; text: string; }

let lineId = 0;

// ── Component ─────────────────────────────────────────────────────────────────
export function TerminalPanel() {
  const [lines, setLines] = useState<Line[]>([
    { id: lineId++, kind: "system", text: "AI Terminal — type any shell command and press Enter\r\n" },
  ]);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [maximized, setMaximized] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const push = useCallback((kind: LineKind, text: string) => {
    setLines(prev => [...prev, { id: lineId++, kind, text }]);
  }, []);

  // Load CWD on mount
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch(`${BASE}/api/terminal/cwd`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => d.cwd && setCwd(d.cwd)).catch(() => {});
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const runCommand = useCallback(async (cmd: string) => {
    const token = getToken();
    if (!token) { push("system", "Not logged in\r\n"); return; }
    if (!cmd.trim()) return;

    setHistory(h => [cmd, ...h.filter(x => x !== cmd)].slice(0, 200));
    setHistIdx(-1);
    setRunning(true);
    push("input", cmd);

    // Handle client-side built-ins
    if (cmd.trim() === "clear" || cmd.trim() === "cls") {
      setLines([]);
      setRunning(false);
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`${BASE}/api/terminal/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: cmd }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        push("stderr", `Error: ${res.status} ${res.statusText}\r\n`);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt.type === "stdout") push("stdout", evt.text);
            else if (evt.type === "stderr") push("stderr", evt.text);
            else if (evt.type === "clear") setLines([]);
            else if (evt.type === "cwd" && evt.cwd) setCwd(evt.cwd);
            else if (evt.type === "done") {
              if (evt.cwd) setCwd(evt.cwd);
              if (evt.exitCode !== 0) push("system", `[exit ${evt.exitCode}]\r\n`);
            }
          } catch {}
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") push("stderr", `${e?.message || "Unknown error"}\r\n`);
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, [push]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !running) {
      runCommand(input);
      setInput("");
    } else if (e.key === "c" && e.ctrlKey) {
      abortRef.current?.abort();
      push("system", "^C\r\n");
      setRunning(false);
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setInput(history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInput(next === -1 ? "" : history[next] ?? "");
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  const cwdShort = cwd.replace(process?.env?.HOME || "/home/runner", "~").replace(/\/home\/runner\/workspace/, "~/workspace");
  const promptDir = cwd ? cwdShort : "~";

  return (
    <div className={`flex flex-col h-full ${maximized ? "fixed inset-0 z-50 bg-background" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 glass shrink-0">
        <div className="flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-semibold text-foreground">Terminal</span>
          <span className="text-[9px] text-muted-foreground ml-1 font-mono truncate max-w-[150px]">{promptDir}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Copy all output"
            onClick={() => navigator.clipboard.writeText(lines.map(l => l.text).join(""))}>
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Clear" onClick={() => setLines([])}>
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" title={maximized ? "Restore" : "Maximize"}
            onClick={() => setMaximized(m => !m)}>
            {maximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Output */}
      <ScrollArea className="flex-1 min-h-0">
        <div
          className="font-mono text-[11.5px] leading-[1.55] p-3 whitespace-pre-wrap break-all min-h-full cursor-text"
          style={{ background: "var(--terminal-bg, hsl(var(--background)))" }}
          onClick={() => inputRef.current?.focus()}
        >
          {lines.map(l => (
            <div key={l.id} className={
              l.kind === "input"
                ? "text-primary/80"
                : l.kind === "stderr"
                ? "text-red-400/90"
                : l.kind === "system"
                ? "text-muted-foreground/60 italic"
                : ""
            }>
              {l.kind === "input" ? (
                <span>
                  <span className="text-green-400 select-none">{promptDir} </span>
                  <span className="text-primary/70 select-none">❯ </span>
                  <AnsiLine text={l.text} />
                </span>
              ) : (
                <AnsiLine text={l.text} />
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input prompt */}
      <div
        className="flex items-center gap-1.5 px-3 py-2 border-t border-border/40 glass shrink-0 font-mono text-[11.5px]"
        onClick={() => inputRef.current?.focus()}
      >
        <span className="text-green-400 shrink-0 select-none">{promptDir}</span>
        <ChevronRight className="h-3 w-3 text-primary/60 shrink-0" />
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder={running ? "Running…" : ""}
          className="flex-1 bg-transparent outline-none border-none text-foreground placeholder:text-muted-foreground/40 caret-primary"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-testid="terminal-input"
        />
        {running && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
            title="Kill (Ctrl+C)"
            onClick={() => { abortRef.current?.abort(); push("system", "^C\r\n"); setRunning(false); }}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
