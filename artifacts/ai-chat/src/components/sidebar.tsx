import { useListOpenrouterConversations, useCreateOpenrouterConversation, useDeleteOpenrouterConversation, getListOpenrouterConversationsQueryKey } from "@workspace/api-client-react";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

interface SidebarProps {
  activeId?: number;
  onCloseMobile: () => void;
}

export function Sidebar({ activeId, onCloseMobile }: SidebarProps) {
  const { data: conversations, isLoading } = useListOpenrouterConversations();
  const createConversation = useCreateOpenrouterConversation();
  const deleteConversation = useDeleteOpenrouterConversation();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const handleNew = () => {
    setLocation("/");
    onCloseMobile();
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    deleteConversation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOpenrouterConversationsQueryKey() });
        if (activeId === id) {
          setLocation("/");
        }
      }
    });
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="p-4 border-b">
        <Button onClick={handleNew} className="w-full justify-start gap-2" variant="default">
          <Plus className="h-4 w-4" />
          New Conversation
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">Loading...</div>
          )}
          
          {!isLoading && (!conversations || conversations.length === 0) && (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">
              No conversations yet
            </div>
          )}

          {conversations?.map((conv) => (
            <Link key={conv.id} href={`/c/${conv.id}`}>
              <div 
                onClick={onCloseMobile}
                className={`group flex items-center justify-between rounded-md px-3 py-2 text-sm cursor-pointer transition-colors ${
                  activeId === conv.id 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                }`}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <MessageSquare className="h-4 w-4 shrink-0 opacity-70" />
                  <div className="flex flex-col overflow-hidden">
                    <span className="truncate">{conv.title || "New Chat"}</span>
                    <span className="text-[10px] opacity-50">
                      {format(new Date(conv.createdAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                </div>
                
                <button 
                  onClick={(e) => handleDelete(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-opacity"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </Link>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
