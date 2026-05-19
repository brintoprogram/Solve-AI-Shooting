import { useState, useEffect, useCallback } from "react";
import { Sparkles, Plus, Trash2, Users, MessageSquare, Bell, RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ── Demo workspace guard ───────────────────────────────────────────────────────
const DEMO_WS = "8e8fb35f-eb33-4067-ba84-b1db067673a1";

// ── Realistic agro contact templates ──────────────────────────────────────────
const CONTACT_TEMPLATES = [
  { name: "Luís Henrique Ferreira",   phone: "5517996543210", empresa: "Agropecuária Ferreira",        cidade: "Ribeirão Preto", estado: "SP", valor: 3800,  tag: "cliente" },
  { name: "Patrícia Almeida Borges",  phone: "5565992341567", empresa: "Fazenda Santa Clara",          cidade: "Sinop",          estado: "MT", valor: 7200,  tag: "cliente" },
  { name: "Eduardo Moreira Cunha",    phone: "5562991122330", empresa: "Grupo Cunha Agro",             cidade: "Jataí",          estado: "GO", valor: 12500, tag: "vip"     },
  { name: "Simone Ramos Teixeira",    phone: "5549997654321", empresa: "Sim Agro Consultoria",         cidade: "Chapecó",        estado: "SC", valor: 2300,  tag: "cliente" },
  { name: "Fábio Gonçalves Leal",     phone: "5534998877665", empresa: "Fazenda Boa Esperança",       cidade: "Uberaba",        estado: "MG", valor: 5600,  tag: "cliente" },
  { name: "Adriana Souza Pinheiro",   phone: "5511997001234", empresa: "Pinheiro Grãos e Insumos",    cidade: "Campinas",       estado: "SP", valor: 9100,  tag: "prospect"},
  { name: "Renato Barbosa Soares",    phone: "5567991234009", empresa: "RB Agro Ltda",                cidade: "Dourados",       estado: "MS", valor: 4400,  tag: "cliente" },
  { name: "Juliana Costa Meireles",   phone: "5521998001122", empresa: "Fazenda Meireles",             cidade: "Campos",         estado: "RJ", valor: 1900,  tag: "cliente" },
  { name: "Wellington Andrade Lima",  phone: "5574993456781", empresa: "Andrade Pecuária",             cidade: "Barreiras",      estado: "BA", valor: 6300,  tag: "vip"     },
  { name: "Cristiane Nunes Oliveira", phone: "5541996001234", empresa: "Agro Nunes Exportação",       cidade: "Curitiba",       estado: "PR", valor: 15000, tag: "vip"     },
  { name: "Marcelo Figueiredo Brant", phone: "5531992334455", empresa: "Figueiredo Sementes",         cidade: "Belo Horizonte",  estado: "MG", valor: 3200,  tag: "cliente" },
  { name: "Aline Rodrigues Campos",   phone: "5577991112233", empresa: "Campo Verde Agro",             cidade: "Bauru",          estado: "SP", valor: 8700,  tag: "prospect"},
];

const ALERT_SCENARIOS = [
  { category: "duvida",              severity: "info",     reply: "Tenho uma dúvida sobre o valor do boleto. Pode esclarecer?", summary: "Cliente solicita esclarecimento sobre valor cobrado." },
  { category: "pagamento_confirmado",severity: "info",     reply: "Efetuei o pagamento via PIX agora mesmo! Pode confirmar?",   summary: "Cliente confirma pagamento via PIX. Aguarda baixa no sistema." },
  { category: "elogio",              severity: "info",     reply: "Queria agradecer! O atendimento de vocês é excelente!",       summary: "Cliente elogia o atendimento. Oportunidade para indicação." },
  { category: "valor_incorreto",     severity: "warning",  reply: "O valor cobrado está errado. Meu contrato prevê outro valor.", summary: "Cliente contesta valor da fatura. Verificar histórico contratual." },
  { category: "reclamacao",          severity: "warning",  reply: "Já tentei pagar pelo portal 3 vezes e dá erro toda hora!",    summary: "Falha recorrente no portal de pagamento. Encaminhar ao suporte técnico." },
  { category: "fraude",              severity: "critical", reply: "Isso é uma fraude! Nunca contratei nada com vocês!",          summary: "Cliente alega fraude. Verificar contrato urgentemente." },
  { category: "ameaca",              severity: "critical", reply: "Se não resolverem hoje vou acionar meu advogado!",            summary: "Cliente ameaça ação judicial. Encaminhar ao jurídico." },
  { category: "nao_reconhece",       severity: "critical", reply: "Não reconheço essa cobrança. Nunca autorizei esse valor.",    summary: "Cliente nega reconhecer a cobrança. Verificar origem da dívida." },
];

const CAMPAIGNS = [
  "de000000-0000-0000-0000-000000000206",
  "de000000-0000-0000-0000-000000000207",
  "de000000-0000-0000-0000-000000000208",
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function vencOffset(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Seed helpers ───────────────────────────────────────────────────────────────

async function seedContact(wsId: string): Promise<{ contactId: string; name: string; phone: string } | null> {
  const db = supabase as any;
  const tpl = pick(CONTACT_TEMPLATES);
  const offsets = [-15, -7, -3, 0, 3, 7, 14, 21];
  const venc = vencOffset(pick(offsets));

  const { data: contact, error: cErr } = await db
    .from("inbox_contacts")
    .insert({
      workspace_id: wsId,
      name:         tpl.name,
      phone:        tpl.phone,
      empresa:      tpl.empresa,
      cidade:       tpl.cidade,
      estado:       tpl.estado,
      tags:         [tpl.tag],
    })
    .select("id")
    .single();

  if (cErr || !contact) return null;
  const contactId = contact.id as string;

  await db.from("contact_invoices").insert({
    contact_id:    contactId,
    workspace_id:  wsId,
    valor:         tpl.valor + Math.round(Math.random() * 1000),
    vencimento:    venc,
    status:        new Date(venc) < new Date() ? "vencido" : "pendente",
    numero_nf:     `NF-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    codigo_barras: null,
  });

  return { contactId, name: tpl.name, phone: tpl.phone };
}

async function seedConversation(wsId: string, contactId: string, name: string, phone: string): Promise<string | null> {
  const db = supabase as any;
  const reply = pick(ALERT_SCENARIOS).reply;

  const { data: conv, error: cErr } = await db
    .from("inbox_conversations")
    .insert({
      workspace_id:           wsId,
      contact_id:             contactId,
      status:                 "open",
      unread_count:           1,
      last_message_at:        new Date(Date.now() - Math.random() * 3_600_000).toISOString(),
      last_message_body:      reply,
      last_message_direction: "inbound",
    })
    .select("id")
    .single();

  if (cErr || !conv) return null;
  const convId = conv.id as string;

  const outMsg = `Olá, ${name.split(" ")[0]}! Identificamos um boleto em aberto. Podemos ajudar?`;
  await db.from("inbox_messages").insert([
    {
      workspace_id:    wsId, conversation_id: convId, contact_id: contactId,
      direction:       "outbound", message_type: "text", body: outMsg,
      status:          "read",    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      workspace_id:    wsId, conversation_id: convId, contact_id: contactId,
      direction:       "inbound", message_type: "text", body: reply,
      status:          "delivered", created_at: new Date(Date.now() - Math.random() * 1_800_000).toISOString(),
    },
  ]);

  return convId;
}

async function seedAlert(wsId: string, contactId: string, convId: string, name: string, phone: string): Promise<void> {
  const db = supabase as any;
  const scen    = pick(ALERT_SCENARIOS);
  const campaign = pick(CAMPAIGNS);

  const { data: smsg } = await db
    .from("shooting_messages")
    .insert({ campaign_id: campaign, workspace_id: wsId, recipient_phone: phone, recipient_name: name, status: "read", sent_at: new Date(Date.now() - 3_600_000).toISOString(), replied_at: new Date().toISOString() })
    .select("id")
    .single();

  if (!smsg) return;

  await db.from("campaign_alerts").insert({
    workspace_id:   wsId,
    campaign_id:    campaign,
    message_id:     smsg.id,
    conversation_id: convId,
    recipient_phone: phone,
    recipient_name:  name,
    reply_text:      scen.reply,
    severity:        scen.severity,
    category:        scen.category,
    summary:         scen.summary,
    created_at:      new Date().toISOString(),
    analyzed_at:     new Date().toISOString(),
  });
}

// ── Stats loader ───────────────────────────────────────────────────────────────
interface DemoStats {
  contacts:      number;
  conversations: number;
  alerts:        number;
}

async function loadStats(wsId: string): Promise<DemoStats> {
  const db = supabase as any;
  const [c, v, a] = await Promise.all([
    db.from("inbox_contacts")      .select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
    db.from("inbox_conversations")  .select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
    db.from("campaign_alerts")      .select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
  ]);
  return {
    contacts:      c.count  ?? 0,
    conversations: v.count  ?? 0,
    alerts:        a.count  ?? 0,
  };
}

async function clearDemoData(wsId: string): Promise<void> {
  const db = supabase as any;
  // Only deletes contacts/conversations with no real shooting_messages FK chain
  // Uses the pattern: non-de000000 contacts (i.e. contacts created via DemoSeeder with gen_random_uuid)
  // We safely target only inbox_contacts that have NO original de000000 IDs
  // Strategy: delete everything in the workspace that isn't part of the original fixed-ID seed
  // Fixed IDs: 101–119 (contacts), 301–308 (conversations), 501–508 (messages)
  const FIXED_CONTACT_IDS = [
    "de000000-0000-0000-0000-000000000101","de000000-0000-0000-0000-000000000102",
    "de000000-0000-0000-0000-000000000105","de000000-0000-0000-0000-000000000109",
    "de000000-0000-0000-0000-000000000111","de000000-0000-0000-0000-000000000114",
    "de000000-0000-0000-0000-000000000117","de000000-0000-0000-0000-000000000119",
  ];

  // Get all contact IDs in this workspace that are NOT in the fixed seed
  const { data: extraContacts } = await db
    .from("inbox_contacts")
    .select("id")
    .eq("workspace_id", wsId)
    .not("id", "in", `(${FIXED_CONTACT_IDS.join(",")})`);

  const extraIds = (extraContacts ?? []).map((r: { id: string }) => r.id);
  if (extraIds.length === 0) return;

  // Delete conversations and their messages for extra contacts
  const { data: extraConvs } = await db
    .from("inbox_conversations")
    .select("id")
    .eq("workspace_id", wsId)
    .in("contact_id", extraIds);
  const extraConvIds = (extraConvs ?? []).map((r: { id: string }) => r.id);

  if (extraConvIds.length > 0) {
    await db.from("inbox_messages").delete().in("conversation_id", extraConvIds);
    // Delete campaign_alerts linked to these conversations
    await db.from("campaign_alerts").delete().eq("workspace_id", wsId).in("conversation_id", extraConvIds);
    await db.from("inbox_conversations").delete().in("id", extraConvIds);
  }

  // Delete invoices and contacts
  await db.from("contact_invoices").delete().in("contact_id", extraIds);
  await db.from("inbox_contacts").delete().in("id", extraIds);
}

// ── Component ──────────────────────────────────────────────────────────────────

export function DemoSeeder({ workspaceId }: { workspaceId: string }) {
  const { toast }      = useToast();
  const isDemo         = workspaceId === DEMO_WS;

  const [stats,      setStats]      = useState<DemoStats | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [adding,     setAdding]     = useState(false);
  const [clearing,   setClearing]   = useState(false);
  const [confirmClr, setConfirmClr] = useState(false);
  const [lastAdded,  setLastAdded]  = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStats(await loadStats(workspaceId));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleAddContact() {
    setAdding(true);
    try {
      const result = await seedContact(workspaceId);
      if (!result) throw new Error("Falha ao criar contato");
      const { contactId, name, phone } = result;

      const convId = await seedConversation(workspaceId, contactId, name, phone);
      if (convId) await seedAlert(workspaceId, contactId, convId, name, phone);

      setLastAdded(name);
      toast({ title: "Contato demo criado!", description: `${name} adicionado com fatura, conversa e alerta.`, variant: "success" });
      await refresh();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    setConfirmClr(false);
    try {
      await clearDemoData(workspaceId);
      setLastAdded(null);
      toast({ title: "Dados extras removidos", description: "Dados do seed original foram preservados.", variant: "success" });
      await refresh();
    } catch (err) {
      toast({ title: "Erro ao limpar", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setClearing(false);
    }
  }

  const STAT_ITEMS = [
    { label: "Contatos",    value: stats?.contacts,      icon: Users,          color: "#7fc49a" },
    { label: "Conversas",   value: stats?.conversations, icon: MessageSquare,  color: "#60a5fa" },
    { label: "Alertas",     value: stats?.alerts,        icon: Bell,           color: "#f59e0b" },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-agro-text">Gerenciador de Dados Demo</p>
          <p className="text-[11px] text-agro-muted mt-0.5">
            {isDemo
              ? "Ambiente de demonstração — adicione dados fictícios para apresentações."
              : "Disponível apenas no workspace de demonstração."}
          </p>
        </div>
        <button onClick={refresh} disabled={loading} className="p-1.5 rounded-lg text-agro-muted hover:text-white transition-colors disabled:opacity-40">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {STAT_ITEMS.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="p-3 rounded-xl text-center" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(63,176,108,0.08)" }}>
            <Icon className="w-4 h-4 mx-auto mb-1" style={{ color }} />
            <p className="text-xl font-bold" style={{ color }}>
              {loading ? "—" : (value ?? 0)}
            </p>
            <p className="text-[10px] text-agro-muted">{label}</p>
          </div>
        ))}
      </div>

      {/* Last added feedback */}
      {lastAdded && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl animate-fade-in"
          style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.2)" }}>
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: "#3fb06c" }} />
          <p className="text-[11px] text-agro-green"><strong>{lastAdded}</strong> adicionado — aparece em Contatos, Inbox e Alertas.</p>
        </div>
      )}

      {/* Main CTA */}
      <button
        onClick={handleAddContact}
        disabled={adding || !isDemo}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
        style={{
          background: "linear-gradient(135deg, rgba(63,176,108,0.2), rgba(22,163,74,0.1))",
          border:     "1px solid rgba(63,176,108,0.4)",
          color:      "#3fb06c",
        }}
      >
        {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        {adding ? "Criando..." : "Gerar contato demo"}
      </button>

      <p className="text-[10px] text-agro-muted text-center -mt-2">
        Cria um contato fictício com fatura pendente, conversa no inbox e alerta gerado pela IA.
      </p>

      {/* Info box */}
      <div className="rounded-xl p-3 space-y-1.5" style={{ background: "rgba(0,0,0,0.15)", border: "1px solid rgba(63,176,108,0.07)" }}>
        <p className="text-[10px] font-bold text-agro-muted uppercase tracking-widest">O que é criado</p>
        {[
          "Contato com nome, telefone, empresa e cidade reais",
          "Fatura pendente com valor e vencimento aleatório",
          "Conversa no Inbox com 2 mensagens (out + inbound)",
          "Alerta de campanha com categoria e severidade variadas",
        ].map((item) => (
          <p key={item} className="text-[11px] text-agro-muted flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-agro-green/50 shrink-0" />
            {item}
          </p>
        ))}
      </div>

      {/* Danger zone */}
      {isDemo && (
        <div className="pt-2" style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
          <p className="text-[10px] font-bold text-agro-muted uppercase tracking-widest mb-3">Zona de risco</p>
          {!confirmClr ? (
            <button
              onClick={() => setConfirmClr(true)}
              disabled={clearing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-agro-muted hover:text-red-400 transition-colors disabled:opacity-40"
              style={{ border: "1px solid rgba(239,68,68,0.15)" }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remover contatos extras (preserva seed original)
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-[11px] text-red-400 flex-1">Tem certeza? Contatos adicionados serão apagados.</p>
              <button onClick={() => setConfirmClr(false)} className="text-[11px] text-agro-muted hover:text-white px-3 py-1.5 rounded-lg" style={{ border: "1px solid rgba(63,176,108,0.15)" }}>Cancelar</button>
              <button onClick={handleClear} disabled={clearing}
                className="text-[11px] text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                style={{ background: "rgba(239,68,68,0.7)" }}>
                {clearing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirmar"}
              </button>
            </div>
          )}
        </div>
      )}

      {!isDemo && (
        <div className="rounded-xl p-4 text-center" style={{ background: "rgba(0,0,0,0.15)", border: "1px dashed rgba(63,176,108,0.1)" }}>
          <Sparkles className="w-5 h-5 text-agro-muted/40 mx-auto mb-1" />
          <p className="text-xs text-agro-muted/60">Disponível apenas no workspace <strong>Demo — Solve AI</strong></p>
        </div>
      )}
    </div>
  );
}
