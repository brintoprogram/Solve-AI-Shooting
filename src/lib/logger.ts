// Logger estruturado do frontend.
//
// Por que não Winston/Pino: ambos são feitos para servidor (filesystem,
// streams, worker threads). No browser não há onde escrever — logging de
// frontend é sobre *enviar* para um coletor. Este módulo mantém a mesma forma
// (níveis + masking + contexto) do _shared/logger.ts das edge functions, e
// deixa um ponto de plugue único (`setReporter`) para Sentry/Axiom quando
// vocês decidirem. Sem SDK instalado por ora — essa decisão é de vocês.

export type Level = "debug" | "info" | "warn" | "error" | "fatal";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const IS_DEV = import.meta.env.DEV;
const MIN_LEVEL = IS_DEV ? ORDER.debug : ORDER.info;

// ── Data masking (mesmas regras do backend) ───────────────────────
const REDACT  = /^(token|access_token|api_?key|password|senha|authorization|secret|cpf|cpf_cnpj|codigo_barras)$/i;
const PHONE   = /^(phone|recipient_phone|contact_phone|to)$/i;
const EMAIL   = /^(email|email2|email_representante|from_email)$/i;
const CONTENT = /^(body|message_body|reply_text|transcript|content|conteudo)$/i;

const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, "");
  return d.length < 6 ? "***" : `${d.slice(0, 4)}****${d.slice(-2)}`;
};
const maskEmail = (v: string) => v.replace(/^(.).*?(@.*)$/, "$1***$2");

function sanitize(value: unknown, key = "", depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (value === null || value === undefined) return value;
  if (REDACT.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (PHONE.test(key))   return maskPhone(value);
    if (EMAIL.test(key))   return maskEmail(value);
    if (CONTENT.test(key)) return `[${value.length} chars]`;
    return value.length > 500 ? `${value.slice(0, 500)}…[truncated]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 50 ? `[array:${value.length}]` : value.map((v) => sanitize(v, key, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.slice(0, 2000) };
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitize(v, k, depth + 1)]),
    );
  }
  return String(value);
}

// ── Contexto de sessão ────────────────────────────────────────────
interface SessionContext {
  user_id?:      string;
  workspace_id?: string;
  role?:         string;
}
let sessionCtx: SessionContext = {};

/** Chamado pelo AuthContext quando a sessão resolve — dá userId/workspace a todo log seguinte. */
export function setLogContext(ctx: SessionContext): void {
  sessionCtx = { ...sessionCtx, ...ctx };
}

export function clearLogContext(): void {
  sessionCtx = {};
}

// ── Reporter plugável (Sentry/Axiom entram aqui) ──────────────────
type Reporter = (entry: Record<string, unknown>) => void;
let reporter: Reporter | null = null;

/** Registra o destino externo dos logs de nível error/fatal. */
export function setReporter(fn: Reporter): void {
  reporter = fn;
}

// Correlaciona todos os eventos de uma mesma aba/sessão.
const SESSION_ID = crypto.randomUUID();

function emit(level: Level, event: string, data?: Record<string, unknown>): void {
  if (ORDER[level] < MIN_LEVEL) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    session_id: SESSION_ID,
    ...sessionCtx,
    ...(data ? sanitize(data) as Record<string, unknown> : {}),
  };

  if (IS_DEV) {
    // Em dev, formato legível no console.
    const fn = level === "error" || level === "fatal" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[${level}] ${event}`, entry);
  } else if (level === "error" || level === "fatal") {
    console.error(JSON.stringify(entry));
  }

  // Só erro/fatal vão para o coletor — evita custo e ruído.
  if (reporter && (level === "error" || level === "fatal")) {
    try { reporter(entry); } catch { /* nunca deixar o logger derrubar a app */ }
  }
}

export const log = {
  debug: (event: string, data?: Record<string, unknown>) => emit("debug", event, data),
  info:  (event: string, data?: Record<string, unknown>) => emit("info",  event, data),
  warn:  (event: string, data?: Record<string, unknown>) => emit("warn",  event, data),
  error: (event: string, data?: Record<string, unknown>) => emit("error", event, data),
  fatal: (event: string, data?: Record<string, unknown>) => emit("fatal", event, data),
};
