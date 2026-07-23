// Pure pdfkit renderer for the AI Act AI-literacy report — no DB/auth imports,
// so it can be unit-tested and previewed in isolation. Data is assembled in
// index.ts; localized strings come from strings.ts (ADR-0016 category 3).
import PDFDocument from 'pdfkit';
import { LOGO_BUFFER } from './logo';
import { STRINGS, type Lang, type LevelKey, type DeptStatus } from './strings';

export interface DeptRow { dept: string; staff: number; trained: number; pct: number; level: LevelKey; status: DeptStatus }
export interface CourseRow { title: string; pct: number }
export interface LevelRow { key: LevelKey; n: number; pct: number }
export interface ReportData {
  org: string;
  preparedBy: string;
  dateStr: string;
  ref: string;
  target: number;
  kf: { staff: number; trained: number; participation: number; notTrained: number; refresher: number };
  belowN: number;
  deficiency: boolean;
  depts: DeptRow[];
  courses: CourseRow[];
  levels: LevelRow[];
}

// near-monochrome palette; oxblood only marks a deficiency
const INK = '#1a1c24', NAVY = '#10298f', OX = '#8a2a2a', MUT = '#565a6b';
const HAIR = '#c8ccd7', SOFT = '#e3e6ee', DECL = '#2a2d38';
const PAGE = { w: 595.28, h: 841.89 }, M = 46, CW = PAGE.w - M * 2;
const uc = (str: string) => str.toUpperCase();

interface Col<R> { label: string; x: number; w: number; align?: 'left' | 'right'; bold?: boolean; color?: (r: R) => string; map: (r: R) => string }

export function generatePDF(data: ReportData, lang: Lang): Promise<Buffer> {
  const s = STRINGS[lang];
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // helpers ------------------------------------------------------------
    const sec = (n: number, title: string, yy: number, ox = M, ow = CW): number => {
      doc.font('Times-Bold').fontSize(11).fillColor(INK).text('§' + n, ox, yy, { continued: true });
      doc.fillColor(NAVY).text('  ' + title);
      const ny = doc.y + 4;
      doc.moveTo(ox, ny).lineTo(ox + ow, ny).lineWidth(1).strokeColor(NAVY).stroke();
      return ny + 9;
    };
    const ledger = <R>(ox: number, ow: number, cols: Col<R>[], rows: R[], yy: number): number => {
      doc.font('Times-Bold').fontSize(8).fillColor(MUT);
      cols.forEach((c) => doc.text(uc(c.label), ox + c.x, yy, { width: c.w, align: c.align || 'left', characterSpacing: 0.4, lineBreak: false }));
      yy += 13;
      doc.moveTo(ox, yy).lineTo(ox + ow, yy).lineWidth(1.2).strokeColor(INK).stroke();
      yy += 6;
      doc.fontSize(10);
      rows.forEach((r) => {
        cols.forEach((c) => {
          doc.font(c.bold ? 'Times-Bold' : 'Times-Roman').fillColor(c.color ? c.color(r) : INK)
            .text(c.map(r), ox + c.x, yy, { width: c.w, align: c.align || 'left' });
        });
        yy += 16;
        doc.moveTo(ox, yy - 4).lineTo(ox + ow, yy - 4).lineWidth(0.4).strokeColor(SOFT).stroke();
      });
      return yy;
    };
    const emptyRow = (msg: string, ox: number, yy: number): number => {
      doc.font('Times-Italic').fontSize(9.5).fillColor(MUT).text(msg, ox, yy + 4, { width: CW });
      return doc.y + 6;
    };

    // letterhead ---------------------------------------------------------
    let y = M;
    doc.image(LOGO_BUFFER, M, y, { width: 126 });
    doc.font('Times-Bold').fontSize(11).fillColor(INK).text(s.docType, M, y + 2, { width: CW, align: 'right' });
    doc.font('Times-Roman').fontSize(9).fillColor(MUT).text('Ref. ' + data.ref, M, y + 18, { width: CW, align: 'right' });
    doc.font('Times-Bold').fontSize(8);
    const ct = uc(s.conf), ctw = doc.widthOfString(ct, { characterSpacing: 1 });
    const bx = M + CW - ctw - 12, by = y + 33;
    doc.rect(bx, by, ctw + 12, 14).lineWidth(0.8).strokeColor(OX).stroke();
    doc.fillColor(OX).text(ct, bx + 6, by + 3.5, { characterSpacing: 1, lineBreak: false });
    const ry = y + 60;
    doc.moveTo(M, ry).lineTo(M + CW, ry).lineWidth(2.5).strokeColor(NAVY).stroke();
    doc.moveTo(M, ry + 3.5).lineTo(M + CW, ry + 3.5).lineWidth(0.75).strokeColor(NAVY).stroke();
    y = ry + 22;

    // title block --------------------------------------------------------
    doc.font('Times-Bold').fontSize(21).fillColor(INK).text(s.title, M, y, { width: CW, align: 'center' });
    y = doc.y + 2;
    doc.font('Times-Italic').fontSize(10.5).fillColor(MUT).text(s.reg, M, y, { width: CW, align: 'center' });
    y = doc.y + 12;

    // metadata -----------------------------------------------------------
    const meta: [string, string][] = [
      [s.metaLabels.org, data.org],
      [s.metaLabels.period, s.periodValue(data.dateStr)],
      [s.metaLabels.preparedBy, data.preparedBy],
      [s.metaLabels.issued, data.dateStr],
    ];
    doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(1).strokeColor(HAIR).stroke();
    y += 8;
    const mcw = CW / 4;
    meta.forEach((it, i) => {
      const x = M + i * mcw;
      doc.font('Times-Roman').fontSize(7.5).fillColor(MUT).text(uc(it[0]), x, y, { width: mcw - 6, characterSpacing: 0.6 });
      doc.font('Times-Roman').fontSize(10).fillColor(INK).text(it[1], x, y + 11, { width: mcw - 6 });
    });
    y += 38;
    doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(1).strokeColor(HAIR).stroke();
    y += 13;

    // declaration --------------------------------------------------------
    doc.font('Times-Roman').fontSize(10).fillColor(DECL).text(s.declare, M, y, { width: CW, align: 'justify' });
    y = doc.y + 8;

    // §1 summary ---------------------------------------------------------
    y = sec(1, s.s1, y);
    const kf: [string, string][] = [
      [String(data.kf.staff), s.kf.staff],
      [String(data.kf.trained), s.kf.trained],
      [data.kf.participation + '%', s.kf.participation],
      [String(data.kf.notTrained), s.kf.notTrained],
      [String(data.kf.refresher), s.kf.refresher],
    ];
    const kh = 42, kw = CW / kf.length;
    doc.rect(M, y, CW, kh).lineWidth(1).strokeColor(HAIR).stroke();
    kf.forEach((c, i) => {
      const x = M + i * kw;
      if (i > 0) doc.moveTo(x, y + 8).lineTo(x, y + kh - 8).lineWidth(0.5).strokeColor(SOFT).stroke();
      doc.font('Times-Bold').fontSize(17).fillColor(i === 2 ? NAVY : INK).text(c[0], x, y + 7, { width: kw, align: 'center' });
      doc.font('Times-Roman').fontSize(7.5).fillColor(MUT).text(uc(c[1]), x + 4, y + 28, { width: kw - 8, align: 'center', characterSpacing: 0.3 });
    });
    y += kh + 9;
    const sp = s.status(data.kf.participation + '%', data.target, data.belowN, data.deficiency);
    doc.font('Times-Roman').fontSize(10.5).fillColor(INK).text(sp.lead, M, y, { width: CW, continued: true });
    doc.font('Times-Bold').text(sp.pct, { continued: true });
    doc.font('Times-Roman').fillColor(INK).text(sp.mid, { continued: true });
    doc.font('Times-Bold').fillColor(sp.deficiency ? OX : INK).text(sp.action, { continued: true });
    doc.font('Times-Roman').fillColor(INK).text(sp.tail);
    y = doc.y + 10;

    // §2 coverage by department -----------------------------------------
    y = sec(2, s.s2, y);
    if (data.depts.length === 0) {
      y = emptyRow(s.emptyDepts, M, y);
    } else {
      const stColor = (r: DeptRow) => (r.status === 'ok' ? MUT : OX);
      y = ledger<DeptRow>(M, CW, [
        { label: s.d2[0], x: 0, w: 128, map: (r) => r.dept },
        { label: s.d2[1], x: 128, w: 42, align: 'right', map: (r) => String(r.staff) },
        { label: s.d2[2], x: 170, w: 50, align: 'right', map: (r) => String(r.trained) },
        { label: s.d2[3], x: 220, w: 84, align: 'right', map: (r) => r.pct + '%' },
        { label: s.d2[4], x: 316, w: 117, map: (r) => s.levelName[r.level] },
        { label: s.d2[5], x: 433, w: 70, align: 'right', bold: true, color: stColor, map: (r) => s.statusName[r.status] },
      ], data.depts, y);
      doc.font('Times-Italic').fontSize(8.5).fillColor(MUT).text(s.note2(data.target), M, y + 2, { width: CW });
      y = doc.y + 11;
    }

    // §3 course completion / §4 assessed literacy (side by side) --------
    const gap = 30, colW = (CW - gap) / 2, rx = M + colW + gap;
    const y3h = sec(3, s.s3, y, M, colW);
    const y3 = data.courses.length === 0
      ? emptyRow(s.emptyCourses, M, y3h)
      : ledger<CourseRow>(M, colW, [
          { label: s.d3[0], x: 0, w: 154, map: (r) => r.title },
          { label: s.d3[1], x: 154, w: colW - 154, align: 'right', map: (r) => r.pct + '%' },
        ], data.courses, y3h);
    const y4h = sec(4, s.s4, y, rx, colW);
    const y4 = ledger<LevelRow>(rx, colW, [
      { label: s.d4[0], x: 0, w: 112, map: (r) => s.levelName[r.key] },
      { label: s.d4[1], x: 112, w: 58, align: 'right', map: (r) => String(r.n) },
      { label: s.d4[2], x: 170, w: colW - 170, align: 'right', map: (r) => r.pct + '%' },
    ], data.levels, y4h);
    y = Math.max(y3, y4) + 13;

    // certification + signatures (guard against a stray page break) ------
    doc.page.margins.bottom = 0;
    doc.font('Times-Italic').fontSize(10).fillColor(DECL).text(s.cert, M, y, { width: CW });
    y = doc.y + 20;
    const sg = 30, sw = (CW - sg * 2) / 3;
    s.sig.forEach((cap, i) => {
      const x = M + i * (sw + sg);
      doc.moveTo(x, y).lineTo(x + sw, y).lineWidth(0.8).strokeColor(INK).stroke();
      doc.font('Times-Roman').fontSize(8).fillColor(MUT).text(uc(cap), x, y + 5, { width: sw, characterSpacing: 0.4 });
    });

    // footer(s) ----------------------------------------------------------
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;
      const fy = PAGE.h - 34;
      doc.moveTo(M, fy).lineTo(M + CW, fy).lineWidth(0.5).strokeColor(HAIR).stroke();
      doc.font('Times-Roman').fontSize(8).fillColor(MUT).text(uc(s.footL(data.org)), M, fy + 5, { width: CW * 0.55, characterSpacing: 0.4, lineBreak: false });
      doc.text(uc(s.footR(i + 1, range.count, data.ref)), M + CW * 0.45, fy + 5, { width: CW * 0.55, align: 'right', characterSpacing: 0.4, lineBreak: false });
    }

    doc.end();
  });
}
