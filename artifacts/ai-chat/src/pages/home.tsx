import { useLocation, useParams } from "wouter";
import { Sidebar } from "@/components/sidebar";
import { ChatPane } from "@/components/chat-pane";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface RepoContext {
  fullName: string;
  owner: string;
  repo: string;
}

export default function Home() {
  const params = useParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [prefilledInput, setPrefilledInput] = useState<string>("");
  const [autoSend, setAutoSend] = useState(false);
  const [repoContext, setRepoContext] = useState<RepoContext | null>(null);
  const [, setLocation] = useLocation();

  const conversationId = params.id ? parseInt(params.id, 10) : undefined;

  const handleLoadFile = (filename: string, content: string) => {
    setPrefilledInput(`File: **${filename}**\n\`\`\`\n${content}\n\`\`\``);
    setAutoSend(false);
    setSidebarOpen(false);
  };

  const handleOpenRepoChat = (fullName: string, owner: string, repo: string, _files: string[]) => {
    setRepoContext({ fullName, owner, repo });
    setPrefilledInput("");
    setAutoSend(false);
    setLocation("/");
    setSidebarOpen(false);
  };

  const handlePrefilledClear = () => {
    setPrefilledInput("");
    setAutoSend(false);
  };

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`fixed inset-y-0 left-0 z-50 w-[272px] transform border-r bg-sidebar transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <Sidebar
          activeId={conversationId}
          onCloseMobile={() => setSidebarOpen(false)}
          onLoadFile={handleLoadFile}
          onOpenRepoChat={handleOpenRepoChat}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden relative">
        <div className="absolute top-4 left-4 z-10 md:hidden">
          <Button variant="outline" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
        </div>

        <ChatPane
          conversationId={conversationId}
          prefilledInput={prefilledInput}
          autoSend={autoSend}
          repoContext={repoContext}
          onPrefilledInputClear={handlePrefilledClear}
        />
      </div>
    </div>
  );
}
