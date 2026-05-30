import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Users, MessageSquare, Key, BarChart3, Trash2, Shield, ShieldOff,
  Search, ArrowLeft, Loader2, RefreshCw, Star, Zap, Building2,
  ChevronRight, Download, Activity, X, Check, CheckSquare,
  Square, Menu, TrendingUp, Hash, User, Clock, Filter,
} from "lucide-react";

interface AdminUser {
  id: number; name: string; email: string; plan: string;
  isAdmin: boolean; createdAt: string;
}
interface AdminConv {
  id: number; title: string; createdAt: string; messageCount: number;
}
interface Stats {
  users: number; conversations: number; messages: number; apiKeys: number;
  admins: number; avgMsgsPerConv: string;
  planBreakdown: { plan: string; count: number }[];
}
interface ActivityEvent {
  type: "signup" | "conversation"; label: string; sub: string;
  plan?: string; time: string;
}

const PLAN_COLOR: Record<string, string> = {
  starter: "text-muted-foreground bg-muted border-transparent",
  pro: "text-primary bg-primary/10 border-primary/20",
  business: "text-amber-500 bg-amber-500/10 border-amber-500/20",
};
const PLAN_DOT: Record<string, string> = {
  starter: "bg-muted-foreground/50",
  pro: "bg-primary",
  business: "bg-amber-500",
};

function authHeaders() {
  const t = localStorage.getItem("auth_token");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function exportCSV(data: AdminUser[]) {
  const header = "id,name,email,plan,isAdmin,createdAt";
  const rows = data.map(u => `${u.id},"${u.name}","${u.email}",${u.plan},${u.isAdmin},${u.createdAt}`);
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "users.csv"; a.click();
  URL.revokeObjectURL(url);
}

type Section = "overview" | "users" | "conversations" | "activity";

const NAV: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "users", label: "Users", icon: Users },
  { id: "conversations", label: "Chats", icon: MessageSquare },
  { id: "activity", label: "Activity", icon: Activity },
];

function StatCard({ label, value, icon: Icon, color, sub }: { label: string; value: number | string; icon: React.ElementType; color: string; sub?: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-2">
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="h-4.5 w-4.5 h-[18px] w-[18px]" />
      </div>
      <div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border capitalize ${PLAN_COLOR[plan] || PLAN_COLOR.starter}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${PLAN_DOT[plan] || PLAN_DOT.starter}`} />
      {plan}
    </span>
  );
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  return (
    <div className={`${sz} rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary flex-shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function AdminPanel() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [section, setSection] = useState<Section>("overview");
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [convs, setConvs] = useState<AdminConv[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Users filters
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [selectedUsers, setSelectedUsers] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Conversations filters
  const [convSearch, setConvSearch] = useState("");
  const [selectedConvs, setSelectedConvs] = useState<Set<number>>(new Set());

  // User detail drawer
  const [drawerUser, setDrawerUser] = useState<AdminUser | null>(null);

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem("auth_token");
    if (!token) { setLoading(false); return; }
    const res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      if (data.user?.isAdmin) setAuthorized(true);
    }
    setLoading(false);
  }, []);

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/admin/stats", { headers: authHeaders() });
    if (res.ok) setStats(await res.json());
  }, []);
  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users", { headers: authHeaders() });
    if (res.ok) { const d = await res.json(); setUsers(d.users || []); }
  }, []);
  const loadConvs = useCallback(async () => {
    const res = await fetch("/api/admin/conversations", { headers: authHeaders() });
    if (res.ok) { const d = await res.json(); setConvs(d.conversations || []); }
  }, []);
  const loadActivity = useCallback(async () => {
    const res = await fetch("/api/admin/activity", { headers: authHeaders() });
    if (res.ok) { const d = await res.json(); setActivity(d.events || []); }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => {
    if (!authorized) return;
    loadStats(); loadUsers(); loadConvs(); loadActivity();
  }, [authorized]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadStats(), loadUsers(), loadConvs(), loadActivity()]);
    setRefreshing(false);
    toast({ title: "Refreshed", duration: 1500 });
  };

  const changePlan = async (userId: number, plan: string) => {
    const res = await fetch(`/api/admin/users/${userId}/plan`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ plan }) });
    if (res.ok) { setUsers(u => u.map(x => x.id === userId ? { ...x, plan } : x)); toast({ title: `Plan → ${plan}`, duration: 2000 }); }
  };
  const toggleAdmin = async (userId: number, current: boolean) => {
    const res = await fetch(`/api/admin/users/${userId}/admin`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ isAdmin: !current }) });
    if (res.ok) { setUsers(u => u.map(x => x.id === userId ? { ...x, isAdmin: !current } : x)); toast({ title: !current ? "Admin granted" : "Admin removed", duration: 2000 }); }
  };
  const deleteUser = async (userId: number, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE", headers: authHeaders() });
    if (res.ok) { setUsers(u => u.filter(x => x.id !== userId)); setSelectedUsers(s => { const n = new Set(s); n.delete(userId); return n; }); toast({ title: "User deleted", duration: 2000 }); }
  };
  const deleteConv = async (convId: number) => {
    if (!confirm("Delete this conversation and all its messages?")) return;
    const res = await fetch(`/api/admin/conversations/${convId}`, { method: "DELETE", headers: authHeaders() });
    if (res.ok) { setConvs(c => c.filter(x => x.id !== convId)); toast({ title: "Deleted", duration: 1500 }); }
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selectedUsers.size} users? This cannot be undone.`)) return;
    setBulkLoading(true);
    const res = await fetch("/api/admin/users/bulk-delete", { method: "POST", headers: authHeaders(), body: JSON.stringify({ ids: [...selectedUsers] }) });
    if (res.ok) {
      const d = await res.json();
      setUsers(u => u.filter(x => !selectedUsers.has(x.id)));
      setSelectedUsers(new Set());
      toast({ title: `${d.deleted} users deleted`, duration: 2000 });
    }
    setBulkLoading(false);
  };
  const bulkPlan = async (plan: string) => {
    setBulkLoading(true);
    const res = await fetch("/api/admin/users/bulk-plan", { method: "POST", headers: authHeaders(), body: JSON.stringify({ ids: [...selectedUsers], plan }) });
    if (res.ok) {
      setUsers(u => u.map(x => selectedUsers.has(x.id) ? { ...x, plan } : x));
      setSelectedUsers(new Set());
      toast({ title: `Updated to ${plan}`, duration: 2000 });
    }
    setBulkLoading(false);
  };
  const bulkDeleteConvs = async () => {
    if (!confirm(`Delete ${selectedConvs.size} conversations?`)) return;
    const res = await fetch("/api/admin/conversations", { method: "DELETE", headers: authHeaders(), body: JSON.stringify({ ids: [...selectedConvs] }) });
    if (res.ok) { setConvs(c => c.filter(x => !selectedConvs.has(x.id))); setSelectedConvs(new Set()); toast({ title: "Deleted", duration: 1500 }); }
  };

  const toggleSelectUser = (id: number) => setSelectedUsers(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAllUsers = () => {
    if (selectedUsers.size === filteredUsers.length) setSelectedUsers(new Set());
    else setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
  };
  const toggleSelectConv = (id: number) => setSelectedConvs(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAllConvs = () => {
    if (selectedConvs.size === filteredConvs.length) setSelectedConvs(new Set());
    else setSelectedConvs(new Set(filteredConvs.map(c => c.id)));
  };

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
  if (!authorized) return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-6">
      <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
        <Shield className="h-8 w-8 text-destructive" />
      </div>
      <h1 className="text-xl font-bold">Admin Access Required</h1>
      <p className="text-muted-foreground max-w-xs text-sm">Sign in with an admin account to access this panel.</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setLocation("/")}>← Home</Button>
        <Button onClick={() => setLocation("/settings")}>Sign In</Button>
      </div>
    </div>
  );

  const filteredUsers = users.filter(u => {
    const s = search.toLowerCase();
    const matchSearch = !s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s);
    const matchPlan = planFilter === "all" || u.plan === planFilter;
    return matchSearch && matchPlan;
  }).sort((a, b) => {
    if (sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "plan") return a.plan.localeCompare(b.plan);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const filteredConvs = convs.filter(c => !convSearch || c.title.toLowerCase().includes(convSearch.toLowerCase()));

  const currentSection = NAV.find(n => n.id === section);

  return (
    <div className="flex h-full flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex h-14 items-center gap-2 border-b px-3 flex-shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold text-sm hidden sm:block">Admin Panel</span>
          <span className="text-muted-foreground text-xs hidden sm:block">·</span>
          <span className="text-sm text-muted-foreground hidden sm:block">{currentSection?.label}</span>
          <span className="font-semibold text-sm sm:hidden">{currentSection?.label}</span>
        </div>
        <Button variant="ghost" size="icon" className={`h-8 w-8 shrink-0 ${refreshing ? "animate-spin" : ""}`} onClick={refresh} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — desktop only */}
        <nav className="hidden md:flex w-52 border-r bg-sidebar flex-shrink-0 flex-col py-2 gap-0.5 px-2">
          {NAV.map(s => {
            const Icon = s.icon;
            const badge = s.id === "users" ? users.length : s.id === "conversations" ? convs.length : s.id === "activity" ? activity.length : null;
            return (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full text-left ${section === s.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{s.label}</span>
                {badge !== null && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium tabular-nums ${section === s.id ? "bg-primary/20 text-primary" : "bg-muted-foreground/20 text-muted-foreground"}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
          <div className="mt-auto px-2 pb-2 pt-4 border-t mt-4">
            <div className="text-[10px] text-muted-foreground/60 space-y-0.5">
              <div>{users.length} users · {convs.length} chats</div>
            </div>
          </div>
        </nav>

        {/* Mobile bottom tab bar */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur flex items-stretch">
          {NAV.map(s => {
            const Icon = s.icon;
            return (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium transition-colors ${section === s.id ? "text-primary" : "text-muted-foreground"}`}>
                <Icon className={`h-5 w-5 ${section === s.id ? "text-primary" : ""}`} />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto pb-16 md:pb-0">

          {/* OVERVIEW */}
          {section === "overview" && (
            <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
              <div className="hidden md:block">
                <h2 className="text-lg font-semibold">Platform Overview</h2>
                <p className="text-sm text-muted-foreground">Live stats for your AI chat platform</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard label="Total Users" value={stats?.users ?? "—"} icon={Users} color="text-blue-500 bg-blue-500/10" />
                <StatCard label="Conversations" value={stats?.conversations ?? "—"} icon={MessageSquare} color="text-green-500 bg-green-500/10" />
                <StatCard label="Messages" value={stats?.messages ?? "—"} icon={Hash} color="text-purple-500 bg-purple-500/10" />
                <StatCard label="Avg msgs/chat" value={stats?.avgMsgsPerConv ?? "—"} icon={TrendingUp} color="text-cyan-500 bg-cyan-500/10" />
                <StatCard label="API Keys" value={stats?.apiKeys ?? "—"} icon={Key} color="text-amber-500 bg-amber-500/10" />
                <StatCard label="Admins" value={stats?.admins ?? "—"} icon={Shield} color="text-primary bg-primary/10" />
              </div>

              {stats?.planBreakdown && stats.planBreakdown.length > 0 && (
                <div className="rounded-2xl border bg-card p-4 space-y-3">
                  <h3 className="font-semibold text-sm">Plan Distribution</h3>
                  {["starter", "pro", "business"].map(plan => {
                    const entry = stats.planBreakdown.find(p => p.plan === plan);
                    const ct = entry ? Number(entry.count) : 0;
                    const total = Number(stats.users) || 1;
                    const pct = Math.round((ct / total) * 100);
                    return (
                      <div key={plan} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${PLAN_DOT[plan]}`} />
                            <span className="capitalize font-medium">{plan}</span>
                          </div>
                          <span className="text-muted-foreground tabular-nums">{ct} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${plan === "pro" ? "bg-primary" : plan === "business" ? "bg-amber-500" : "bg-muted-foreground/40"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-2xl border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <h3 className="font-semibold text-sm">Recent Signups</h3>
                  <button onClick={() => setSection("users")} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                    View all <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
                {users.slice(0, 5).map(u => (
                  <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => { setDrawerUser(u); setSection("users"); }}>
                    <Avatar name={u.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-1">
                        {u.name}
                        {u.isAdmin && <Shield className="h-3 w-3 text-primary inline shrink-0" />}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PlanBadge plan={u.plan} />
                      <span className="text-[10px] text-muted-foreground/60">{timeAgo(u.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* USERS */}
          {section === "users" && (
            <div className="p-3 md:p-6 space-y-3 max-w-4xl mx-auto">
              {/* Title + actions row */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold hidden md:block">Users</h2>
                  <p className="text-xs text-muted-foreground">{filteredUsers.length} of {users.length}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => exportCSV(filteredUsers)}>
                    <Download className="h-3.5 w-3.5" /> Export CSV
                  </Button>
                  <Button variant="outline" size="icon" className={`h-8 w-8 ${showFilters ? "bg-primary/10 text-primary border-primary/30" : ""}`} onClick={() => setShowFilters(f => !f)}>
                    <Filter className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Search + filters */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
                  {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
                </div>
                {showFilters && (
                  <div className="flex gap-2 flex-wrap">
                    <select value={planFilter} onChange={e => setPlanFilter(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value="all">All Plans</option>
                      <option value="starter">Starter</option>
                      <option value="pro">Pro</option>
                      <option value="business">Business</option>
                    </select>
                    <select value={sort} onChange={e => setSort(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="name">Name A–Z</option>
                      <option value="plan">By plan</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Bulk actions bar */}
              {selectedUsers.size > 0 && (
                <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-xl px-3 py-2">
                  <span className="text-xs font-medium text-primary">{selectedUsers.size} selected</span>
                  <div className="flex gap-1.5 ml-auto">
                    {["starter", "pro", "business"].map(p => (
                      <button key={p} disabled={bulkLoading} onClick={() => bulkPlan(p)}
                        className={`text-[10px] px-2 py-1 rounded-lg border font-medium transition-colors hover:bg-muted capitalize disabled:opacity-50 ${PLAN_COLOR[p]}`}>
                        → {p}
                      </button>
                    ))}
                    <button disabled={bulkLoading} onClick={bulkDelete} className="text-[10px] px-2 py-1 rounded-lg border border-destructive/30 text-destructive bg-destructive/5 font-medium hover:bg-destructive/10 disabled:opacity-50">
                      {bulkLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                    </button>
                    <button onClick={() => setSelectedUsers(new Set())} className="text-muted-foreground hover:text-foreground ml-1">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* User cards (mobile) / table (desktop) */}
              <div className="md:hidden space-y-2">
                <button onClick={toggleSelectAllUsers} className="text-xs text-muted-foreground flex items-center gap-1.5 px-1">
                  {selectedUsers.size === filteredUsers.length && filteredUsers.length > 0
                    ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                    : <Square className="h-3.5 w-3.5" />}
                  Select all
                </button>
                {filteredUsers.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No users found</div>
                ) : filteredUsers.map(u => (
                  <div key={u.id} className={`rounded-2xl border bg-card p-3 transition-all ${selectedUsers.has(u.id) ? "border-primary/40 bg-primary/5" : ""}`}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => toggleSelectUser(u.id)} className="mt-0.5 shrink-0">
                        {selectedUsers.has(u.id)
                          ? <CheckSquare className="h-4 w-4 text-primary" />
                          : <Square className="h-4 w-4 text-muted-foreground/50" />}
                      </button>
                      <Avatar name={u.name} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-sm">{u.name}</span>
                          {u.isAdmin && <Shield className="h-3 w-3 text-primary shrink-0" />}
                          <PlanBadge plan={u.plan} />
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                        <div className="text-[10px] text-muted-foreground/60 mt-0.5">Joined {timeAgo(u.createdAt)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 pt-2.5 border-t">
                      <select value={u.plan} onChange={e => changePlan(u.id, e.target.value)}
                        className={`text-xs rounded-lg px-2 py-1 font-medium border cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary flex-1 ${PLAN_COLOR[u.plan]}`}>
                        <option value="starter">Starter</option>
                        <option value="pro">Pro</option>
                        <option value="business">Business</option>
                      </select>
                      <button onClick={() => toggleAdmin(u.id, u.isAdmin)} title={u.isAdmin ? "Remove admin" : "Make admin"}
                        className={`p-2 rounded-xl transition-colors ${u.isAdmin ? "text-primary bg-primary/10" : "text-muted-foreground bg-muted"}`}>
                        {u.isAdmin ? <Shield className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
                      </button>
                      <button onClick={() => deleteUser(u.id, u.name)} className="p-2 rounded-xl text-muted-foreground bg-muted hover:text-destructive hover:bg-destructive/10 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block rounded-2xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <th className="px-4 py-3 w-8">
                        <button onClick={toggleSelectAllUsers}>
                          {selectedUsers.size === filteredUsers.length && filteredUsers.length > 0
                            ? <CheckSquare className="h-4 w-4 text-primary" />
                            : <Square className="h-4 w-4 text-muted-foreground/50" />}
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">User</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Joined</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Plan</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">No users found</td></tr>
                    ) : filteredUsers.map(u => (
                      <tr key={u.id} className={`border-b last:border-0 transition-colors ${selectedUsers.has(u.id) ? "bg-primary/5" : "hover:bg-muted/20"}`}>
                        <td className="px-4 py-3">
                          <button onClick={() => toggleSelectUser(u.id)}>
                            {selectedUsers.has(u.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground/40" />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={u.name} size="sm" />
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate flex items-center gap-1.5">
                                {u.name}
                                {u.isAdmin && <Shield className="h-3 w-3 text-primary shrink-0" />}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</div>
                          <div className="text-[10px] text-muted-foreground/60">{timeAgo(u.createdAt)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <select value={u.plan} onChange={e => changePlan(u.id, e.target.value)}
                            className={`text-xs rounded-full px-2 py-1 font-medium border cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary ${PLAN_COLOR[u.plan]}`}>
                            <option value="starter">Starter</option>
                            <option value="pro">Pro</option>
                            <option value="business">Business</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => toggleAdmin(u.id, u.isAdmin)} title={u.isAdmin ? "Remove admin" : "Make admin"}
                              className={`p-1.5 rounded-lg transition-colors ${u.isAdmin ? "text-primary bg-primary/10 hover:bg-primary/20" : "text-muted-foreground hover:bg-muted"}`}>
                              {u.isAdmin ? <Shield className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => deleteUser(u.id, u.name)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CONVERSATIONS */}
          {section === "conversations" && (
            <div className="p-3 md:p-6 space-y-3 max-w-3xl mx-auto">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold hidden md:block">Conversations</h2>
                  <p className="text-xs text-muted-foreground">{filteredConvs.length} of {convs.length}</p>
                </div>
                {selectedConvs.size > 0 && (
                  <button onClick={bulkDeleteConvs} className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-1.5 rounded-lg font-medium hover:bg-destructive/20 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" /> Delete {selectedConvs.size}
                  </button>
                )}
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search conversations…" value={convSearch} onChange={e => setConvSearch(e.target.value)} className="pl-9 h-9" />
                {convSearch && <button onClick={() => setConvSearch("")} className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
              </div>

              <div className="flex items-center gap-1.5 px-1">
                <button onClick={toggleSelectAllConvs} className="text-xs text-muted-foreground flex items-center gap-1.5">
                  {selectedConvs.size === filteredConvs.length && filteredConvs.length > 0
                    ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                    : <Square className="h-3.5 w-3.5" />}
                  Select all
                </button>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {filteredConvs.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No conversations found</div>
                ) : filteredConvs.map(c => (
                  <div key={c.id} className={`rounded-2xl border bg-card p-3 flex items-center gap-3 transition-all ${selectedConvs.has(c.id) ? "border-primary/40 bg-primary/5" : ""}`}>
                    <button onClick={() => toggleSelectConv(c.id)} className="shrink-0">
                      {selectedConvs.has(c.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground/40" />}
                    </button>
                    <div className="h-8 w-8 rounded-xl bg-muted flex items-center justify-center shrink-0">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{c.title}</div>
                      <div className="text-[10px] text-muted-foreground">{timeAgo(c.createdAt)} · {c.messageCount} msgs</div>
                    </div>
                    <button onClick={() => deleteConv(c.id)} className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block rounded-2xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <th className="px-4 py-3 w-8">
                        <button onClick={toggleSelectAllConvs}>
                          {selectedConvs.size === filteredConvs.length && filteredConvs.length > 0
                            ? <CheckSquare className="h-4 w-4 text-primary" />
                            : <Square className="h-4 w-4 text-muted-foreground/50" />}
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Title</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Created</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Messages</th>
                      <th className="px-4 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredConvs.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">No conversations found</td></tr>
                    ) : filteredConvs.map(c => (
                      <tr key={c.id} className={`border-b last:border-0 transition-colors ${selectedConvs.has(c.id) ? "bg-primary/5" : "hover:bg-muted/20"}`}>
                        <td className="px-4 py-3">
                          <button onClick={() => toggleSelectConv(c.id)}>
                            {selectedConvs.has(c.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground/40" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium max-w-[280px] truncate">{c.title}</td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</div>
                          <div className="text-[10px] text-muted-foreground/60">{timeAgo(c.createdAt)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-muted px-2 py-0.5 rounded-full font-medium tabular-nums">{c.messageCount}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => deleteConv(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ACTIVITY */}
          {section === "activity" && (
            <div className="p-3 md:p-6 space-y-3 max-w-2xl mx-auto">
              <div className="hidden md:block">
                <h2 className="text-base font-semibold">Activity Feed</h2>
                <p className="text-xs text-muted-foreground">Recent platform events</p>
              </div>

              {activity.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">No activity yet</div>
              ) : (
                <div className="space-y-2">
                  {activity.map((event, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-2xl border bg-card px-4 py-3">
                      <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${event.type === "signup" ? "bg-blue-500/10" : "bg-green-500/10"}`}>
                        {event.type === "signup"
                          ? <User className="h-4 w-4 text-blue-500" />
                          : <MessageSquare className="h-4 w-4 text-green-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{event.label}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{event.sub}</span>
                          {event.plan && <PlanBadge plan={event.plan} />}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground/60 shrink-0 flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3" />
                        {timeAgo(event.time)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
