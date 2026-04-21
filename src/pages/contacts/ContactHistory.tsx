import { useState } from "react";
import {
  StickyNote, Phone, Mail, Users, CalendarClock, Zap,
  Trash2, Check, Loader2, Plus, ChevronDown,
} from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useContactNotes } from "@/hooks/useContactNotes";

// ── Note type config ─────────────────────────────────────────

const NOTE_TYPES: Record<string, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
}> = {
  nota:      { label: "Nota",          icon: StickyNote,    color: "#9ca3af", bg: "rgba(156,163,175,0.1)" },
  ligacao:   { label: "Ligação",       icon: Phone,         color: "#60a5fa", bg: "rgba(96,165,250,0.1)"  },
  email:     { label: "E-mail",        icon: Mail,          color: "#fb923c", bg: "rgba(251,146,60,0.1)"  },
  reuniao:   { label: "Reunião",       icon: Users,         color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  follow_up: { label: "Follow-up",    icon: CalendarClock,  color: "#fbbf24", bg: "rgba(251,191,36,0.1)"  },
  acao:      { label: "Ação urgente",  icon: Zap,           color: "#f87171", bg: "rgba(248,113,113,0.1)" },
};

// ── Props ────────────────────────────────────────────────────

interface Props {
  phone:        string;
  contactName?: string;
  workspaceId:  string;
}

// ── Main component ───────────────────────────────────────────

export function ContactHistory({ phone, contactName, workspaceId }: Props) {
  const { notes, loading, addNote, toggleFollowUp, deleteNote } =
    useContactNotes(workspaceId, phone);

  const [type,          setType]          = useState("nota");
  const [content,       setContent]       = useState("");
  const [followUpDate,  setFollowUpDate]  = useState("");
  const [saving,        setSaving]        = useState(false);
  const [typeOpen,      setTypeOpen]      = useState(false);

  const selectedType = NOTE_TYPES[type] ?? NOTE_TYPES.nota;
  const TypeIcon     = selectedType.icon;

  async function handleAdd() {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSaving(true);
    await addNote(type, trimmed, contactName, followUpDate || null);
    setContent("");
    setFollowUpDate("");
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* ── Add note form ──────────────────────────── */}
      <div
        className="rounded-xl p-3 space-y-2.5"
        style={{ background: "rgba(63,176,108,0.04)", border: "1px solid rgba(63,176,108,0.12)" }}
      >
        {/* Type selector */}
        <div className="relative">
          <button
            onClick={() => setTypeOpen((v) => !v)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{
              background: selectedType.bg,
              color:      selectedType.color,
              border:     `1px solid ${selectedType.color}40`,
            }}
          >
            <TypeIcon className="w-3.5 h-3.5 shrink-0" />
            {selectedType.label}
            <ChevronDown className="w-3 h-3 ml-auto" />
          </button>

          {typeOpen && (
            <div
              className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden"
              style={{
                background: "rgba(13,26,17,0.98)",
                border:     "1px solid rgba(63,176,108,0.2)",
                boxShadow:  "0 8px 24px rgba(0,0,0,0.5)",
                minWidth:   170,
              }}
            >
              {Object.entries(NOTE_TYPES).map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button
                    key={key}
                    onClick={() => { setType(key); setTypeOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-white/5 transition-colors"
                    style={{ color: cfg.color }}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Textarea */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Descreva a ação, observação ou acordo..."
          rows={3}
          className="w-full bg-transparent text-xs text-white placeholder-[#6b7f6e] resize-none focus:outline-none"
          style={{ lineHeight: 1.6 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleAdd();
          }}
        />

        {/* Follow-up date (only for follow_up type) */}
        {type === "follow_up" && (
          <div className="flex items-center gap-2">
            <CalendarClock className="w-3.5 h-3.5 text-[#fbbf24] shrink-0" />
            <input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="bg-transparent text-xs text-white focus:outline-none"
              style={{ colorScheme: "dark" }}
            />
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end">
          <button
            onClick={handleAdd}
            disabled={!content.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#3fb06c] disabled:opacity-40 transition-colors hover:bg-[#3fb06c]/10"
            style={{ border: "1px solid rgba(63,176,108,0.3)" }}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Registrar
          </button>
        </div>
      </div>

      {/* ── Timeline ────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {loading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 text-[#3fb06c] animate-spin" />
          </div>
        )}

        {!loading && notes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <StickyNote className="w-8 h-8 text-[#3a4d3e]" />
            <p className="text-xs text-[#6b7f6e]">Nenhum registro ainda</p>
            <p className="text-[11px] text-[#4a5c4e]">Use o formulário acima para registrar ligações, acordos e follow-ups</p>
          </div>
        )}

        {notes.map((note) => {
          const cfg    = NOTE_TYPES[note.type] ?? NOTE_TYPES.nota;
          const Icon   = cfg.icon;
          const isFollowUp = note.type === "follow_up";
          return (
            <div
              key={note.id}
              className="flex gap-2.5 group"
            >
              {/* Icon track */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: cfg.bg, border: `1px solid ${cfg.color}40` }}
                >
                  <Icon className="w-3 h-3" style={{ color: cfg.color }} />
                </div>
              </div>

              {/* Content */}
              <div
                className="flex-1 rounded-xl p-2.5 min-w-0"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border:     "1px solid rgba(63,176,108,0.08)",
                }}
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span className="text-[10px] font-semibold" style={{ color: cfg.color }}>
                      {cfg.label}
                    </span>
                    {note.created_by_name && (
                      <>
                        <span className="text-[#3a4d3e] text-[10px]">·</span>
                        <span className="text-[10px] text-[#6b7f6e] truncate">{note.created_by_name.split(" ")[0]}</span>
                      </>
                    )}
                    <span className="text-[#3a4d3e] text-[10px]">·</span>
                    <span className="text-[10px] text-[#4a5c4e]" title={format(parseISO(note.created_at), "dd/MM/yyyy HH:mm")}>
                      {formatDistanceToNow(parseISO(note.created_at), { addSuffix: true, locale: ptBR })}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isFollowUp && (
                      <button
                        onClick={() => toggleFollowUp(note.id, !note.follow_up_done)}
                        title={note.follow_up_done ? "Marcar como pendente" : "Marcar como feito"}
                        className="w-5 h-5 rounded flex items-center justify-center transition-colors"
                        style={{
                          background: note.follow_up_done ? "rgba(63,176,108,0.2)" : "rgba(255,255,255,0.05)",
                          border:     `1px solid ${note.follow_up_done ? "rgba(63,176,108,0.4)" : "rgba(255,255,255,0.1)"}`,
                          color:      note.follow_up_done ? "#3fb06c" : "#6b7f6e",
                        }}
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteNote(note.id)}
                      className="w-5 h-5 rounded flex items-center justify-center text-[#6b7f6e] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Content text */}
                <p className="text-xs text-[#c4d4c8] leading-relaxed whitespace-pre-wrap break-words">
                  {note.content}
                </p>

                {/* Follow-up date badge */}
                {isFollowUp && note.follow_up_date && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <CalendarClock className="w-3 h-3 shrink-0" style={{ color: note.follow_up_done ? "#3fb06c" : "#fbbf24" }} />
                    <span
                      className="text-[10px] font-medium"
                      style={{ color: note.follow_up_done ? "#3fb06c" : "#fbbf24" }}
                    >
                      {format(parseISO(note.follow_up_date), "dd/MM/yyyy")}
                      {" "}
                      {note.follow_up_done ? "· Concluído" : "· Pendente"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
