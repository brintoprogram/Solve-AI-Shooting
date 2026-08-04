import DOMPurify from "dompurify";

/**
 * Escapa caracteres HTML de um valor vindo de dados (contato, fatura, etc).
 *
 * IMPORTANTE: dados de contato NÃO são confiáveis. `inbox_contacts.name` é
 * preenchido com o nome de perfil do WhatsApp de quem manda mensagem para a
 * empresa (meta-webhook), ou com o conteúdo de uma planilha importada — ambos
 * controlados por terceiros. Sem escape, um nome como
 * `<img src=x onerror=...>` vira código executável ao ser interpolado num
 * template de email e renderizado no preview.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

/**
 * Sanitiza uma string HTML antes de renderizar via dangerouslySetInnerHTML.
 *
 * Mantém a marcação usual de email (tabelas, formatação, links, imagens) e
 * remove scripts, handlers inline (onerror/onclick/…), iframes, forms e
 * URLs `javascript:`. Use SEMPRE em conjunto com escapeHtml() nos dados
 * interpolados — são camadas complementares, não alternativas.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base", "link", "meta"],
    FORBID_ATTR: ["formaction", "srcdoc", "ping"],
    ALLOW_DATA_ATTR: false,
  });
}
