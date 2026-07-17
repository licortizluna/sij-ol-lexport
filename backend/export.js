import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";

function clean(line) { return line.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/^---+$/, "").trimEnd(); }

export async function crearDocx(texto) {
  const children = [];
  for (const raw of String(texto).split(/\r?\n/)) {
    const line = clean(raw);
    if (!line) { children.push(new Paragraph({ spacing: { after: 100 } })); continue; }
    const heading = /^#{1,3}\s/.test(raw);
    const centered = /^(C\.\s+JUEZ|PROTESTO LO NECESARIO|[A-ZÁÉÍÓÚÑ ]+, SONORA, A )/.test(line);
    children.push(new Paragraph({
      heading: heading ? HeadingLevel.HEADING_1 : undefined,
      alignment: centered ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
      spacing: { after: heading ? 180 : 120, line: 300 },
      children: [new TextRun({ text: line, font: "Times New Roman", size: heading ? 26 : 24, color: "000000", bold: heading || /^([IVX]+\.|[A-ZÁÉÍÓÚÑ ]+:)$/.test(line) })]
    }));
  }
  const doc = new Document({ sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }] });
  return Packer.toBuffer(doc);
}

export function enviarPdf(res, texto, nombre) {
  const pdf = new PDFDocument({ size: "LETTER", margins: { top: 72, right: 72, bottom: 72, left: 72 }, info: { Title: nombre, Author: "SIJ-OL" } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nombre}.pdf"`);
  pdf.pipe(res); pdf.font("Times-Roman").fontSize(12);
  for (const raw of String(texto).split(/\r?\n/)) {
    const line = clean(raw); if (!line) { pdf.moveDown(.55); continue; }
    const heading = /^#{1,3}\s/.test(raw);
    if (heading) pdf.font("Times-Bold").fontSize(13).text(line).moveDown(.35).font("Times-Roman").fontSize(12);
    else pdf.text(line, { align: /^(C\.\s+JUEZ|PROTESTO LO NECESARIO)/.test(line) ? "center" : "justify", lineGap: 3 }).moveDown(.35);
  }
  pdf.end();
}
