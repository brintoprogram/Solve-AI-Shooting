import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


export function formatNumber(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(n);
}

export function formatPercent(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

export function calcPercent(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

export function estimateDuration(total: number, speed: number): string {
  if (speed === 0) return "—";
  const minutes = Math.ceil(total / speed);
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `~${hours}h ${mins}min`;
}

export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  // Strip trunk zero (e.g. 0xx area code or 0800 style)
  if (digits.startsWith("0")) digits = digits.slice(1);
  // If already has Brazil country code and is long enough, return as-is.
  // Threshold 12 prevents DDD=55 from being mistaken for a country-code prefix
  // (e.g. "55 983710106" = 11 digits → NOT yet normalized → needs "55" prepended).
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return `55${digits}`;
}

export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Neutraliza metacaracteres da sintaxe de filtro do PostgREST antes de
 * interpolar um termo de busca dentro de `.or(...)`.
 *
 * Sem isso, um termo contendo `,` `)` ou `.` reestrutura o grupo OR: além de
 * permitir filtrar por colunas não pretendidas, quebra a busca com erro 400
 * para entradas legítimas como "Silva, João" ou "(11) 98888-7777".
 * O escopo por workspace usa `.eq()` separado e continua intacto.
 */
export function safeFilterTerm(input: string): string {
  return input.replace(/[,()*\:.%]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
