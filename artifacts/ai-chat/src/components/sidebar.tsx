import { useState, useRef } from "react";
import { useListOpenrouterConversations, useDeleteOpenrouterConversation, getListOpenrouterConversationsQueryKey } from "@workspace/api-client-react";
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

interface SwipeState {
  startX: number;
  currentX: number;
  swiping: boolean;
}

const SWIPE_THRESHOLD = 80;

function ConversationItem({
  conv,
  isActive,
  onDelete,
  onCloseMobile,
}: {
  conv: { id: number; title: string; createdAt: string };
  isActive: boolean;
  onDelete: (id: number) => void;
  onCloseMobile: () => void;
}) {
  const swipeRef = useRef<SwipeState>({ startX: 0, currentX: 0, swiping: false });
  const [offset, setOffset] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  const clampedOffset = Math.min(0, Math.max(-SWIPE_THRESHOLD - 20, offset));
  const deleteVisible = clampedOffset < -8;
  const pastThreshold = clampedOffset <= -SWIPE_THRESHOLD;

  const handleTouchStart = (e: React.TouchEvent) => {
    swipeRef.current = {
      startX: e.touches[0].clientX,
      currentX: e.touches[0].clientX,
      swiping: true,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeRef.current.swiping) return;
    const dx = e.touches[0].clientX - swipeRef.current.startX;
    swipeRef.current.currentX = e.touches[0].clientX;
    if (dx > 0) {
      setOffset(0);
      return;
    }
    setOffset(dx);
  };

  const handleTouchEnd = () => {
    swipeRef.current.swiping = false;
    if (offset <= -SWIPE_THRESHOLD) {
      setIsDeleting(true);
      onDelete(conv.id);
    } else {
      setOffset(0);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    swipeRef.current = { startX: e.clientX, currentX: e.clientX, swiping: true };
    const onMove = (ev: MouseEvent) => {
      if (!swipeRef.current.swiping) return;
      const dx = ev.clientX - swipeRef.current.startX;
      swipeRef.current.currentX = ev.clientX;
      if (dx > 0) { setOffset(0); return; }
      setOffset(dx);
    };
    const onUp = () => {
      swipeRef.current.swiping = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setOffset((prev) => {
        if (prev <= -SWIPE_THRESHOLD) {
          setIsDeleting(true);
          onDelete(conv.id);
          return prev;
        }
        return 0;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (isDeleting) return null;

  return (
    <div className="relative overflow-hidden rounded-md" data-testid={`conv-item-${conv.id}`}>
      {/* Delete background */}
      <div
        className={`absolute inset-y-0 right-0 flex items-center justify-center transition-colors rounded-md ${
          pastThreshold ? "bg-destructive" : "bg-destructive/70"
        }`}
        style={{ width: Math.abs(clampedOffset) || 0 }}
      >
        {deleteVisible && (
          <Trash2 className="h-4 w-4 text-white shrink-0" />
        )}
      </div>

      {/* Swipeable row */}
      <Link href={`/c/${conv.id}`}>
        <div
          ref={itemRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onClick={offset === 0 ? onCloseMobile : undefined}
          style={{ transform: `translateX(${clampedOffset}px)`, transition: swipeRef.current.swiping ? "none" : "transform 0.2s ease" }}
          className={`group flex items-center justify-between rounded-md px-3 py-2 text-sm cursor-pointer select-none ${
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent/50"
          }`}
          data-testid={`conv-row-${conv.id}`}
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
            data-testid={`conv-delete-btn-${conv.id}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(conv.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-opacity shrink-0"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </Link>
    </div>
  );
}

export function Sidebar({ activeId, onCloseMobile }: SidebarProps) {
  const { data: conversations, isLoading } = useListOpenrouterConversations();
  const deleteConversation = useDeleteOpenrouterConversation();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const handleNew = () => {
    setLocation("/");
    onCloseMobile();
  };

  const handleDelete = (id: number) => {
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
        <Button
          onClick={handleNew}
          className="w-full justify-start gap-2"
          variant="default"
          data-testid="new-conversation-btn"
        >
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
            <ConversationItem
              key={conv.id}
              conv={conv}
              isActive={activeId === conv.id}
              onDelete={handleDelete}
              onCloseMobile={onCloseMobile}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
