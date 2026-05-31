import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2 } from "lucide-react";

interface AuthModalProps {
  onAuth: () => void;
}

export function AuthModal({ onAuth }: AuthModalProps) {
  const [tab, setTab] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const endpoint = tab === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body = tab === "login" ? { email, password } : { name, email, password };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      localStorage.setItem("auth_token", data.token);
      onAuth();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-card border rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="rounded-full bg-primary/10 p-3">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-xl font-bold">Welcome to AI Chat</h2>
          <p className="text-sm text-muted-foreground">Sign in or create an account to start chatting</p>
        </div>

        <div className="flex rounded-lg bg-muted p-1 text-sm">
          <button
            type="button"
            onClick={() => setTab("signup")}
            className={`flex-1 py-1.5 rounded-md font-medium transition-colors ${
              tab === "signup" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Sign Up
          </button>
          <button
            type="button"
            onClick={() => setTab("login")}
            className={`flex-1 py-1.5 rounded-md font-medium transition-colors ${
              tab === "login" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Sign In
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {tab === "signup" && (
            <Input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              autoFocus
            />
          )}
          <Input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={tab === "login"}
          />
          <Input
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {tab === "signup" ? "Create Account & Chat" : "Sign In & Chat"}
          </Button>
        </form>

        <p className="text-center text-[11px] text-muted-foreground">
          Your account is used to save your conversations.
        </p>
      </div>
    </div>
  );
}
