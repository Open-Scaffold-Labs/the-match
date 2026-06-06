// Shared "The Match" brand kit — mirrors the Investment Brief look.
const {
  Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, LevelFormat,
  BorderStyle, WidthType, ShadingType, Header, Footer, PageNumber,
} = require("docx");

// ---- palette ----
const C = {
  CREAM: "F6F1E6",
  GREEN: "16402A",     // Didot display headings
  GREEN2: "1C5234",
  GOLD: "A8863C",      // rules / accents
  GOLDTX: "957526",    // eyebrow text (legible on cream)
  BODY: "2B2A26",
  MUTED: "8C7A45",     // header/footer
};
const SERIF = "Didot";
const SANS = "Helvetica Neue";
const CONTENT_W = 9180; // letter, ~1.1in margins (12240 - 2*1530)

const T = (text, opts = {}) => new TextRun({ text, font: SANS, color: C.BODY, ...opts });

// small-caps, letter-spaced gold eyebrow
const eyebrow = (text, opts = {}) =>
  new Paragraph({
    spacing: { before: 40, after: 120 },
    children: [new TextRun({ text, font: SANS, color: C.GOLDTX, bold: true,
      size: 17, allCaps: true, characterSpacing: 60, ...opts })],
  });

// big Didot display heading in forest green
const display = (text, { size = 60, after = 60, align } = {}) =>
  new Paragraph({
    alignment: align,
    spacing: { after, line: 260 },
    children: [new TextRun({ text, font: SERIF, color: C.GREEN, size })],
  });

// short gold rule (paragraph bottom border, shortened via right indent)
const shortRule = () =>
  new Paragraph({
    spacing: { before: 60, after: 200 },
    indent: { right: CONTENT_W - 1020 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 14, color: C.GOLD, space: 1 } },
    children: [new TextRun({ text: "", size: 2 })],
  });

const hairline = (before = 200, after = 200) =>
  new Paragraph({
    spacing: { before, after },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.GOLD, space: 1 } },
    children: [new TextRun({ text: "", size: 2 })],
  });

// section header block: eyebrow + display + short rule
const section = (eyebrowText, titleLines, sizeOverride) => {
  const out = [eyebrow(eyebrowText)];
  const lines = Array.isArray(titleLines) ? titleLines : [titleLines];
  lines.forEach((l, i) =>
    out.push(display(l, { size: sizeOverride || 46, after: i === lines.length - 1 ? 40 : 0 })));
  out.push(shortRule());
  return out;
};

const subhead = (text) =>
  new Paragraph({ spacing: { before: 160, after: 70 },
    children: [new TextRun({ text, font: SERIF, color: C.GREEN2, size: 26 })] });

const body = (runs, opts = {}) =>
  new Paragraph({ spacing: { after: 130, line: 286 },
    children: (Array.isArray(runs) ? runs : [T(runs)]), ...opts });

// lede paragraph (slightly larger)
const lede = (runs) =>
  new Paragraph({ spacing: { after: 150, line: 300 },
    children: (Array.isArray(runs) ? runs.map(r => r) : [T(runs, { size: 24 })]) });

const bullet = (runs) =>
  new Paragraph({ numbering: { reference: "b", level: 0 }, spacing: { after: 70, line: 282 },
    children: Array.isArray(runs) ? runs : [T(runs)] });

const numbered = (runs) =>
  new Paragraph({ numbering: { reference: "n", level: 0 }, spacing: { after: 70, line: 282 },
    children: Array.isArray(runs) ? runs : [T(runs)] });

// italic Didot pull quote bracketed by hairline rules
const pullQuote = (text) => [
  hairline(220, 160),
  new Paragraph({ spacing: { after: 160, line: 320 }, indent: { left: 360, right: 360 },
    children: [
      new TextRun({ text: "“", font: SERIF, color: C.GOLD, size: 40, italics: true }),
      new TextRun({ text, font: SERIF, color: C.GREEN, size: 30, italics: true }),
      new TextRun({ text: "”", font: SERIF, color: C.GOLD, size: 40, italics: true }),
    ] }),
  hairline(40, 220),
];

// stat strip: array of {n, label}
function statStrip(stats) {
  const w = Math.floor(CONTENT_W / stats.length);
  const widths = stats.map(() => w);
  const cell = (s) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 0, right: 160 },
      borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
      children: [
        new Paragraph({ spacing: { after: 30 },
          children: [new TextRun({ text: s.n, font: SANS, bold: true, color: C.GREEN, size: 40 })] }),
        new Paragraph({ children: (Array.isArray(s.label) ? s.label : [s.label]).map((ln) =>
          new TextRun({ text: ln, font: SANS, color: C.GOLDTX, bold: true, size: 14,
            allCaps: true, characterSpacing: 40, break: ln === s.label ? 0 : 1 })) }),
      ],
    });
  // handle multi-line labels properly
  const rows = [new TableRow({ children: stats.map((s) => {
    const labelLines = Array.isArray(s.label) ? s.label : [s.label];
    return new TableCell({
      width: { size: w, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 0, right: 160 },
      borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.SINGLE, size: 4, color: C.GOLD }, right: { style: BorderStyle.NONE } },
      children: [
        new Paragraph({ spacing: { after: 30 }, indent: { left: 140 },
          children: [new TextRun({ text: s.n, font: SANS, bold: true, color: C.GREEN, size: 40 })] }),
        new Paragraph({ indent: { left: 140 }, children: labelLines.map((ln, i) =>
          new TextRun({ text: ln, font: SANS, color: C.GOLDTX, bold: true, size: 14,
            allCaps: true, characterSpacing: 40, break: i ? 1 : 0 })) }),
      ],
    });
  }) })];
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, rows });
}

// two-column "at a glance" style block: array of {label, value}
function glanceList(items) {
  return items.flatMap((it) => [
    new Paragraph({ spacing: { before: 130, after: 20 },
      children: [new TextRun({ text: it.label, font: SANS, bold: true, color: C.GOLDTX,
        size: 15, allCaps: true, characterSpacing: 40 })] }),
    new Paragraph({ spacing: { after: 20 },
      children: [new TextRun({ text: it.value, font: SERIF, color: C.GREEN2, size: 24 })] }),
  ]);
}

// hairline refined table (no heavy fills) — headers gold small-caps with gold bottom rule
function table(headers, rows, widths) {
  const goldB = { style: BorderStyle.SINGLE, size: 12, color: C.GOLD };
  const thinB = { style: BorderStyle.SINGLE, size: 2, color: "D8CDA8" };
  const hcell = (txt, w) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    margins: { top: 70, bottom: 80, left: 0, right: 140 },
    borders: { top: { style: BorderStyle.NONE }, bottom: goldB,
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
    children: [new Paragraph({ children: [new TextRun({ text: txt, font: SANS, bold: true,
      color: C.GOLDTX, size: 15, allCaps: true, characterSpacing: 40 })] })],
  });
  const bcell = (txt, w, bold) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 0, right: 140 },
    borders: { top: { style: BorderStyle.NONE }, bottom: thinB,
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
    children: [new Paragraph({ spacing: { line: 270 }, children: [new TextRun({ text: txt,
      font: SANS, color: bold ? C.GREEN2 : C.BODY, bold: !!bold, size: 19 })] })],
  });
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => hcell(h, widths[i])) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => bcell(c, widths[i], i === 0)) })),
    ],
  });
}

// two-column feature grid: items {title, idx, body}
function featureGrid(items) {
  const colW = Math.floor(CONTENT_W / 2);
  const gap = 320;
  const cellW = colW - gap / 2;
  const goldTop = { style: BorderStyle.SINGLE, size: 10, color: C.GOLD };
  const none = { style: BorderStyle.NONE };
  const featCell = (it, w) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    margins: { top: 90, bottom: 160, left: 0, right: 200 },
    borders: { top: goldTop, bottom: none, left: none, right: none },
    children: [
      new Paragraph({ spacing: { after: 50 },
        children: [
          new TextRun({ text: it.title, font: SERIF, color: C.GREEN, size: 22 }),
        ] }),
      new Paragraph({ spacing: { after: 40 },
        children: [new TextRun({ text: it.idx, font: SANS, bold: true, color: C.GOLDTX,
          size: 13, allCaps: true, characterSpacing: 30 })] }),
      new Paragraph({ spacing: { line: 272 },
        children: [new TextRun({ text: it.body, font: SANS, color: C.BODY, size: 18 })] }),
    ],
  });
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = featCell(items[i], cellW);
    const right = items[i + 1]
      ? featCell(items[i + 1], cellW)
      : new TableCell({ width: { size: cellW, type: WidthType.DXA },
          borders: { top: none, bottom: none, left: none, right: none }, children: [new Paragraph("")] });
    const spacer = new TableCell({ width: { size: gap, type: WidthType.DXA },
      borders: { top: none, bottom: none, left: none, right: none }, children: [new Paragraph("")] });
    rows.push(new TableRow({ children: [left, spacer, right] }));
  }
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [cellW, gap, cellW], rows });
}

const runHeader = (rightLabel) =>
  new Header({ children: [ new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D8CDA8", space: 6 } },
    tabStops: [{ type: "right", position: CONTENT_W }],
    children: [
      new TextRun({ text: "THE MATCH · SOCIAL MEDIA STRATEGY", font: SANS, color: C.MUTED,
        size: 14, allCaps: true, characterSpacing: 40 }),
      new TextRun({ text: "\t" + rightLabel, font: SANS, color: C.MUTED, size: 14,
        allCaps: true, characterSpacing: 40 }),
    ] }) ] });

const runFooter = () =>
  new Footer({ children: [ new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: "D8CDA8", space: 6 } },
    tabStops: [{ type: "right", position: CONTENT_W }],
    children: [
      new TextRun({ text: "THE MATCH · 2026", font: SANS, color: C.MUTED, size: 14,
        allCaps: true, characterSpacing: 40 }),
      new TextRun({ text: "\t", font: SANS }),
      new TextRun({ children: [PageNumber.CURRENT], font: SANS, color: C.MUTED, size: 14 }),
    ] }) ] });

const numbering = {
  config: [
    { reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "—",
      alignment: AlignmentType.LEFT, style: { run: { color: C.GOLD },
        paragraph: { indent: { left: 460, hanging: 280 } } } }] },
    { reference: "n", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.",
      alignment: AlignmentType.LEFT, style: { run: { color: C.GOLDTX, bold: true },
        paragraph: { indent: { left: 460, hanging: 300 } } } }] },
  ],
};

module.exports = {
  C, SERIF, SANS, CONTENT_W, T, eyebrow, display, shortRule, hairline, section,
  subhead, body, lede, bullet, numbered, pullQuote, statStrip, glanceList, table,
  featureGrid, runHeader, runFooter, numbering,
};
