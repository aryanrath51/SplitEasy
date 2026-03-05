import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/react-app/components/ui/button";
import { Card } from "@/react-app/components/ui/card";
import { Input } from "@/react-app/components/ui/input";
import { Label } from "@/react-app/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/react-app/components/ui/select";
import { 
  Users, Receipt, ArrowRightLeft, Plus, Trash2, IndianRupee, History, 
  ChevronRight, Pencil, X, Loader2, LogOut, Share2, 
  Lock, Sun, Moon, Search, CheckCircle2, RotateCcw, FolderPlus 
} from "lucide-react";
import { AccessRequests } from "@/react-app/components/AccessRequests";

// --- INTERFACES ---
interface Member { id: number; name: string; }
interface Expense {
  id: number; description: string; amount: number; paid_by_member_id: number;
  splitAmong: number[]; splitAmounts: { [key: number]: number };
  split_type: 'equal' | 'custom'; expense_date: string;
}
interface Settlement { from: number; to: number; amount: number; }
interface Payment { id: number; from_member_id: number; to_member_id: number; amount: number; payment_date: string; }
interface GroupSummary { id: number; name: string; member_count: number; expense_count: number; created_at: string; }
interface GroupDetail {
  id: number; name: string; members: Member[]; expenses: Expense[]; payments: Payment[];
  created_at: string; isOwner: boolean; canEdit: boolean; hasPendingRequest: boolean;
}

// --- FIX: Global Wrapper outside component to fix focus jitter while typing ---
const MainWrapper = ({ children, isDarkMode }: { children: React.ReactNode, isDarkMode: boolean }) => (
  <div className={isDarkMode ? "dark" : ""}>
    <div className="min-h-screen transition-all duration-500 bg-gradient-to-br from-slate-50 via-white to-blue-100 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950 text-slate-900 dark:text-slate-100 font-sans">
      {children}
    </div>
  </div>
);

export default function HomePage() {
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [isPending, setIsPending] = useState(true);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "" });
  const [authError, setAuthError] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupDetail | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [partialPayments, setPartialPayments] = useState<{ [key: string]: string }>({});
  const [activeTab, setActiveTab] = useState<"expenses" | "settlements" | "history">("expenses");

  const [newExpense, setNewExpense] = useState({
    description: "", amount: "", paidBy: "", splitAmong: [] as number[],
    splitType: "equal" as "equal" | "custom", splitAmounts: {} as { [key: number]: string },
  });

  useEffect(() => {
    fetch("/api/users/me").then(res => res.ok ? res.json() : Promise.reject()).then(data => { setUser(data); setIsPending(false); }).catch(() => setIsPending(false));
  }, []);

  useEffect(() => {
    if (user) {
      fetchGroups();
      const gid = new URLSearchParams(window.location.search).get("groupId");
      if (gid) setSelectedGroupId(parseInt(gid));
    }
  }, [user]);

  useEffect(() => { if (selectedGroupId) { setSelectedGroup(null); fetchGroupDetail(selectedGroupId); } }, [selectedGroupId]);

  useEffect(() => {
    if (selectedGroup) { setNewExpense(prev => ({ ...prev, splitAmong: selectedGroup.members.map(m => m.id) })); }
  }, [selectedGroup]);

  // --- CORE UTILITIES ---
  const getMemberName = useCallback((id: number): string => {
    return selectedGroup?.members.find(m => m.id === id)?.name || "User";
  }, [selectedGroup]);

  const formatINR = (amt: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthError("");
    const endpoint = isLoginMode ? "/api/auth/login" : "/api/auth/signup";
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(authForm) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(data.user);
    } catch (err: any) { setAuthError("Authentication failed"); }
  };

  const toggleSplitMember = (memberId: number) => {
    setNewExpense(prev => ({
      ...prev,
      splitAmong: prev.splitAmong.includes(memberId) ? prev.splitAmong.filter(id => id !== memberId) : [...prev.splitAmong, memberId]
    }));
  };

  const settlements = useMemo(() => {
    if (!selectedGroup) return [];
    const balances: { [key: number]: number } = {};
    selectedGroup.members.forEach(m => balances[m.id] = 0);
    selectedGroup.expenses.forEach(e => {
      balances[e.paid_by_member_id] += e.amount;
      e.splitAmong.forEach(mId => {
        balances[mId] -= e.split_type === 'custom' ? (e.splitAmounts?.[mId] || 0) : (e.amount / (e.splitAmong.length || 1));
      });
    });
    selectedGroup.payments.forEach(p => { balances[p.from_member_id] += p.amount; balances[p.to_member_id] -= p.amount; });
    const debtors = Object.entries(balances).filter(b => b[1] < 0).map(b => ({ id: parseInt(b[0]), amount: -b[1] }));
    const creditors = Object.entries(balances).filter(b => b[1] > 0).map(b => ({ id: parseInt(b[0]), amount: b[1] }));
    const res: Settlement[] = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amt = Math.min(debtors[i].amount, creditors[j].amount);
      if (amt > 0.01) res.push({ from: debtors[i].id, to: creditors[j].id, amount: Math.round(amt * 100) / 100 });
      debtors[i].amount -= amt; creditors[j].amount -= amt;
      if (debtors[i].amount < 0.01) i++; if (creditors[j].amount < 0.01) j++;
    }
    return res;
  }, [selectedGroup]);

  const totalExpenses = useMemo(() => selectedGroup?.expenses.reduce((s, e) => s + e.amount, 0) || 0, [selectedGroup]);

  const filteredExpenses = useMemo(() => {
    if (!selectedGroup) return [];
    return selectedGroup.expenses.filter((e) => 
      e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getMemberName(e.paid_by_member_id).toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [selectedGroup, searchTerm, getMemberName]);

  // --- API ACTIONS ---
  const fetchGroups = async () => { const res = await fetch("/api/groups"); const data = await res.json(); setGroups(data); };
  const fetchGroupDetail = async (id: number) => {
    const res = await fetch(`/api/groups/${id}/shared`);
    if (res.ok) setSelectedGroup(await res.json());
  };

  const updateGroupName = async () => {
    if (!editedName.trim() || !selectedGroup) return;
    await fetch(`/api/groups/${selectedGroup.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editedName.trim() }) });
    setEditingGroupName(false); fetchGroupDetail(selectedGroup.id); fetchGroups();
  };

  // --- NEW: DELETE GROUP ACTION ---
  const deleteGroup = async (id: number, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This will remove all records forever.`)) return;
    const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
    if (res.ok) fetchGroups();
  };

  const addExpense = async () => {
    if (!selectedGroup || !newExpense.description || !newExpense.amount || !newExpense.paidBy) return;
    const splitAmountsData: { [key: number]: number } = {};
    if (newExpense.splitType === 'custom') {
      newExpense.splitAmong.forEach(id => { splitAmountsData[id] = parseFloat(newExpense.splitAmounts[id]) || 0; });
    }
    const res = await fetch(`/api/groups/${selectedGroup.id}/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newExpense, paidByMemberId: parseInt(newExpense.paidBy), amount: parseFloat(newExpense.amount), splitAmounts: splitAmountsData, date: new Date().toISOString().split("T")[0] }),
    });
    if (res.ok) {
        setNewExpense({ description: "", amount: "", paidBy: "", splitAmong: selectedGroup.members.map(m => m.id), splitType: "equal", splitAmounts: {} });
        fetchGroupDetail(selectedGroup.id);
    }
  };

  const markAsPaid = async (settlement: Settlement) => {
    if (!selectedGroup) return;
    const key = `${settlement.from}-${settlement.to}`;
    const amt = partialPayments[key] ? parseFloat(partialPayments[key]) : settlement.amount;
    await fetch(`/api/groups/${selectedGroup.id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromMemberId: settlement.from, toMemberId: settlement.to, amount: amt, date: new Date().toISOString().split("T")[0] }),
    });
    setPartialPayments(prev => { const n = { ...prev }; delete n[key]; return n; });
    fetchGroupDetail(selectedGroup.id);
  };

  if (isPending) return <MainWrapper isDarkMode={isDarkMode}><div className="flex items-center justify-center h-screen"><Loader2 className="w-16 h-16 text-blue-600 animate-spin" /></div></MainWrapper>;

  if (!user) return (
    <MainWrapper isDarkMode={isDarkMode}>
      <div className="flex items-center justify-center min-h-screen p-6">
        <Card className="p-10 bg-white/90 dark:bg-slate-900/90 border-slate-200 dark:border-slate-800 max-w-lg w-full text-center shadow-2xl rounded-3xl backdrop-blur-md">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mx-auto mb-8 shadow-lg"><IndianRupee className="w-10 h-10 text-white" /></div>
          <h1 className="text-4xl font-extrabold mb-3">SplitEasy</h1>
          <form onSubmit={handleAuth} className="space-y-6 text-left">
            {!isLoginMode && <div className="space-y-2"><Label>Full Name</Label><Input required value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} className="h-12 rounded-xl dark:bg-slate-800" /></div>}
            <div className="space-y-2"><Label>Email</Label><Input required type="email" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} className="h-12 rounded-xl dark:bg-slate-800" /></div>
            <div className="space-y-2"><Label>Password</Label><Input required type="password" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} className="h-12 rounded-xl dark:bg-slate-800" /></div>
            <Button className="w-full h-12 text-lg font-bold bg-blue-600 hover:bg-blue-700 rounded-xl transition-all">Continue</Button>
          </form>
          <button onClick={() => setIsLoginMode(!isLoginMode)} className="mt-8 text-blue-600 dark:text-blue-400 font-semibold">{isLoginMode ? "Need an account? Sign up" : "Back to Login"}</button>
          <div className="mt-8 flex justify-center"><button onClick={() => setIsDarkMode(!isDarkMode)} className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800">{isDarkMode ? <Sun className="text-yellow-500 w-6 h-6" /> : <Moon className="text-slate-500 w-6 h-6" />}</button></div>
        </Card>
      </div>
    </MainWrapper>
  );

  if (!selectedGroupId) return (
    <MainWrapper isDarkMode={isDarkMode}>
      <header className="bg-white/80 dark:bg-slate-900/80 border-b dark:border-slate-800 sticky top-0 py-5 z-10 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-3"><IndianRupee className="text-blue-600 w-8 h-8" /><h1 className="text-2xl font-black text-slate-800 dark:text-white">SplitEasy</h1></div>
          <div className="flex items-center gap-4">
            <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800">{isDarkMode ? <Sun className="w-5 h-5 text-yellow-500" /> : <Moon className="w-5 h-5 text-slate-400" />}</button>
            <Button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => setUser(null))} variant="outline" className="rounded-xl border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white"><LogOut className="w-4 h-4 mr-2" />Logout</Button>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-16">
        <AccessRequests />
        <Card className="p-8 bg-white/90 dark:bg-slate-900/90 border-slate-200 dark:border-slate-800 mb-12 shadow-xl rounded-3xl">
             <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-800 dark:text-white"><FolderPlus className="text-blue-600" /> Start a Group</h3>
             <div className="flex gap-3">
               <Input placeholder="e.g. Goa Trip" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} className="h-12 rounded-xl dark:bg-slate-800 dark:border-slate-700" />
               <Button onClick={async () => { await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newGroupName }) }); setNewGroupName(""); fetchGroups(); }} className="h-12 px-8 bg-blue-600 rounded-xl font-bold hover:bg-blue-700 transition-all"><Plus className="mr-2 h-5 w-5" />Create</Button>
             </div>
        </Card>
        <div className="grid md:grid-cols-2 gap-6">
          {groups.map(g => (
            <Card key={g.id} className="p-6 bg-white/90 dark:bg-slate-900/90 border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-400 cursor-pointer rounded-3xl group shadow-md" onClick={() => setSelectedGroupId(g.id)}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-black text-xl text-slate-800 dark:text-white">{g.name}</h3>
                {/* DELETE GROUP BUTTON ADDED HERE */}
                <button onClick={(e) => { e.stopPropagation(); deleteGroup(g.id, g.name); }} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="w-5 h-5" /></button>
              </div>
              <div className="flex justify-between items-center">
                 <p className="text-sm font-bold text-slate-500"><Users className="inline w-4 h-4 mr-1 text-blue-500" />{g.member_count} Members</p>
                 <ChevronRight className="w-5 h-5 text-slate-300 group-hover:translate-x-1 transition-all" />
              </div>
            </Card>
          ))}
        </div>
      </main>
    </MainWrapper>
  );

  return (
    <MainWrapper isDarkMode={isDarkMode}>
      <header className="bg-white/80 dark:bg-slate-900/80 border-b dark:border-slate-800 sticky top-0 py-4 z-10 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => setSelectedGroupId(null)}>
            <IndianRupee className="text-blue-600 w-7 h-7" /><span className="font-black text-xl text-slate-800 dark:text-white">SplitEasy</span><ChevronRight className="w-5 h-5 text-slate-300" />
            {editingGroupName ? (
              <div className="flex items-center gap-2">
                <Input value={editedName} onChange={(e) => setEditedName(e.target.value)} onKeyPress={(e) => e.key === "Enter" && updateGroupName()} className="h-10 w-48 font-bold dark:bg-slate-800 dark:border-slate-700" autoFocus />
                <Button size="sm" onClick={updateGroupName} className="h-10 bg-blue-600">Save</Button>
                <button onClick={() => setEditingGroupName(false)}><X className="w-5 h-5" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <span className="text-xl font-black text-blue-600">{selectedGroup?.name}</span>
                {selectedGroup?.isOwner && <button onClick={() => { setEditedName(selectedGroup!.name); setEditingGroupName(true); }} className="text-slate-300 hover:text-blue-600 transition-colors"><Pencil className="w-4 h-4" /></button>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
             <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 transition-all">{isDarkMode ? <Sun className="w-5 h-5 text-yellow-500" /> : <Moon className="w-5 h-5 text-slate-400" />}</button>
             {selectedGroup?.canEdit && <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/?groupId=${selectedGroup!.id}`); alert("Invite link copied!"); }} className="p-2.5 text-slate-400 hover:text-blue-600 transition-colors"><Share2 className="w-5 h-5" /></button>}
             <Button onClick={() => setSelectedGroupId(null)} variant="ghost" className="text-slate-400 hover:text-red-500"><X className="w-6 h-6" /></Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid lg:grid-cols-12 gap-8">
          {/* MEMBERS SIDEBAR */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="p-8 bg-white/90 dark:bg-slate-900/90 border dark:border-slate-800 shadow-xl rounded-3xl backdrop-blur-sm">
              <h2 className="text-xl font-black mb-6 flex items-center gap-2 text-slate-800 dark:text-white"><Users className="w-6 h-6 text-blue-600" /> Members</h2>
              {selectedGroup?.canEdit && (
                <div className="flex gap-2 mb-8">
                  <Input placeholder="Enter name" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} onKeyPress={(e) => e.key === "Enter" && fetch(`/api/groups/${selectedGroup!.id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newMemberName }) }).then(() => {setNewMemberName(""); fetchGroupDetail(selectedGroup!.id);})} className="h-11 rounded-xl dark:bg-slate-800 dark:border-slate-700" />
                  <Button size="icon" className="h-11 w-11 bg-blue-600 rounded-xl shadow-md hover:bg-blue-700 shrink-0" onClick={() => fetch(`/api/groups/${selectedGroup!.id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newMemberName }) }).then(() => {setNewMemberName(""); fetchGroupDetail(selectedGroup!.id);})}><Plus className="w-5 h-5" /></Button>
                </div>
              )}
              <div className="space-y-3">
                {selectedGroup?.members.map(m => (
                  <div key={m.id} className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-2xl flex justify-between group items-center transition-colors hover:border-blue-200">
                    <span className="font-bold text-slate-700 dark:text-slate-200">{m.name}</span>
                    {selectedGroup.canEdit && <button onClick={async () => { if(confirm(`Remove ${m.name}?`)) { await fetch(`/api/members/${m.id}`, { method: "DELETE" }); fetchGroupDetail(selectedGroup!.id); } }} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="lg:col-span-8 space-y-8">
            <div className="grid grid-cols-3 gap-6">
              <Card className="p-6 bg-white/90 dark:bg-slate-900/90 text-center shadow-lg rounded-3xl border border-slate-100 dark:border-slate-800"><p className="text-xs text-slate-400 font-black mb-1 uppercase tracking-widest">Spent</p><p className="text-2xl font-black text-slate-800 dark:text-white">{formatINR(totalExpenses)}</p></Card>
              <Card className="p-6 bg-white/90 dark:bg-slate-900/90 text-center shadow-lg rounded-3xl border border-slate-100 dark:border-slate-800"><p className="text-xs text-slate-400 font-black mb-1 uppercase tracking-widest">Debts</p><p className="text-2xl font-black text-orange-500">{settlements.length}</p></Card>
              <Card className="p-6 bg-white/90 dark:bg-slate-900/90 text-center shadow-lg rounded-3xl border border-slate-100 dark:border-slate-800"><p className="text-xs text-slate-400 font-black mb-1 uppercase tracking-widest">People</p><p className="text-2xl font-black text-blue-600">{selectedGroup?.members.length}</p></Card>
            </div>

            {selectedGroup?.canEdit && (
              <Card className="p-8 bg-white/90 dark:bg-slate-900/90 border border-slate-100 dark:border-slate-800 shadow-xl rounded-3xl border-t-4 border-t-blue-600">
                <h2 className="text-xl font-black mb-8 flex items-center gap-2 text-slate-800 dark:text-white"><Receipt className="w-6 h-6 text-blue-600" /> New Expense</h2>
                <div className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <Input placeholder="Lunch, Fuel..." value={newExpense.description} onChange={e => setNewExpense({...newExpense, description: e.target.value})} className="h-12 rounded-xl dark:bg-slate-800 dark:border-slate-700" />
                    <Input type="number" placeholder="₹ Total bill" value={newExpense.amount} onChange={e => setNewExpense({...newExpense, amount: e.target.value})} className="h-12 rounded-xl dark:bg-slate-800 dark:border-slate-700" />
                  </div>
                  <Select value={newExpense.paidBy} onValueChange={v => setNewExpense({...newExpense, paidBy: v})}>
                    <SelectTrigger className="h-12 rounded-xl dark:bg-slate-800 border-slate-200 dark:border-slate-700"><SelectValue placeholder="Who paid?" /></SelectTrigger>
                    <SelectContent className="rounded-xl">{selectedGroup.members.map(m => (<SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>))}</SelectContent>
                  </Select>

                  <div className="flex gap-4">
                    <Button onClick={() => setNewExpense({...newExpense, splitType: 'equal'})} variant={newExpense.splitType === 'equal' ? 'default' : 'outline'} className="flex-1 rounded-xl font-bold h-11 transition-all">Equal Split</Button>
                    <Button onClick={() => setNewExpense({...newExpense, splitType: 'custom'})} variant={newExpense.splitType === 'custom' ? 'default' : 'outline'} className="flex-1 rounded-xl font-bold h-11 transition-all">Custom Split (₹)</Button>
                  </div>

                  <div className="space-y-4">
                    <Label className="text-xs font-black uppercase opacity-50 ml-1">Shared with:</Label>
                    <div className="grid md:grid-cols-2 gap-3">
                      {selectedGroup.members.map(m => {
                        const isIncluded = newExpense.splitAmong.includes(m.id);
                        return (
                          <div key={m.id} className={`p-4 border rounded-2xl transition-all ${isIncluded ? 'border-blue-400 bg-blue-50/10 dark:bg-blue-900/10' : 'border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50'} flex flex-col gap-2`}>
                            <button type="button" onClick={() => toggleSplitMember(m.id)} className="flex items-center gap-2 font-black text-sm text-left">
                              {isIncluded ? <CheckCircle2 className="text-blue-600 w-5 h-5" /> : <div className="w-5 h-5 border-2 rounded-full border-slate-200" />}
                              {m.name}
                            </button>
                            {newExpense.splitType === 'custom' && isIncluded && (
                              <Input 
                                  type="number" placeholder="₹ Enter share" className="h-10 rounded-lg text-xs dark:bg-slate-900 shadow-inner" 
                                  value={newExpense.splitAmounts[m.id] || ""} 
                                  onChange={e => setNewExpense({...newExpense, splitAmounts: {...newExpense.splitAmounts, [m.id]: e.target.value}})} 
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <Button onClick={addExpense} className="bg-blue-600 w-full h-14 text-lg font-black rounded-2xl shadow-xl hover:bg-blue-700 transition-all active:scale-[0.98]">Record Expense</Button>
                </div>
              </Card>
            )}

            <div className="flex gap-8 border-b-2 dark:border-slate-800">
              <button onClick={() => setActiveTab("expenses")} className={`pb-4 text-sm font-black transition-all relative ${activeTab === "expenses" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-400"}`}>EXPENSES</button>
              <button onClick={() => setActiveTab("settlements")} className={`pb-4 text-sm font-black transition-all relative ${activeTab === "settlements" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-400"}`}>SETTLEMENTS</button>
              <button onClick={() => setActiveTab("history")} className={`pb-4 text-sm font-black transition-all relative ${activeTab === "history" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-400"}`}>HISTORY</button>
            </div>

            {activeTab === "expenses" && (
              <div className="space-y-4">
                <div className="relative"><Search className="absolute left-4 top-4 text-slate-400 w-6 h-6" /><Input placeholder="Search records..." className="pl-12 h-14 rounded-2xl mb-6 dark:bg-slate-900 border-none shadow-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
                {filteredExpenses.map(e => (
                  <Card key={e.id} className="p-6 bg-white/90 dark:bg-slate-900/90 border border-slate-100 dark:border-slate-800 rounded-3xl shadow-md flex justify-between items-center group transition-all hover:translate-x-1">
                    <div className="flex items-center gap-4"><div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold shadow-inner">₹</div><div><h3 className="font-black text-lg leading-tight text-slate-800 dark:text-white">{e.description}</h3><p className="text-xs font-bold text-slate-400">Paid by <span className="text-blue-500">{getMemberName(e.paid_by_member_id)}</span></p></div></div>
                    <div className="flex items-center gap-6 text-right"><div><p className="font-black text-2xl text-slate-800 dark:text-white">{formatINR(e.amount)}</p><p className="text-xs text-slate-400 font-bold uppercase">{e.split_type === 'custom' ? 'Custom bill' : `Split by ${e.splitAmong.length}`}</p></div>{selectedGroup?.canEdit && <button onClick={async () => { if(confirm("Undo this record?")) { await fetch(`/api/expenses/${e.id}`, { method: "DELETE" }); fetchGroupDetail(selectedGroup!.id); } }} className="text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-2 bg-slate-50 dark:bg-slate-800 rounded-lg"><Trash2 className="w-5 h-5" /></button>}</div>
                  </Card>
                ))}
              </div>
            )}

            {activeTab === "settlements" && (
              <div className="space-y-4">
                {settlements.map((s, idx) => {
                  const key = `${s.from}-${s.to}`;
                  return (
                    <Card key={idx} className="p-6 bg-white/95 dark:bg-slate-900/95 border border-slate-100 dark:border-slate-800 shadow-lg rounded-3xl flex justify-between items-center transition-all hover:border-blue-400">
                      <div className="flex items-center gap-4"><div className="w-12 h-12 rounded-2xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 font-black shadow-inner">{getMemberName(s.from).charAt(0)}</div><ArrowRightLeft className="text-slate-300 w-5 h-5 mx-1" /><div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-black shadow-inner">{getMemberName(s.to).charAt(0)}</div><span className="font-black text-slate-700 dark:text-slate-200">{getMemberName(s.from)} owes {getMemberName(s.to)}</span></div>
                      <div className="flex items-center gap-4"><span className="font-black text-2xl text-orange-600">{formatINR(s.amount)}</span>{selectedGroup?.canEdit && <div className="flex gap-2"><Input type="number" placeholder="Amt" className="w-24 h-10 rounded-xl dark:bg-slate-800" value={partialPayments[key] || ""} onChange={e => setPartialPayments({...partialPayments, [key]: e.target.value})} /><Button size="sm" onClick={() => markAsPaid(s)} className="bg-orange-600 rounded-xl h-10 px-4 font-black shadow-md hover:bg-orange-700 transition-colors">Pay</Button></div>}</div>
                    </Card>
                  );
                })}
                {settlements.length === 0 && <Card className="p-20 text-center text-blue-600 font-black border-2 border-dashed border-blue-200 dark:border-blue-900 rounded-3xl text-xl bg-blue-50/10 backdrop-blur-sm">ALL DEBTS SETTLED! 🎉</Card>}
              </div>
            )}

            {activeTab === "history" && selectedGroup && (
               <div className="space-y-4">
                 {selectedGroup.payments.map(p => (
                   <Card key={p.id} className="p-6 bg-white/90 dark:bg-slate-900/90 border dark:border-slate-800 flex justify-between items-center rounded-3xl shadow-sm group">
                     <div className="flex items-center gap-5"><div className="w-12 h-12 rounded-2xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center text-green-600 shadow-inner"><History className="w-6 h-6" /></div><div><p className="font-black text-slate-800 dark:text-white leading-tight">{getMemberName(p.from_member_id)} paid {getMemberName(p.to_member_id)}</p><p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">{p.payment_date}</p></div></div>
                     <div className="flex items-center gap-4">
                        <p className="font-black text-2xl text-green-600">{formatINR(p.amount)}</p>
                        {selectedGroup.canEdit && (
                            <button onClick={async () => { if(confirm("Undo this payment record?")) { await fetch(`/api/payments/${p.id}`, { method: "DELETE" }); fetchGroupDetail(selectedGroup!.id); } }} className="p-2 text-slate-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-all bg-slate-50 dark:bg-slate-800 rounded-lg shadow-sm" title="Undo Payment (Redo)"><RotateCcw className="w-5 h-5" /></button>
                        )}
                     </div>
                   </Card>
                 ))}
               </div>
            )}
          </div>
        </div>
      </main>
    </MainWrapper>
  );
}