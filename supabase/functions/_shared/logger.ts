// Logger estruturado para as edge functions (Deno).
//
// Por que não Winston/Pino: Winston depende de `fs`/`stream` do Node e não
// carrega no Deno Deploy. Pino roda, mas todo o valor dele (transports em
// worker threads, escrita em arquivo/socket) é inútil aqui — o Supabase já
// captura o stdout automaticamente. Emitir JSON em uma linha no console é o
// caminho nativo: fica consultável no Logs Explorer e portável caso um dia
// vocês enviem para um coletor externo.
//
// Uso:
//   const log = createLogger("meta-webhook", { request_id: reqId });
//   log.info("inbound_message", { workspace_id, phone });   // phone sai mascarado
//   log.error("send_failed", { err: e.message });

export type Level = "debug" | "info" | "warn" | "error" | "fatal";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const MIN_LEVEL = ORDER[(Deno.env.get("LOG_LEVEL") ?? "info") as Level] ?? ORDER.info;

// ── Data masking ──────────────────────────────────────────────────
// Chaves cujo VALOR nunca pode ir para o log, em qualquer profundidade.
const REDACT = /^(token|access_token|client_token|refresh_token|api_?key|anthropic_api_key|openai_api_key|password|senha|authorization|secret|webhook_secret|cpf|cpf_cnpj|cpf_last_digits|cpf_last_digits_hash|codigo_barras|key_hash)$/i;
const PHONE  = /^(phone|recipient_phone|contact_phone|display_phone|to)$/i;
const EMAIL  = /^(email|email2|email_representante|from_email|support_email)$/i;
// Conteúdo de conversa: é dado pessoal sob LGPD, nunca vai inteiro para o log.
const CONTENT = /^(body|message_body|reply_text|transcript|summary|content|conteudo|payload|raw_response)$/i;

/** Preserva DDI+DDD (útil para triagem) e mascara o resto: 5511****06 */
export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, "");
  return d.length < 6 ? "***" : `${d.slice(0, 4)}****${d.slice(-2)}`;
}

/** b***@dominio.com */
export function maskEmail(v: string): string {
  return v.replace(/^(.).*?(@.*)$/, "$1***$2");
}

export function sanitize(value: unknown, key = "", depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (value === null || value === undefined) return value;

  if (REDACT.test(key)) return "[REDACTED]";

  if (typeof value === "string") {
    if (PHONE.test(key))   return maskPhone(value);
    if (EMAIL.test(key))   return maskEmail(value);
    // Conteúdo de mensagem: registra só o tamanho, nunca o texto.
    if (CONTENT.test(key)) return `[${value.length} chars]`;
    return value.length > 500 ? `${value.slice(0, 500)}…[truncated]` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    if (value.length > 50) return `[array:${value.length}]`;
    return value.map((v) => sanitize(v, key, depth + 1));
  }

  if (value instanceof Error) return { name: value.name, message: value.message };

  if (typeof value === "object") {
    if (CONTENT.test(key)) return "[object omitted]";
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, sanitize(v, k, depth + 1)]),
    );
  }

  return String(value);
}

// ── Contexto ──────────────────────────────────────────────────────
export interface LogContext {
  request_id?:      string;
  workspace_id?:    string;
  user_id?:         string;
  conversation_id?: string;
  contact_id?:      string;
  campaign_id?:     string;
  fn?:              string;
}

export interface Logger {
  ctx:   LogContext;
  child: (extra: LogContext) => Logger;
  debug: (event: string, data?: Record<string, unknown>) => void;
  info:  (event: string, data?: Record<string, unknown>) => void;
  warn:  (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
  /** fatal: a function não consegue cumprir seu propósito — merece alerta. */
  fatal: (event: string, data?: Record<string, unknown>) => void;
}

/**
 * Lê o request_id propagado por quem chamou, ou gera um novo.
 * É isso que permite correlacionar meta-webhook → ai-agent-reply → negotiation-agent.
 */
export function requestIdFrom(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function createLogger(fn: string, base: LogContext = {}): Logger {
  const ctx: LogContext = { fn, request_id: base.request_id ?? crypto.randomUUID(), ...base };

  const emit = (level: Level, event: string, data?: Record<string, unknown>): void => {
    if (ORDER[level] < MIN_LEVEL) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...ctx,
      ...(data ? sanitize(data) as Record<string, unknown> : {}),
    });
    // fatal e error vão para stderr; debug usa log para não poluir warn/error.
    if (level === "error" || level === "fatal") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    ctx,
    child: (extra: LogContext) => createLogger(fn, { ...ctx, ...extra }),
    debug: (e, d) => emit("debug", e, d),
    info:  (e, d) => emit("info",  e, d),
    warn:  (e, d) => emit("warn",  e, d),
    error: (e, d) => emit("error", e, d),
    fatal: (e, d) => emit("fatal", e, d),
  };
}
