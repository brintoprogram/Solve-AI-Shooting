import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  UserCog, UserPlus, Check, Loader2, X, Mail, User,
  Send, LayoutGrid, Users, Upload, MessageSquare, Settings, Shield,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import {
  useAuth, ROLE_LABELS, ROLE_STYLE, initials,
  DEFAULT_PERMISSIONS, hasPermission,
} from "@/context/AuthContext";
import type { UserProfile, PermissionKey } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type RoleOption = UserProfile["role"];

const AVATAR_COLORS = [
  "linear-gradient(135deg,#3fb06c,#16A34A)",
  "linear-gradient(135deg,#60a5fa,#3b82f6)",
  "linear-gradient(135deg,#a78bfa,#7c3aed)",
  "linear-gradient(135deg,#f59e0b,#d97706)",
  "linear-gradient(135deg,#f87171,#ef4444)",
];

// ── Feature definitions ─────────────────────────────────────────

interface FeatureDef {
  key:   PermissionKey;
  label: string;
  desc:  string;
  icon:  LucideIcon;
}

const FEATURE_DEFS: FeatureDef[] = [
  { key: "can_shoot",            label: "Iniciar Disparos",    desc: "Iniciar e retomar campanhas de disparo em massa",     icon: Send         },
  { key: "can_manage_campaigns", label: "Gerenciar Campanhas", desc: "Criar, pausar e cancelar campanhas",                  icon: LayoutGrid   },
  { key: "can_manage_contacts",  label: "Gerenciar Contatos",  desc: "Criar, editar e excluir contatos e boletos",          icon: Users        },
  { key: "can_import",           label: "Importar Planilhas",  desc: "Importar contatos em massa via CSV/Excel",            icon: Upload       },
  { key: "can_inbox",            label: "Acessar Inbox",       desc: "Ver e responder conversas no Inbox",                  icon: MessageSquare },
  { key: "can_manage_team",      label: "Gerenciar Equipe",    desc: "Convidar membros e alterar cargos",                   icon: UserCog      },
  { key: "can_settings",         label: "Configurações",       desc: "Acessar e editar configurações do sistema",           icon: Settings     },
];

// ── Toggle switch ────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: checked ? "#3fb06c" : "#2a3d30", border: `1px solid ${checked ? "#3fb06c" : "#3a4d3e"}` }}
    >
      <span
        className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(17px)" : "translateX(2px)" }}
      />
    </button>
  );
}

// ── Permissions Modal ───────────────────────────────────────────

interface PermissionsModalProps {
  member:  UserProfile;
  onClose: () => void;
  onSaved: (updated: UserProfile) => void;
}

function PermissionsModal({ member, onClose, onSaved }: PermissionsModalProps) {
  const { toast } = useToast();
  const [perms,   setPerms]   = useState<Partial<Record<PermissionKey, boolean>>>(member.permissions ?? {});
  const [saving,  setSaving]  = useState(false);
  const isAdmin = member.role === "admin";

  function effectiveValue(key: PermissionKey): boolean {
    if (isAdmin) return true;
    return perms[key] ?? DEFAULT_PERMISSIONS[member.role][key] ?? false;
  }

  function isOverridden(key: PermissionKey): boolean {
    if (isAdmin) return false;
    return perms[key] !== undefined && perms[key] !== DEFAULT_PERMISSIONS[member.role][key];
  }

  function handleToggle(key: PermissionKey, val: boolean) {
    const def = DEFAULT_PERMISSIONS[member.role][key] ?? false;
    setPerms((prev) => {
      const next = { ...prev };
      if (val === def) {
        delete next[key]; // back to default — no override stored
      } else {
        next[key] = val;
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await db
      .from("user_profiles")
      .update({ permissions: perms })
      .eq("id", member.id);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Permissões salvas", variant: "success" });
    onSaved({ ...member, permissions: perms });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(5px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl flex flex-col overflow-hidden"
        style={{
          background: "#0d1a11",
          border: "1px solid rgba(63,176,108,0.2)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.65)",
          maxHeight: "90vh",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.2)" }}>
              <Shield className="w-4 h-4 text-agro-green" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-agro-text">Permissões — {member.full_name ?? "Usuário"}</h2>
              <p className="text-[11px] text-agro-muted-2">Cargo atual: <span style={{ color: ROLE_STYLE[member.role].color }}>{ROLE_LABELS[member.role]}</span></p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {isAdmin ? (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-[#60a5fa]" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}>
              <Shield className="w-4 h-4 shrink-0" />
              Administradores têm acesso total a todas as funcionalidades e não podem ser restritos.
            </div>
          ) : (
            <p className="text-[11px] text-agro-muted-2 pb-1">
              Permissões marcadas com <span className="text-yellow-400">⚠</span> estão divergindo do padrão do cargo.
            </p>
          )}

          {FEATURE_DEFS.map((feat) => {
            const Icon      = feat.icon;
            const current   = effectiveValue(feat.key);
            const overridden = isOverridden(feat.key);

            return (
              <div
                key={feat.key}
                className="flex items-center gap-4 px-4 py-3 rounded-xl transition-colors"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(63,176,108,0.06)" }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: current ? "rgba(63,176,108,0.1)" : "rgba(255,255,255,0.03)" }}>
                  <Icon className="w-4 h-4" style={{ color: current ? "#3fb06c" : "#4a5a4e" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-agro-text">{feat.label}</p>
                    {overridden && <span className="text-[10px] text-yellow-400">⚠ customizado</span>}
                  </div>
                  <p className="text-[11px] text-agro-muted-2 truncate">{feat.desc}</p>
                </div>
                <Toggle checked={current} onChange={(v) => handleToggle(feat.key, v)} disabled={isAdmin} />
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderTop: "1px solid rgba(63,176,108,0.1)", background: "rgba(10,17,14,0.5)" }}>
          {!isAdmin && (
            <button
              onClick={() => setPerms({})}
              className="text-xs text-agro-muted-2 hover:text-agro-text transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
            >
              Resetar para padrão do cargo
            </button>
          )}
          {isAdmin && <div />}
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-agro-muted hover:text-agro-text transition-colors rounded-xl hover:bg-white/5">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || isAdmin}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white btn-agro disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Invite Modal ────────────────────────────────────────────────

interface InviteModalProps {
  onClose:   () => void;
  onSuccess: () => void;
}

function InviteModal({ onClose, onSuccess }: InviteModalProps) {
  const [email,    setEmail]    = useState("");
  const [fullName, setFullName] = useState("");
  const [role,     setRole]     = useState<RoleOption>("agent");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
        {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${session?.access_token ?? ""}`,
            "apikey":        import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email: email.trim(), full_name: fullName.trim(), role }),
        },
      );

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Erro ao enviar convite.");
      } else {
        toast({ title: "Convite enviado!", description: `${email} receberá um e-mail de acesso.`, variant: "success" });
        onSuccess();
        onClose();
      }
    } catch (err) {
      setError("Erro de conexão. Tente novamente.");
      console.error("[invite] error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 relative"
        style={{ background: "#0d1a11", border: "1px solid rgba(63,176,108,0.2)", boxShadow: "0 32px 80px rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.2)" }}>
              <UserPlus className="w-4 h-4 text-agro-green" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-agro-text">Convidar Membro</h2>
              <p className="text-[11px] text-agro-muted-2">Um e-mail de acesso será enviado</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-agro-muted">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
              <input type="email" required placeholder="nome@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} className="input-agro w-full pl-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-agro-muted">Nome Completo</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
              <input type="text" required placeholder="João Silva" value={fullName} onChange={(e) => setFullName(e.target.value)} className="input-agro w-full pl-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-agro-muted">Cargo</label>
            <select value={role} onChange={(e) => setRole(e.target.value as RoleOption)} className="input-agro w-full">
              <option value="agent">Agente</option>
              <option value="manager">Gerente</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-red-400" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              <X className="w-4 h-4 shrink-0" />{error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors" style={{ border: "1px solid rgba(63,176,108,0.12)" }}>
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="flex-1 btn-agro py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Enviando…</span> : "Enviar Convite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Team Page ───────────────────────────────────────────────────

interface PendingInvite {
  id: string; email: string; role: string; created_at: string; expires_at: string;
}

export function Team() {
  const { profile: myProfile, workspaceId } = useAuth();
  const { toast } = useToast();
  const [members,          setMembers]          = useState<UserProfile[]>([]);
  const [pendingInvites,   setPendingInvites]   = useState<PendingInvite[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [updating,         setUpdating]         = useState<string | null>(null);
  const [revoking,         setRevoking]         = useState<string | null>(null);
  const [showInvite,       setShowInvite]       = useState(false);
  const [permTarget,       setPermTarget]       = useState<UserProfile | null>(null);

  if (!myProfile || !["admin", "manager"].includes(myProfile.role)) {
    return <Navigate to="/" replace />;
  }

  const isAdmin = myProfile.role === "admin";

  const load = useCallback(async () => {
    if (!workspaceId) return;

    const [membersRes, invitesRes] = await Promise.all([
      db
        .from("workspace_members")
        .select("user_id, role, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      isAdmin
        ? db
            .from("workspace_invites")
            .select("id, email, role, created_at, expires_at")
            .eq("workspace_id", workspaceId)
            .is("accepted_at", null)
            .gte("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (membersRes.error) {
      console.error("[Team] load error:", membersRes.error.message);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memberRows = (membersRes.data ?? []) as any[];
      const userIds = memberRows.map((m) => m.user_id as string);

      if (userIds.length > 0) {
        const { data: profilesData } = await db
          .from("user_profiles")
          .select("*")
          .in("id", userIds);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profileMap = new Map<string, any>((profilesData ?? []).map((p: any) => [p.id, p]));
        const profiles = memberRows
          .map((row) => {
            const p = profileMap.get(row.user_id);
            return p ? { ...p, role: row.role } : null;
          })
          .filter(Boolean) as UserProfile[];
        setMembers(profiles);
      } else {
        setMembers([]);
      }
    }
    setPendingInvites((invitesRes.data as PendingInvite[]) ?? []);
    setLoading(false);
  }, [workspaceId, isAdmin]);

  useEffect(() => { load(); }, [load]);

  async function handleRevokeInvite(inviteId: string) {
    setRevoking(inviteId);
    const { error } = await db.from("workspace_invites").delete().eq("id", inviteId);
    if (error) {
      toast({ title: "Erro ao revogar convite", description: error.message, variant: "destructive" });
    } else {
      setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
      toast({ title: "Convite revogado", variant: "success" });
    }
    setRevoking(null);
  }

  async function handleRoleChange(memberId: string, newRole: RoleOption) {
    if (!isAdmin) return;
    setUpdating(memberId);
    const { error } = await db
      .from("user_profiles")
      .update({ role: newRole })
      .eq("id", memberId);

    if (error) {
      toast({ title: "Erro ao atualizar cargo", description: error.message, variant: "destructive" });
    } else {
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)));
      toast({ title: "Cargo atualizado", variant: "success" });
    }
    setUpdating(null);
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Equipe" }]} />

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* ── Header ─────────────────────────── */}
        <div className="flex items-start justify-between animate-fade-up">
          <div>
            <h1 className="font-display text-2xl font-bold text-agro-text flex items-center gap-3">
              <UserCog className="w-6 h-6 text-agro-green" />
              Equipe & Permissões
            </h1>
            <p className="text-sm text-agro-muted mt-1">
              {isAdmin ? "Gerencie membros, cargos e permissões individuais." : "Visualize os membros da sua organização."}
            </p>
          </div>

          {isAdmin && (
            <button onClick={() => setShowInvite(true)} className="btn-agro flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white">
              <UserPlus className="w-4 h-4" />
              Convidar Membro
            </button>
          )}
        </div>

        {/* ── Members table ──────────────────── */}
        <div
          className="rounded-2xl overflow-hidden animate-fade-up-delay-1"
          style={{ background: "rgba(13,26,17,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          {/* Table header */}
          <div
            className="grid items-center gap-4 px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2"
            style={{ gridTemplateColumns: "36px 1fr 110px 150px 120px", borderBottom: "1px solid rgba(63,176,108,0.08)" }}
          >
            <span />
            <span>Membro</span>
            <span>Cargo</span>
            <span>{isAdmin ? "Alterar cargo" : ""}</span>
            <span>{isAdmin ? "Permissões" : ""}</span>
          </div>

          {/* Rows */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-agro-muted-2 animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-center text-sm text-agro-muted py-16">Nenhum membro encontrado.</p>
          ) : (
            members.map((member, i) => {
              const rs       = ROLE_STYLE[member.role];
              const isMe     = member.id === myProfile.id;
              const isSaving = updating === member.id;
              const customCount = Object.keys(member.permissions ?? {}).length;

              return (
                <div
                  key={member.id}
                  className="grid items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
                  style={{
                    gridTemplateColumns: "36px 1fr 110px 150px 120px",
                    borderBottom: i < members.length - 1 ? "1px solid rgba(63,176,108,0.05)" : "none",
                  }}
                >
                  {/* Avatar */}
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                  >
                    {initials(member.full_name)}
                  </div>

                  {/* Name + meta */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-agro-text truncate">{member.full_name ?? "—"}</p>
                      {isMe && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "rgba(63,176,108,0.1)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }}>
                          Você
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-agro-muted-2 mt-0.5">
                      Desde {format(new Date(member.created_at), "dd/MM/yyyy", { locale: ptBR })}
                    </p>
                  </div>

                  {/* Role badge */}
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 w-fit"
                    style={{ background: rs.bg, color: rs.color, border: `1px solid ${rs.border}` }}
                  >
                    {ROLE_LABELS[member.role]}
                  </span>

                  {/* Role change (admin only) */}
                  {isAdmin ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={member.role}
                        disabled={isSaving}
                        onChange={(e) => handleRoleChange(member.id, e.target.value as RoleOption)}
                        className="input-agro text-xs py-1.5 pr-7 pl-2 min-w-[7rem] disabled:opacity-50"
                      >
                        <option value="admin">Admin</option>
                        <option value="manager">Gerente</option>
                        <option value="agent">Agente</option>
                      </select>
                      {isSaving
                        ? <Loader2 className="w-3.5 h-3.5 text-agro-muted-2 animate-spin" />
                        : <Check className="w-3.5 h-3.5 text-agro-muted-2 opacity-0" />
                      }
                    </div>
                  ) : <div />}

                  {/* Permissions button (admin only) */}
                  {isAdmin ? (
                    <button
                      onClick={() => setPermTarget(member)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{
                        background: customCount > 0 ? "rgba(63,176,108,0.1)" : "rgba(255,255,255,0.03)",
                        border:     customCount > 0 ? "1px solid rgba(63,176,108,0.25)" : "1px solid rgba(255,255,255,0.06)",
                        color:      customCount > 0 ? "#3fb06c" : "#6b7f6e",
                      }}
                    >
                      <Shield className="w-3.5 h-3.5" />
                      {customCount > 0 ? `${customCount} custom` : "Configurar"}
                    </button>
                  ) : <div />}
                </div>
              );
            })
          )}
        </div>

        {/* ── Pending invites ────────────────── */}
        {isAdmin && pendingInvites.length > 0 && (
          <div
            className="rounded-2xl overflow-hidden animate-fade-up-delay-1"
            style={{ background: "rgba(13,26,17,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              <Mail className="w-4 h-4 text-agro-muted-2" />
              <span className="text-xs font-semibold uppercase tracking-widest text-agro-muted-2">
                Convites pendentes ({pendingInvites.length})
              </span>
            </div>
            {pendingInvites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors"
                style={{ borderBottom: "1px solid rgba(63,176,108,0.05)" }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}>
                    <Mail className="w-3.5 h-3.5 text-agro-muted" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-agro-text">{inv.email}</p>
                    <p className="text-[11px] text-agro-muted-2">
                      Expira em {format(new Date(inv.expires_at), "dd/MM/yyyy", { locale: ptBR })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: ROLE_STYLE[inv.role as RoleOption]?.bg ?? "rgba(255,255,255,0.05)", color: ROLE_STYLE[inv.role as RoleOption]?.color ?? "#9ca3af" }}
                  >
                    {ROLE_LABELS[inv.role as RoleOption] ?? inv.role}
                  </span>
                  <button
                    onClick={() => handleRevokeInvite(inv.id)}
                    disabled={revoking === inv.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-agro-muted hover:text-red-400 transition-colors disabled:opacity-50"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    {revoking === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                    Revogar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Permission legend ───────────────── */}
        {!loading && members.length > 0 && isAdmin && (
          <div
            className="rounded-2xl p-4 animate-fade-up-delay-1"
            style={{ background: "rgba(13,26,17,0.5)", border: "1px solid rgba(63,176,108,0.08)" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2 mb-3">Permissões padrão por cargo</p>
            <div className="grid grid-cols-3 gap-3">
              {(["admin", "manager", "agent"] as RoleOption[]).map((role) => (
                <div key={role} className="space-y-1.5">
                  <p className="text-xs font-semibold" style={{ color: ROLE_STYLE[role].color }}>{ROLE_LABELS[role]}</p>
                  {FEATURE_DEFS.map((f) => (
                    <div key={f.key} className="flex items-center gap-1.5">
                      <span className="text-[10px]" style={{ color: DEFAULT_PERMISSIONS[role][f.key] ? "#3fb06c" : "#3a4d3e" }}>
                        {DEFAULT_PERMISSIONS[role][f.key] ? "✓" : "✗"}
                      </span>
                      <span className="text-[11px] text-agro-muted-2">{f.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Stats footer ───────────────────── */}
        {!loading && members.length > 0 && (
          <div className="flex gap-6 px-1 text-xs text-agro-muted-2 animate-fade-up-delay-1">
            {(["admin", "manager", "agent"] as RoleOption[]).map((r) => {
              const count = members.filter((m) => m.role === r).length;
              return count > 0 ? (
                <span key={r}>
                  <span style={{ color: ROLE_STYLE[r].color }}>{ROLE_LABELS[r]}:</span> {count}
                </span>
              ) : null;
            })}
            <span className="ml-auto">{members.length} membro{members.length !== 1 ? "s" : ""} no total</span>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────── */}
      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} onSuccess={load} />
      )}

      {permTarget && (
        <PermissionsModal
          member={permTarget}
          onClose={() => setPermTarget(null)}
          onSaved={(updated) => {
            setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
            setPermTarget(null);
          }}
        />
      )}
    </div>
  );
}
