import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { UserCog, UserPlus, Check, Loader2, X, Mail, User } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth, ROLE_LABELS, ROLE_STYLE, initials } from "@/context/AuthContext";
import type { UserProfile } from "@/context/AuthContext";
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

// ── Invite Modal ────────────────────────────────────────────────

interface InviteModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function InviteModal({ onClose, onSuccess }: InviteModalProps) {
  const [email, setEmail]         = useState("");
  const [fullName, setFullName]   = useState("");
  const [role, setRole]           = useState<RoleOption>("agent");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
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
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token ?? ""}`,
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
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
        style={{
          background: "#0d1a11",
          border: "1px solid rgba(63,176,108,0.2)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.2)" }}
            >
              <UserPlus className="w-4 h-4 text-agro-green" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-agro-text">Convidar Membro</h2>
              <p className="text-[11px] text-agro-muted-2">Um e-mail de acesso será enviado</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-agro-muted">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
              <input
                type="email"
                required
                placeholder="nome@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-agro w-full pl-9"
              />
            </div>
          </div>

          {/* Full name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-agro-muted">Nome Completo</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
              <input
                type="text"
                required
                placeholder="João Silva"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input-agro w-full pl-9"
              />
            </div>
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-agro-muted">Cargo</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RoleOption)}
              className="input-agro w-full"
            >
              <option value="agent">Agente</option>
              <option value="manager">Gerente</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {/* Error */}
          {error && (
            <div
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-red-400"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <X className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.12)" }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 btn-agro py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enviando...
                </span>
              ) : (
                "Enviar Convite"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Team Page ───────────────────────────────────────────────────

export function Team() {
  const { profile: myProfile } = useAuth();
  const { toast } = useToast();
  const [members, setMembers]     = useState<UserProfile[]>([]);
  const [loading, setLoading]     = useState(true);
  const [updating, setUpdating]   = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  if (!myProfile || !["admin", "manager"].includes(myProfile.role)) {
    return <Navigate to="/" replace />;
  }

  const isAdmin = myProfile.role === "admin";

  const load = useCallback(async () => {
    const { data, error } = await db
      .from("user_profiles")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[Team] load error:", error.message);
    } else {
      setMembers((data as UserProfile[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
      );
      toast({ title: "Cargo atualizado", variant: "success" });
    }
    setUpdating(null);
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Equipe" }]} />

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* ── Header ─────────────────────────── */}
        <div className="flex items-start justify-between animate-fade-up">
          <div>
            <h1 className="font-display text-2xl font-bold text-agro-text flex items-center gap-3">
              <UserCog className="w-6 h-6 text-agro-green" />
              Equipe
            </h1>
            <p className="text-sm text-agro-muted mt-1">
              {isAdmin
                ? "Gerencie os membros e cargos da sua organização."
                : "Visualize os membros da sua organização."}
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={() => setShowInvite(true)}
              className="btn-agro flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
            >
              <UserPlus className="w-4 h-4" />
              Convidar Membro
            </button>
          )}
        </div>

        {/* ── Members table ──────────────────── */}
        <div
          className="rounded-2xl overflow-hidden animate-fade-up-delay-1"
          style={{
            background: "rgba(13,26,17,0.7)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(63,176,108,0.1)",
          }}
        >
          {/* Table header */}
          <div
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-5 py-3"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
          >
            {["", "Membro", "Cargo", isAdmin ? "Alterar cargo" : ""].map((h, i) => (
              <p
                key={i}
                className="text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2"
              >
                {h}
              </p>
            ))}
          </div>

          {/* Rows */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-agro-muted-2 animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-center text-sm text-agro-muted py-16">
              Nenhum membro encontrado.
            </p>
          ) : (
            members.map((member, i) => {
              const rs      = ROLE_STYLE[member.role];
              const isMe    = member.id === myProfile.id;
              const isSaving = updating === member.id;

              return (
                <div
                  key={member.id}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
                  style={{
                    borderBottom:
                      i < members.length - 1
                        ? "1px solid rgba(63,176,108,0.05)"
                        : "none",
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
                      <p className="text-sm font-semibold text-agro-text truncate">
                        {member.full_name ?? "—"}
                      </p>
                      {isMe && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{
                            background: "rgba(63,176,108,0.1)",
                            color: "#3fb06c",
                            border: "1px solid rgba(63,176,108,0.2)",
                          }}
                        >
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
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0"
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
                        onChange={(e) =>
                          handleRoleChange(member.id, e.target.value as RoleOption)
                        }
                        className="input-agro text-xs py-1.5 pr-7 pl-2 w-32 disabled:opacity-50"
                        style={{ minWidth: 120 }}
                      >
                        <option value="admin">Admin</option>
                        <option value="manager">Gerente</option>
                        <option value="agent">Agente</option>
                      </select>
                      {isSaving ? (
                        <Loader2 className="w-3.5 h-3.5 text-agro-muted-2 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5 text-agro-muted-2 opacity-0" />
                      )}
                    </div>
                  ) : (
                    <div />
                  )}
                </div>
              );
            })
          )}
        </div>

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

      {/* ── Invite Modal ───────────────────────────────────────── */}
      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onSuccess={load}
        />
      )}
    </div>
  );
}
