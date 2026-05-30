import { useState, useRef, useEffect } from "react";
import { useGetOpenrouterConversation, useListOpenrouterMessages, useCreateOpenrouterConversation, getListOpenrouterConversationsQueryKey, getListOpenrouterMessagesQueryKey, getGetOpenrouterConversationQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Send, TerminalSquare, Paperclip, X, ThumbsUp, ThumbsDown, Copy, Share2, Volume2, Mic, StopCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface ChatPaneProps {
  conversationId?: number;
  prefilledInput?: string;
  onPrefilledInputClear?: () => void;
}

const MODELS = [
  { id: "llama-3.3", name: "Llama 3.3 70B" },
  { id: "llama-4-scout", name: "Llama 4 Scout (Vision)" },
  { id: "mistral", name: "Mistral Small" },
  { id: "gemma", name: "Gemma 3" },
  { id: "qwen", name: "Qwen 3.6 Flash" }
];

type Attachment = { type: "image" | "video", data: string, file?: File };

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const supportsSpeech = !!SpeechRecognition;

const parseMessage = (content: string) => {
  try {
    const parsed = JSON.parse(content);
    if (parsed.attachments && Array.isArray(parsed.attachments)) {
      return { text: parsed.text || "", attachments: parsed.attachments };
    }
  } catch(e) {}
  return { text: content, attachments: [] };
};

export function ChatPane({ conversationId, prefilledInput, onPrefilledInputClear }: ChatPaneProps) {
  const [model, setModel] = useState("llama-3.3");
  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  
  useEffect(() => {
    if (prefilledInput) {
      setInput(prefilledInput);
      onPrefilledInputClear?.();
    }
  }, [prefilledInput, onPrefilledInputClear]);
  
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [queuedMessage, setQueuedMessage] = useState<{ text: string, attachments: Attachment[] } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [likes, setLikes] = useState<Record<string, 'like' | 'dislike'>>(() => {
    try {
      return JSON.parse(localStorage.getItem('msg-likes') || '{}');
    } catch {
      return {};
    }
  });
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const synth = window.speechSynthesis;

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
  }, [messages, streamingContent, attachments, queuedMessage]);

  useEffect(() => {
    if (supportsSpeech) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      
      recognition.onresult = (event: any) => {
        let finalTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setInput(prev => prev + (prev ? " " : "") + finalTranscript);
        }
      };
      
      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };
      
      recognition.onend = () => {
        setIsListening(false);
      };
      
      recognitionRef.current = recognition;
    }
    return () => {
      synth?.cancel();
    };
  }, []);

  const toggleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
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
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.75));
        };
        img.src = e.target!.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const availableSlots = 4 - attachments.length;
    const toAdd = files.slice(0, availableSlots);

    toAdd.forEach(async (file) => {
      if (file.type.startsWith("video/")) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            setAttachments(prev => [...prev, { type: "video", data: event.target!.result as string, file }]);
          }
        };
        reader.readAsDataURL(file);
      } else {
        const compressed = await compressImage(file);
        setAttachments(prev => [...prev, { type: "image", data: compressed, file }]);
      }
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSend = async (overrideContent?: { text: string, attachments: Attachment[] }) => {
    const textToSend = overrideContent ? overrideContent.text : input;
    const attachmentsToSend = overrideContent ? overrideContent.attachments : attachments;
    
    if (!textToSend.trim() && attachmentsToSend.length === 0) return;
    
    if (isStreaming) {
      setQueuedMessage({ text: textToSend, attachments: attachmentsToSend });
      if (!overrideContent) {
        setInput("");
        setAttachments([]);
      }
      return;
    }

    let payloadStr = textToSend;
    if (attachmentsToSend.length > 0) {
      payloadStr = JSON.stringify({
        text: textToSend,
        attachments: attachmentsToSend.map(a => ({ type: a.type, data: a.data }))
      });
    }

    if (!overrideContent) {
      setInput("");
      setAttachments([]);
    }

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
      const res = await fetch(`/api/openrouter/conversations/${targetId}/messages?model=${model}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: payloadStr }),
        signal: abortControllerRef.current.signal
      });

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
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Stream aborted');
      } else {
        console.error("Failed to stream:", err);
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
  };

  useEffect(() => {
    if (!isStreaming && queuedMessage) {
      const msg = queuedMessage;
      setQueuedMessage(null);
      handleSend(msg);
    }
  }, [isStreaming, queuedMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const setLike = (id: number, type: 'like' | 'dislike') => {
    setLikes(prev => {
      const current = prev[id];
      const next = current === type ? null : type;
      const newLikes = { ...prev };
      if (next) {
        newLikes[id] = next;
      } else {
        delete newLikes[id];
      }
      localStorage.setItem('msg-likes', JSON.stringify(newLikes));
      return newLikes;
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", duration: 2000 });
  };

  const toggleSpeech = (id: number, text: string) => {
    if (speakingId === id) {
      synth.cancel();
      setSpeakingId(null);
    } else {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setSpeakingId(null);
      synth.speak(utterance);
      setSpeakingId(id);
    }
  };

  const handleShare = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Text copied to clipboard!", duration: 2000 });
  };

  const handleShareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast({ title: "Link copied to clipboard!", duration: 2000 });
  };

  return (
    <div className="flex h-full flex-col bg-background relative">
      {/* Header */}
      <div className="flex h-14 items-center border-b px-4 md:px-6 flex-shrink-0">
        <h2 className="ml-10 md:ml-0 text-lg font-semibold tracking-tight">
          {conversation?.title || "New Workspace"}
        </h2>
      </div>

      {/* Chat Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 md:p-6"
      >
        <div className="mx-auto max-w-3xl space-y-8 pb-10">
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

          {messages.map((msg) => {
            const parsed = parseMessage(msg.content);
            const likeState = likes[msg.id];
            const isAssistant = msg.role !== "user";

            return (
              <div 
                key={msg.id} 
                className={`group flex w-full flex-col ${isAssistant ? "items-start" : "items-end"}`}
              >
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  isAssistant 
                    ? "bg-muted text-foreground"
                    : "bg-primary text-primary-foreground" 
                } ${likeState === 'like' ? 'ring-2 ring-green-500 ring-offset-2 ring-offset-background' : ''} ${likeState === 'dislike' ? 'ring-2 ring-red-500 ring-offset-2 ring-offset-background' : ''}`}>
                  
                  {parsed.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {parsed.attachments.map((att, i) => (
                        <div key={i} className="relative rounded-md overflow-hidden bg-black/10">
                          {att.type === "image" ? (
                            <img src={att.data} alt="attachment" className="max-w-[200px] max-h-[200px] object-cover" />
                          ) : (
                            <video src={att.data} controls className="max-w-[200px] max-h-[200px] object-cover" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
                    {parsed.text}
                  </div>
                </div>

                {/* Per-message action toolbar */}
                <div className={`flex items-center gap-1 mt-1.5 px-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity ${isAssistant ? "justify-start" : "justify-end"}`}>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => handleCopy(parsed.text)} data-testid="msg-action-copy">
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  </Button>
                  
                  {isAssistant && (
                    <>
                      <Button variant="ghost" size="icon" className={`h-6 w-6 rounded-full ${likeState === 'like' ? 'bg-green-500/20' : ''}`} onClick={() => setLike(msg.id, 'like')} data-testid="msg-action-like">
                        <ThumbsUp className={`h-3 w-3 ${likeState === 'like' ? 'text-green-500' : 'text-muted-foreground'}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className={`h-6 w-6 rounded-full ${likeState === 'dislike' ? 'bg-red-500/20' : ''}`} onClick={() => setLike(msg.id, 'dislike')} data-testid="msg-action-dislike">
                        <ThumbsDown className={`h-3 w-3 ${likeState === 'dislike' ? 'text-red-500' : 'text-muted-foreground'}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className={`h-6 w-6 rounded-full ${speakingId === msg.id ? 'bg-primary/20 text-primary' : ''}`} onClick={() => toggleSpeech(msg.id, parsed.text)} data-testid="msg-action-speak">
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
                        <Button variant="ghost" size="sm" className="justify-start text-xs font-normal h-8" onClick={handleShareLink}>Copy link</Button>
                        <Button variant="ghost" size="sm" className="justify-start text-xs font-normal h-8" onClick={() => handleShare(parsed.text)}>Copy text</Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            );
          })}

          {isStreaming && (
            <div className="flex w-full justify-start">
              <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-muted text-foreground">
                <div className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
                  {streamingContent}
                  <span className="ml-1 inline-block h-4 w-2 bg-primary animate-pulse align-middle" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t bg-card p-4 flex-shrink-0">
        <div className="mx-auto max-w-3xl relative">
          
          <div className="mb-2 flex items-center justify-between h-8">
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

            <div className="flex items-center gap-2">
              {queuedMessage && (
                <div className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-medium border border-primary/20">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  1 message queued
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-5 px-2 ml-1 text-[10px] uppercase tracking-wider hover:bg-primary/20"
                    onClick={() => abortControllerRef.current?.abort()}
                    data-testid="force-send-btn"
                  >
                    <X className="h-3 w-3 mr-1" /> Force Send
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="relative flex flex-col overflow-hidden rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-primary transition-shadow">
            
            {attachments.length > 0 && (
              <div className="flex gap-2 p-3 pb-0 overflow-x-auto">
                {attachments.map((att, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-md overflow-hidden bg-muted flex-shrink-0 border group">
                    {att.type === 'image' ? (
                      <img src={att.data} alt="preview" className="w-full h-full object-cover" />
                    ) : (
                      <video src={att.data} className="w-full h-full object-cover" />
                    )}
                    <button 
                      className="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end relative">
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*,video/*" 
                multiple
                onChange={handleFileChange}
              />
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute left-2 bottom-1.5 h-8 w-8 text-muted-foreground hover:text-foreground z-10"
                onClick={() => fileInputRef.current?.click()}
                disabled={attachments.length >= 4}
                data-testid="attach-btn"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              
              <Textarea 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message..."
                className="min-h-[52px] max-h-60 w-full resize-none border-0 bg-transparent py-3.5 pl-12 pr-24 focus-visible:ring-0 rounded-none shadow-none text-[15px]"
                rows={1}
              />
              
              <div className="absolute right-2 bottom-1.5 flex items-center gap-1">
                {supportsSpeech && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 transition-colors ${isListening ? 'text-red-500 animate-pulse bg-red-500/10' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={toggleListen}
                    data-testid="mic-btn"
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                )}
                
                <Button 
                  size="icon" 
                  className={`h-8 w-8 rounded-lg transition-transform ${input.trim() || attachments.length > 0 ? 'scale-100' : 'opacity-50'}`}
                  disabled={(!input.trim() && attachments.length === 0)}
                  onClick={() => handleSend()}
                  data-testid="send-btn"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          
          <div className="mt-2 text-center text-xs text-muted-foreground font-medium">
            AI can make mistakes. Verify important information.
          </div>
        </div>
      </div>
    </div>
  );
}
