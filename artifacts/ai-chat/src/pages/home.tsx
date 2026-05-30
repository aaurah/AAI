import { useLocation, useParams } from "wouter";
import { Sidebar } from "@/components/sidebar";
import { ChatPane } from "@/components/chat-pane";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const params = useParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [prefilledInput, setPrefilledInput] = useState<string>("");
  const [, setLocation] = useLocation();

  const conversationId = params.id ? parseInt(params.id, 10) : undefined;

  const handleLoadFile = (filename: string, content: string) => {
    setPrefilledInput(`File: ${filename}\n\`\`\`\n${content}\n\`\`\``);
    setLocation("/");
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 w-[272px] transform border-r bg-sidebar transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <Sidebar activeId={conversationId} onCloseMobile={() => setSidebarOpen(false)} onLoadFile={handleLoadFile} />
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden relative">
        <div className="absolute top-4 left-4 z-10 md:hidden">
          <Button variant="outline" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
        </div>
        
        <ChatPane conversationId={conversationId} prefilledInput={prefilledInput} onPrefilledInputClear={() => setPrefilledInput("")} />
      </div>
    </div>
  );
}
