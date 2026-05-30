import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, User, Key, CreditCard, Check, Copy, Trash2, Plus,
  Eye, EyeOff, Loader2, Star, Zap, Building2, LogOut, Shield,
} from "lucide-react";

interface UserData { id: number; name: string; email: string; plan: string; }
interface ApiKeyData { id: number; name: string; keyPrefix: string; createdAt: string; lastUsedAt: string | null; }

const PLAN_INFO = {
  starter: { label: "Starter", color: "text-muted-foreground", bg: "bg-muted", icon: Star },
  pro: { label: "Pro", color: "text-primary", bg: "bg-primary/10", icon: Zap },
  business: { label: "Business", color: "text-amber-500", bg: "bg-amber-500/10", icon: Building2 },
};

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    price: "Free",
    period: "",
    icon: Star,
    color: "border-border",
    highlight: false,
    features: [
      "100 messages per day",
      "3 AI models",
      "GitHub integration",
      "Conversation history",
      "Voice input & TTS",
    ],
    cta: "Current Plan",
    ctaVariant: "outline" as const,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$12",
    period: "/month",
    icon: Zap,
    color: "border-primary",
    highlight: true,
    features: [
      "Unlimited messages",
      "All 5 AI models",
      "GitHub integration",
      "Priority responses",
      "API key access (3 keys)",
      "Message export",
    ],
    cta: "Upgrade to Pro",
    ctaVariant: "default" as const,
  },
  {
    id: "business",
    name: "Business",
    price: "Custom",
    period: "",
    icon: Building2,
    color: "border-amber-500/50",
    highlight: false,
    features: [
      "Everything in Pro",
      "Unlimited API keys",
      "Team accounts",
      "Custom model limits",
      "Priority support",
      "SLA guarantee",
    ],
    cta: "Contact Sales",
    ctaVariant: "outline" as const,
  },
];

function AuthSection({ onLogin }: { onLogin: (user: UserData, token: string) => void }) {
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = tab === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body = tab === "signup" ? { name, email, password } : { email, password };
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong"); return; }
      localStorage.setItem("auth_token", data.token);
      onLogin(data.user, data.token);
      toast({ title: tab === "signup" ? "Account created!" : "Welcome back!", duration: 2000 });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-4">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-primary/10 mb-3">
          <User className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Your account</h2>
        <p className="text-sm text-muted-foreground mt-1">Sign in to manage your plans and API keys</p>
      </div>

      <div className="flex rounded-lg bg-muted p-1 mb-6">
        <button
          onClick={() => { setTab("signin"); setError(""); }}
          className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-colors ${tab === "signin" ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}
        >
          Sign In
        </button>
        <button
          onClick={() => { setTab("signup"); setError(""); }}
          className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-colors ${tab === "signup" ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}
        >
          Sign Up
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {tab === "signup" && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={tab === "signin"} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input id="password" type={showPass ? "text" : "password"} placeholder={tab === "signup" ? "At least 6 characters" : "••••••••"} value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" />
            <button type="button" onClick={() => setShowPass((p) => !p)} className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors">
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {tab === "signup" ? "Create account" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

function AccountSection({ user, onLogout }: { user: UserData; onLogout: () => void }) {
  const info = PLAN_INFO[user.plan as keyof typeof PLAN_INFO] || PLAN_INFO.starter;
  const PlanIcon = info.icon;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 p-5 rounded-xl border bg-card">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary flex-shrink-0">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-base truncate">{user.name}</div>
          <div className="text-sm text-muted-foreground truncate">{user.email}</div>
          <div className={`inline-flex items-center gap-1.5 mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${info.bg} ${info.color}`}>
            <PlanIcon className="h-3 w-3" />
            {info.label} Plan
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 p-4 rounded-xl border bg-card/50">
        <Shield className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-medium">Account security</div>
          <div className="text-xs text-muted-foreground">Your data is encrypted and stored securely</div>
        </div>
      </div>
      <Button variant="outline" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30" onClick={onLogout}>
        <LogOut className="h-4 w-4 mr-2" />
        Sign Out
      </Button>
    </div>
  );
}

function PlansSection({ user, onPlanChange }: { user: UserData | null; onPlanChange?: (plan: string) => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelect = async (planId: string) => {
    if (!user) { toast({ title: "Sign in first", description: "Create an account to manage your plan", variant: "destructive" }); return; }
    if (user.plan === planId) return;
    if (planId === "business") { toast({ title: "Contact us", description: "Email business@aichat.app for Business pricing" }); return; }
    setLoading(planId);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/auth/plan", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: planId }) });
      if (res.ok) { onPlanChange?.(planId); toast({ title: `Switched to ${planId === "pro" ? "Pro" : "Starter"}`, duration: 2000 }); }
    } finally { setLoading(null); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Choose the plan that fits your needs. Upgrade or downgrade anytime.</p>
      <div className="grid gap-4">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          const isCurrent = user?.plan === plan.id;
          return (
            <div key={plan.id} className={`rounded-xl border-2 p-5 transition-all ${plan.highlight ? plan.color : isCurrent ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${plan.id === "pro" ? "bg-primary/10" : plan.id === "business" ? "bg-amber-500/10" : "bg-muted"}`}>
                    <Icon className={`h-5 w-5 ${plan.id === "pro" ? "text-primary" : plan.id === "business" ? "text-amber-500" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <div className="font-semibold text-base flex items-center gap-2">
                      {plan.name}
                      {isCurrent && <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-medium">Current</span>}
                      {plan.highlight && !isCurrent && <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium">Popular</span>}
                    </div>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-xl font-bold">{plan.price}</span>
                      <span className="text-xs text-muted-foreground">{plan.period}</span>
                    </div>
                  </div>
                </div>
              </div>
              <ul className="space-y-2 mb-4">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                variant={isCurrent ? "outline" : plan.ctaVariant}
                className={`w-full ${plan.id === "business" ? "border-amber-500/40 text-amber-500 hover:bg-amber-500/10" : ""}`}
                disabled={isCurrent || loading === plan.id}
                onClick={() => handleSelect(plan.id)}
              >
                {loading === plan.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isCurrent ? "Current Plan" : plan.cta}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ApiKeysSection({ user }: { user: UserData | null }) {
  const [keys, setKeys] = useState<ApiKeyData[]>([]);
  const [loading, setLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();

  const canUseKeys = user && (user.plan === "pro" || user.plan === "business");
  const token = localStorage.getItem("auth_token");

  useEffect(() => {
    if (!canUseKeys) return;
    setLoading(true);
    fetch("/api/keys", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setKeys(d.keys || []))
      .finally(() => setLoading(false));
  }, [canUseKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: newKeyName.trim() }) });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error || "Failed to create key", variant: "destructive" }); return; }
      setKeys((prev) => [data.key, ...prev]);
      setNewlyCreated(data.key.rawKey);
      setNewKeyName("");
    } finally { setCreating(false); }
  };

  const handleRevoke = async (id: number) => {
    await fetch(`/api/keys/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    setKeys((prev) => prev.filter((k) => k.id !== id));
    toast({ title: "Key revoked", duration: 2000 });
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Key className="h-10 w-10 text-muted-foreground mb-3" />
        <h3 className="font-semibold mb-1">Sign in required</h3>
        <p className="text-sm text-muted-foreground">Create an account to generate API keys</p>
      </div>
    );
  }

  if (!canUseKeys) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Key className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold mb-1">Pro plan required</h3>
          <p className="text-sm text-muted-foreground max-w-xs">Upgrade to Pro or Business to generate API keys for your other projects</p>
        </div>
        <Button variant="default" onClick={() => toast({ title: "Switch to the Plans tab to upgrade" })}>
          <Zap className="h-4 w-4 mr-2" />
          View Plans
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground mb-4">Generate API keys to use this AI service in your other projects. Keep keys private and never share them.</p>
        <form onSubmit={handleCreate} className="flex gap-2">
          <Input placeholder="Key name (e.g. My App)" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} className="flex-1" />
          <Button type="submit" disabled={creating || !newKeyName.trim()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="ml-1.5">Generate</span>
          </Button>
        </form>
      </div>

      {newlyCreated && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Check className="h-4 w-4" />
            API key created — copy it now, it won't be shown again
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-background border rounded-md px-3 py-2 font-mono break-all">{newlyCreated}</code>
            <Button size="icon" variant="outline" className="shrink-0 h-9 w-9" onClick={() => copyText(newlyCreated, "new")}>
              {copiedId === "new" ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-6" onClick={() => setNewlyCreated(null)}>Dismiss</Button>
        </div>
      )}

      {loading ? (
        <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : keys.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No API keys yet. Generate one above.</div>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
              <Key className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{k.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{k.keyPrefix}••••••••••••</div>
              </div>
              <div className="text-[10px] text-muted-foreground text-right shrink-0">
                <div>Created {new Date(k.createdAt).toLocaleDateString()}</div>
                {k.lastUsedAt && <div>Used {new Date(k.lastUsedAt).toLocaleDateString()}</div>}
              </div>
              <button
                onClick={() => handleRevoke(k.id)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Revoke key"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border bg-muted/30 p-4 space-y-1.5">
        <div className="text-sm font-medium">How to use your API key</div>
        <div className="text-xs text-muted-foreground">Send requests to your API with the Authorization header:</div>
        <code className="text-xs bg-background border rounded px-2 py-1 block font-mono">
          Authorization: Bearer sk-ai-...
        </code>
        <div className="text-xs text-muted-foreground pt-1">Base URL: <span className="font-mono text-foreground">{window.location.origin}/api</span></div>
      </div>
    </div>
  );
}

type Tab = "account" | "plans" | "apikeys";

export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("account");
  const [user, setUser] = useState<UserData | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { setLoadingUser(false); return; }
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.user) setUser(d.user); })
      .finally(() => setLoadingUser(false));
  }, []);

  const handleLogin = (userData: UserData) => setUser(userData);

  const handleLogout = () => {
    localStorage.removeItem("auth_token");
    setUser(null);
  };

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "account", label: "Account", icon: User },
    { id: "plans", label: "Plans", icon: CreditCard },
    { id: "apikeys", label: "API Keys", icon: Key },
  ];

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-14 items-center gap-3 border-b px-4 flex-shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-semibold text-base">Settings</h1>
        {user && (
          <div className="ml-auto flex items-center gap-2">
            <div className={`text-xs font-medium px-2 py-0.5 rounded-full ${PLAN_INFO[user.plan as keyof typeof PLAN_INFO]?.bg || "bg-muted"} ${PLAN_INFO[user.plan as keyof typeof PLAN_INFO]?.color || ""}`}>
              {PLAN_INFO[user.plan as keyof typeof PLAN_INFO]?.label || user.plan}
            </div>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b bg-background shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-4 md:p-6">
          {loadingUser ? (
            <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {activeTab === "account" && (
                user
                  ? <AccountSection user={user} onLogout={handleLogout} />
                  : <AuthSection onLogin={handleLogin} />
              )}
              {activeTab === "plans" && (
                <PlansSection user={user} onPlanChange={(plan) => setUser((u) => u ? { ...u, plan } : u)} />
              )}
              {activeTab === "apikeys" && <ApiKeysSection user={user} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
