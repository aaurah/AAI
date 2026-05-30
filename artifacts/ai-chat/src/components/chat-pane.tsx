import { useState, useRef, useEffect } from "react";
import { useGetOpenrouterConversation, useListOpenrouterMessages, useCreateOpenrouterConversation, getListOpenrouterConversationsQueryKey, getListOpenrouterMessagesQueryKey, getGetOpenrouterConversationQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, TerminalSquare } from "lucide-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

interface ChatPaneProps {
  conversationId?: number;
}

const MODELS = [
  { id: "llama-3.3", name: "Llama 3.3 70B" },
  { id: "mistral", name: "Mistral Small" },
  { id: "gemma", name: "Gemma 3" },
  { id: "qwen", name: "Qwen 3.6 Flash" }
];

export function ChatPane({ conversationId }: ChatPaneProps) {
  const [model, setModel] = useState("llama-3.3");
  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: conversation } = useGetOpenrouterConversation(conversationId!, {
    query: { enabled: !!conversationId, queryKey: getGetOpenrouterConversationQueryKey(conversationId!) }
  });

  const { data: messagesData } = useListOpenrouterMessages(conversationId!, {
    query: { enabled: !!conversationId, queryKey: getListOpenrouterMessagesQueryKey(conversationId!) }
  });

  const createConversation = useCreateOpenrouterConversation();

  const messages = messagesData || [];

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    let targetId = conversationId;
    const contentToSend = input;
    setInput("");

    // Create conversation if it doesn't exist
    if (!targetId) {
      const title = contentToSend.split(" ").slice(0, 6).join(" ") + "...";
      const newConv = await createConversation.mutateAsync({ data: { title } });
      targetId = newConv.id;
      queryClient.invalidateQueries({ queryKey: getListOpenrouterConversationsQueryKey() });
      setLocation(`/c/${targetId}`);
    }

    // Now start the stream
    setIsStreaming(true);
    setStreamingContent("");

    try {
      // Optimistically add user message to cache? Not strictly needed if we just refetch, 
      // but let's at least show the user message in local state or wait for refetch.
      // Easiest: invalidate immediately so user message shows up.
      // Wait, we need to POST the message first. The stream endpoint handles both creating the user message AND streaming the assistant response.
      
      const res = await fetch(`/api/openrouter/conversations/${targetId}/messages?model=${model}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: contentToSend })
      });

      // Refetch immediately to get the user message that was just created
      queryClient.invalidateQueries({ queryKey: getListOpenrouterMessagesQueryKey(targetId) });

      if (!res.body) throw new Error("No body in response");
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (!dataStr) continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.done) {
                break;
              }
              if (data.content) {
                assistantText += data.content;
                setStreamingContent(assistantText);
              }
            } catch (e) {
              console.error("Failed to parse SSE chunk", e);
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to stream:", err);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      if (targetId) {
        queryClient.invalidateQueries({ queryKey: getListOpenrouterMessagesQueryKey(targetId) });
        queryClient.invalidateQueries({ queryKey: getGetOpenrouterConversationQueryKey(targetId) });
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-14 items-center border-b px-4 md:px-6">
        <h2 className="ml-10 md:ml-0 text-lg font-semibold tracking-tight">
          {conversation?.title || "New Workspace"}
        </h2>
      </div>

      {/* Chat Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 md:p-6"
      >
        <div className="mx-auto max-w-3xl space-y-6">
          {!conversationId && messages.length === 0 && (
            <div className="flex h-[50vh] flex-col items-center justify-center text-center space-y-4">
              <div className="rounded-full bg-primary/10 p-4">
                <TerminalSquare className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">How can I help you today?</h1>
              <p className="text-muted-foreground max-w-md">
                Start a new conversation. Your chat history is saved automatically.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[85%] rounded-lg px-4 py-3 ${
                msg.role === "user" 
                  ? "bg-primary text-primary-foreground" 
                  : "bg-muted text-foreground"
              }`}>
                <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
                  {msg.content}
                </div>
              </div>
            </div>
          ))}

          {isStreaming && (
            <div className="flex w-full justify-start">
              <div className="max-w-[85%] rounded-lg px-4 py-3 bg-muted text-foreground">
                <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
                  {streamingContent}
                  <span className="ml-1 inline-block h-4 w-2 bg-primary animate-pulse align-middle" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t bg-card p-4">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex items-center justify-between">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-[180px] h-8 text-xs bg-background border-border">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
              Private Workspace
            </div>
          </div>
          <div className="relative flex items-end overflow-hidden rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-primary">
            <Textarea 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              className="min-h-12 w-full resize-none border-0 bg-transparent py-3 pl-4 pr-12 focus-visible:ring-0 rounded-none shadow-none text-sm"
              rows={1}
            />
            <Button 
              size="icon" 
              className="absolute bottom-1.5 right-1.5 h-8 w-8 rounded-lg"
              disabled={!input.trim() || isStreaming}
              onClick={handleSend}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 text-center text-xs text-muted-foreground">
            Press Enter to send, Shift+Enter for new line. AI can make mistakes.
          </div>
        </div>
      </div>
    </div>
  );
}
