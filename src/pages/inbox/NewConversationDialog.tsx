import { useState } from "react";
import { X, Send, Phone, MessageSquare } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import type { ConnectionInfo } from "@/types/inbox";

interface Props {
  open: boolean;
  onClose: () => void;
  zapiConnections: ConnectionInfo[];
  workspaceId: string;
  onCreated: (conversationId: string) => void;
}

export function NewConversationDialog({ open, onClose, zapiConnections, workspaceId, onCreated }: Props) {
  const { profile } = useAuth();
  const [selectedConn, setSelectedConn] = useState<string>(zapiConnections[0]?.id ?? "");
  const [phone,        setPhone]        = useState("");
  const [message,      setMessage]      = useState("");
  const [sending,      setSending]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  if (!open) return null;

  const normalizePhone = (raw: string) => raw.replace(/\D/g, "");

  async function handleSend() {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || normalizedPhone.length < 8) {
      setError("Informe um número de telefone válido.");
      return;
    }
    if (!message.trim()) {
      setError("Digite uma mensagem para enviar.");
      return;
    }
    if (!selectedConn) {
      setError("Selecione uma conexão Z-API.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke("start-z-api-conversation", {
        body: {
          z_api_connection_id: selectedConn,
          phone: normalizedPhone,
          message: message.trim(),
          sent_by: profile?.id ?? null,
        },
      });

      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);

      setPhone("");
      setMessage("");
      onCreated(data.conversation_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao iniciar conversa.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{
          background: "#0d1a11",
          border: "1px solid rgba(63,176,108,0.2)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}
            >
              <MessageSquare className="w-4 h-4 text-agro-green" />
            </div>
            <div>
              <p className="text-sm font-semibold text-agro-text">Nova conversa</p>
              <p className="text-[11px] text-agro-muted-2">Via Z-API</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text transition-colors"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Connection selector — only when multiple Z-API */}
          {zapiConnections.length > 1 && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 block mb-1.5">
                Conexão Z-API
              </label>
              <div className="flex gap-2 flex-wrap">
                {zapiConnections.map((conn) => (
                  <button
                    key={conn.id}
                    onClick={() => setSelectedConn(conn.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={selectedConn === conn.id
                      ? { background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.4)" }
                      : { background: "rgba(0,0,0,0.2)", color: "#6b8a75", border: "1px solid rgba(63,176,108,0.1)" }
                    }
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: selectedConn === conn.id ? "#f59e0b" : "#6b8a75" }} />
                    {conn.label || conn.phone || "Z-API"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Phone */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 block mb-1.5">
              Número de WhatsApp
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-agro-muted-2 pointer-events-none" />
              <input
                type="tel"
                placeholder="55 11 99999-9999"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(null); }}
                className="input-agro w-full pl-9 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
              />
            </div>
            <p className="text-[10px] text-agro-muted-2 mt-1">Com código do país. Ex: 5511999998888</p>
          </div>

          {/* Message */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 block mb-1.5">
              Primeira mensagem
            </label>
            <textarea
              placeholder="Digite a mensagem inicial..."
              value={message}
              onChange={(e) => { setMessage(e.target.value); setError(null); }}
              rows={3}
              className="input-agro w-full text-sm resize-none"
              style={{ minHeight: 80 }}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={{
              background: sending ? "rgba(63,176,108,0.3)" : "linear-gradient(135deg, #3fb06c, #16a34a)",
              color: "white",
              boxShadow: sending ? "none" : "0 2px 8px rgba(63,176,108,0.35)",
            }}
          >
            {sending ? (
              <div className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {sending ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
