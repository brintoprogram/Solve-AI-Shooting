import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ── Brand colours (work on white paper) ─────────────────────
const C = {
  headerBg:   [10, 26, 16]    as [number, number, number],
  headerText: [63, 176, 108]  as [number, number, number],
  tablHead:   [22, 56, 36]    as [number, number, number],
  tablAlt:    [242, 250, 244] as [number, number, number],
  muted:      [107, 135, 115] as [number, number, number],
  body:       [20, 40, 26]    as [number, number, number],
};

const PAGE_W = 210; // A4

// ── Header bar ───────────────────────────────────────────────

export function drawPdfHeader(doc: jsPDF, title: string, subtitle?: string) {
  doc.setFillColor(...C.headerBg);
  doc.rect(0, 0, PAGE_W, 28, "F");

  doc.setFontSize(14);
  doc.setTextColor(...C.headerText);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, 13);

  doc.setFontSize(8);
  doc.setTextColor(180, 210, 190);
  doc.setFont("helvetica", "normal");
  if (subtitle) doc.text(subtitle, 14, 20);

  const dateStr = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  doc.text(`Gerado em ${dateStr}`, PAGE_W - 14, 20, { align: "right" });

  // green accent line
  doc.setDrawColor(...C.headerText);
  doc.setLineWidth(0.6);
  doc.line(0, 28, PAGE_W, 28);

  return 36; // cursor Y after header
}

// ── Section label ─────────────────────────────────────────────

export function drawSection(doc: jsPDF, label: string, y: number): number {
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.muted);
  doc.text(label.toUpperCase(), 14, y);
  doc.setDrawColor(...C.tablHead);
  doc.setLineWidth(0.3);
  doc.line(14, y + 1.5, PAGE_W - 14, y + 1.5);
  return y + 6;
}

// ── Key-value rows ────────────────────────────────────────────

export function drawKVRows(
  doc: jsPDF,
  rows: [string, string][],
  startY: number,
  colW = 40,
): number {
  let y = startY;
  for (const [k, v] of rows) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.muted);
    doc.text(k, 14, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.body);
    doc.text(v, 14 + colW, y);
    y += 6;
  }
  return y + 2;
}

// ── Standard table ────────────────────────────────────────────

export function drawTable(
  doc: jsPDF,
  head: string[],
  body: (string | number)[][],
  startY: number,
): number {
  autoTable(doc, {
    head: [head],
    body: body.map((r) => r.map(String)),
    startY,
    margin: { left: 14, right: 14 },
    styles: {
      fontSize: 8,
      cellPadding: 3,
      textColor: C.body,
      lineColor: [220, 235, 225],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: C.tablHead,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: C.tablAlt },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 6;
}

// ── Footer ────────────────────────────────────────────────────

export function drawFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.setFont("helvetica", "normal");
    doc.text("Solve AI — solveai.consulting", 14, 290);
    doc.text(`Página ${i} / ${pages}`, PAGE_W - 14, 290, { align: "right" });
  }
}
