import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Users, MessageSquare, Key, BarChart3, Trash2, Shield, ShieldOff,
  Search, ArrowLeft, Loader2, RefreshCw, Star, Zap, Building2,
  ChevronDown, ChevronRight,
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
  planBreakdown: { plan: string; count: number }[];
}

const PLAN_ICON: Record<string, React.ElementType> = { starter: Star, pro: Zap, business: Building2 };
const PLAN_COLOR: Record<string, string> = {
  starter: "text-muted-foreground bg-muted",
  pro: "text-primary bg-primary/10",
  business: "text-amber-500 bg-amber-500/10",
};

function authHeaders() {
  const t = localStorage.getItem("auth_token");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

type Section = "overview" | "users" | "conversations";

export default function AdminPanel() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [section, setSection] = useState<Section>("overview");
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [convs, setConvs] = useState<AdminConv[]>([]);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem("auth_token");
    if (!token) { setLoading(false); return; }
    const res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      if (data.user?.isAdmin) { setAuthorized(true); }
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

  useEffect(() => { checkAuth(); }, [checkAuth]);

  useEffect(() => {
    if (!authorized) return;
    loadStats();
    loadUsers();
    loadConvs();
  }, [authorized]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadStats(), loadUsers(), loadConvs()]);
    setRefreshing(false);
    toast({ title: "Refreshed", duration: 1500 });
  };

  const changePlan = async (userId: number, plan: string) => {
    const res = await fetch(`/api/admin/users/${userId}/plan`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ plan }) });
    if (res.ok) {
      setUsers(u => u.map(x => x.id === userId ? { ...x, plan } : x));
      toast({ title: `Plan updated to ${plan}`, duration: 2000 });
    }
  };

  const toggleAdmin = async (userId: number, current: boolean) => {
    const res = await fetch(`/api/admin/users/${userId}/admin`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ isAdmin: !current }) });
    if (res.ok) {
      setUsers(u => u.map(x => x.id === userId ? { ...x, isAdmin: !current } : x));
      toast({ title: !current ? "Admin granted" : "Admin removed", duration: 2000 });
    }
  };

  const deleteUser = async (userId: number, name: string) => {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE", headers: authHeaders() });
    if (res.ok) { setUsers(u => u.filter(x => x.id !== userId)); toast({ title: "User deleted", duration: 2000 }); }
  };

  const deleteConv = async (convId: number) => {
    if (!confirm("Delete this conversation and all its messages?")) return;
    const res = await fetch(`/api/admin/conversations/${convId}`, { method: "DELETE", headers: authHeaders() });
    if (res.ok) { setConvs(c => c.filter(x => x.id !== convId)); toast({ title: "Conversation deleted", duration: 2000 }); }
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
    const matchesSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchesPlan = planFilter === "all" || u.plan === planFilter;
    return matchesSearch && matchesPlan;
  });

  const SECTIONS: { id: Section; label: string; icon: React.ElementType; count?: number }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "users", label: "Users", icon: Users, count: users.length },
    { id: "conversations", label: "Conversations", icon: MessageSquare, count: convs.length },
  ];

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-14 items-center gap-3 border-b px-4 flex-shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="font-semibold text-base">Admin Panel</h1>
        </div>
        <Button variant="ghost" size="icon" className={`ml-auto h-8 w-8 ${refreshing ? "animate-spin" : ""}`} onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar nav */}
        <div className="w-48 border-r bg-sidebar flex-shrink-0 flex flex-col py-2 gap-0.5 px-2">
          {SECTIONS.map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-left ${section === s.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{s.label}</span>
                {s.count !== undefined && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${section === s.id ? "bg-primary/20 text-primary" : "bg-muted-foreground/20 text-muted-foreground"}`}>
                    {s.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* OVERVIEW */}
          {section === "overview" && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h2 className="text-lg font-semibold mb-1">Platform Overview</h2>
                <p className="text-sm text-muted-foreground">Real-time stats for your AI chat platform</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Total Users", value: stats?.users ?? "—", icon: Users, color: "text-blue-500 bg-blue-500/10" },
                  { label: "Conversations", value: stats?.conversations ?? "—", icon: MessageSquare, color: "text-green-500 bg-green-500/10" },
                  { label: "Messages", value: stats?.messages ?? "—", icon: MessageSquare, color: "text-purple-500 bg-purple-500/10" },
                  { label: "API Keys", value: stats?.apiKeys ?? "—", icon: Key, color: "text-amber-500 bg-amber-500/10" },
                ].map(stat => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label} className="rounded-xl border bg-card p-4 space-y-3">
                      <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${stat.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold">{stat.value}</div>
                        <div className="text-xs text-muted-foreground">{stat.label}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {stats?.planBreakdown && stats.planBreakdown.length > 0 && (
                <div className="rounded-xl border bg-card p-5">
                  <h3 className="font-semibold mb-4 text-sm">Plan Distribution</h3>
                  <div className="space-y-3">
                    {["starter", "pro", "business"].map(plan => {
                      const entry = stats.planBreakdown.find(p => p.plan === plan);
                      const count = entry ? Number(entry.count) : 0;
                      const total = stats.users > 0 ? Number(stats.users) : 1;
                      const pct = Math.round((count / total) * 100);
                      const Icon = PLAN_ICON[plan] || Star;
                      return (
                        <div key={plan} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="capitalize font-medium">{plan}</span>
                            </div>
                            <span className="text-muted-foreground">{count} users ({pct}%)</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${plan === "pro" ? "bg-primary" : plan === "business" ? "bg-amber-500" : "bg-muted-foreground/40"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-xl border bg-card p-5 space-y-3">
                <h3 className="font-semibold text-sm">Recent Users</h3>
                {users.slice(0, 5).map(u => (
                  <div key={u.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary flex-shrink-0">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${PLAN_COLOR[u.plan] || PLAN_COLOR.starter}`}>{u.plan}</span>
                    {u.isAdmin && <Shield className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </div>
                ))}
                {users.length > 5 && (
                  <button onClick={() => setSection("users")} className="text-xs text-primary hover:underline flex items-center gap-1">
                    View all {users.length} users <ChevronRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* USERS */}
          {section === "users" && (
            <div className="space-y-4 max-w-4xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Users</h2>
                <span className="text-sm text-muted-foreground">{filteredUsers.length} of {users.length}</span>
              </div>

              <div className="flex gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                </div>
                <select
                  value={planFilter}
                  onChange={e => setPlanFilter(e.target.value)}
                  className="h-10 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="all">All Plans</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="business">Business</option>
                </select>
              </div>

              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Joined</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr><td colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No users found</td></tr>
                    ) : filteredUsers.map(u => (
                      <tr key={u.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary flex-shrink-0">
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate flex items-center gap-1.5">
                                {u.name}
                                {u.isAdmin && <Shield className="h-3 w-3 text-primary inline" />}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell text-xs">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={u.plan}
                            onChange={e => changePlan(u.id, e.target.value)}
                            className={`text-xs rounded-full px-2 py-1 font-medium border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary ${PLAN_COLOR[u.plan] || PLAN_COLOR.starter}`}
                          >
                            <option value="starter">Starter</option>
                            <option value="pro">Pro</option>
                            <option value="business">Business</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => toggleAdmin(u.id, u.isAdmin)}
                              title={u.isAdmin ? "Remove admin" : "Make admin"}
                              className={`p-1.5 rounded-md transition-colors ${u.isAdmin ? "text-primary bg-primary/10 hover:bg-primary/20" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                            >
                              {u.isAdmin ? <Shield className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              onClick={() => deleteUser(u.id, u.name)}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
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
            <div className="space-y-4 max-w-3xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Conversations</h2>
                <span className="text-sm text-muted-foreground">{convs.length} total</span>
              </div>
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Created</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Messages</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {convs.length === 0 ? (
                      <tr><td colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No conversations</td></tr>
                    ) : convs.map(c => (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium truncate max-w-[200px]">{c.title}</div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-muted px-2 py-0.5 rounded-full font-medium">{c.messageCount}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => deleteConv(c.id)} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
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
        </div>
      </div>
    </div>
  );
}
