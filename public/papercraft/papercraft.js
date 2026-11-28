// Printable papercraft advent calendar generator (client-side friendly, ES module).
// Produces a PDF: page 1 = front sheet with 24 cut-and-fold doors,
// page 2 = photo sheet (glue behind page 1), page 3 = assembly instructions.
//
//   import { buildCalendarPdf } from "./papercraft.js";
//   const pdf = await buildCalendarPdf({ photos: [Uint8Array, ...], title: "Merry Christmas", theme: "hearth" });
//
// Photos are JPEG or PNG bytes (convert HEIC/WebP first, e.g. via canvas -> toBlob("image/jpeg")).
// Nothing is uploaded anywhere: runs entirely in the browser or in Node.

import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from "./vendor/pdf-lib.esm.min.js";

const MM = 72 / 25.4;
const PAPER = { a4: [210, 297], letter: [215.9, 279.4] };
const COLS = 4, ROWS = 6, DOORS = 24;

const hex = (h) => rgb(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255));

export const THEMES = {
  hearth:   { bg: "#F6EBDD", doors: ["#B3342E"], doorText: "#FFF8EE", ink: "#3A2A20", accent: "#2F5D3A", snow: "#FFFFFF", title: "#B3342E" },
  midnight: { bg: "#14213D", doors: ["#1F3A66"], doorText: "#FCD34D", ink: "#FCD34D", accent: "#FCD34D", snow: "#8FA3C7", title: "#FCD34D" },
  pop:      { bg: "#FFF4E0", doors: ["#FF4D6D", "#FFB703", "#06D6A0", "#4361EE"], doorText: "#111111", ink: "#111111", accent: "#111111", snow: "#FFFFFF", title: "#111111" },
};

// WinAnsi-safe text (standard PDF fonts throw on anything else, e.g. emoji).
const clean = (s = "") => String(s).replace(/[^\x20-\x7E]/g, "").trim().slice(0, 60);

// Small seeded PRNG so the door order is stable between front and back sheets.
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function doorOrder(shuffle, seed) {
  const days = Array.from({ length: DOORS }, (_, i) => i + 1);
  if (!shuffle) return days;
  const r = rng(seed);
  for (let i = days.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [days[i], days[j]] = [days[j], days[i]]; }
  return days; // days[cellIndex] = day number shown in that cell
}

async function embed(pdf, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xd8) return pdf.embedJpg(b);
  if (b[0] === 0x89 && b[1] === 0x50) return pdf.embedPng(b);
  throw new Error("Photos must be JPEG or PNG");
}

function starPath(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    pts.push([cx + rr * Math.cos(a), cy - rr * Math.sin(a)]); // svg path y is flipped by drawSvgPath
  }
  return "M" + pts.map((p) => p.map((n) => n.toFixed(2)).join(",")).join("L") + "Z";
}

function geometry(size) {
  const [W, H] = PAPER[size] || PAPER.a4;
  const margin = 10, header = 36, footer = 14;
  const cw = (W - 2 * margin) / COLS, ch = (H - margin - header - footer - margin) / ROWS;
  const pad = 2.5;
  return { W, H, margin, header, footer, cw, ch, pad };
}

// bottom-left of a cell in pt (PDF origin bottom-left)
function cellRect(g, idx) {
  const col = idx % COLS, row = Math.floor(idx / COLS);
  const x = (g.margin + col * g.cw) * MM;
  const yTop = (g.margin + g.header + row * g.ch) * MM;
  return { x, y: (g.H * MM) - yTop - g.ch * MM, w: g.cw * MM, h: g.ch * MM };
}

function marks(page, g, color) {
  const L = 4 * MM, o = 3 * MM, W = g.W * MM, H = g.H * MM;
  for (const [x, y] of [[o, o], [W - o, o], [o, H - o], [W - o, H - o]]) {
    page.drawLine({ start: { x: x - L / 2, y }, end: { x: x + L / 2, y }, thickness: 0.5, color });
    page.drawLine({ start: { x, y: y - L / 2 }, end: { x, y: y + L / 2 }, thickness: 0.5, color });
  }
}

export async function buildCalendarPdf({
  photos = [], title = "Merry Christmas", subtitle = "", theme = "hearth",
  paper = "a4", shuffle = true, seed = 2026, fillMessage = "Merry Christmas",
} = {}) {
  const T = THEMES[theme] || THEMES.hearth;
  const g = geometry(paper);
  const order = doorOrder(shuffle, seed);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${clean(title) || "Advent calendar"} - printable advent calendar`);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const W = g.W * MM, H = g.H * MM;
  const ink = hex(T.ink);
  const centered = (page, text, font, size, y, color) =>
    page.drawText(text, { x: (W - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });

  // ---------- Page 1: front with doors ----------
  const front = pdf.addPage([W, H]);
  front.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hex(T.bg) });
  const r = rng(seed + 7);
  for (let i = 0; i < 60; i++) front.drawCircle({ x: r() * W, y: r() * H, size: 0.6 + r() * 1.4, color: hex(T.snow), opacity: 0.7 });
  const t = clean(title) || "Merry Christmas";
  let ts = 34; while (bold.widthOfTextAtSize(t, ts) > W - 30 * MM && ts > 12) ts -= 1;
  centered(front, t, bold, ts, H - (g.margin + 17) * MM, hex(T.title));
  const sub = clean(subtitle) || "24 days to Christmas";
  centered(front, sub, reg, 12, H - (g.margin + 26) * MM, ink);

  for (let i = 0; i < DOORS; i++) {
    const c = cellRect(g, i), p = g.pad * MM;
    const d = { x: c.x + p, y: c.y + p, w: c.w - 2 * p, h: c.h - 2 * p };
    const fill = hex(T.doors[i % T.doors.length]);
    front.drawRectangle({ x: d.x, y: d.y, width: d.w, height: d.h, color: fill });
    front.drawRectangle({ x: d.x + 1.8 * MM, y: d.y + 1.8 * MM, width: d.w - 3.6 * MM, height: d.h - 3.6 * MM,
      borderColor: hex(T.doorText), borderWidth: 0.6, opacity: 0, borderOpacity: 0.7 });
    const num = String(order[i]);
    const ns = num.length > 1 ? 26 : 30;
    front.drawText(num, { x: d.x + (d.w - bold.widthOfTextAtSize(num, ns)) / 2, y: d.y + d.h / 2 - ns * 0.35, size: ns, font: bold, color: hex(T.doorText) });
    front.drawSvgPath(starPath(0, 0, 2.6 * MM), { x: d.x + d.w / 2, y: d.y + d.h - 5.5 * MM, color: hex(T.doorText), borderWidth: 0 });
    // cut: top, right, bottom (solid)  |  fold: left hinge (dashed)
    const cut = { thickness: 0.7, color: ink };
    front.drawLine({ start: { x: d.x, y: d.y + d.h }, end: { x: d.x + d.w, y: d.y + d.h }, ...cut });
    front.drawLine({ start: { x: d.x + d.w, y: d.y + d.h }, end: { x: d.x + d.w, y: d.y }, ...cut });
    front.drawLine({ start: { x: d.x + d.w, y: d.y }, end: { x: d.x, y: d.y }, ...cut });
    front.drawLine({ start: { x: d.x, y: d.y + d.h }, end: { x: d.x, y: d.y }, thickness: 0.7, color: ink, dashArray: [3, 2.5] });
  }
  centered(front, "Solid line = cut      Dashed line = fold      Cut 3 sides of each door, fold open from the left", reg, 8,
    (g.margin + 4) * MM + 4, ink);
  marks(front, g, ink);

  // ---------- Page 2: photo sheet ----------
  const back = pdf.addPage([W, H]);
  back.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  const imgs = [];
  for (let day = 1; day <= DOORS; day++) imgs[day] = photos[day - 1] ? await embed(pdf, photos[day - 1]) : null;
  const fm = clean(fillMessage) || "Merry Christmas";
  for (let i = 0; i < DOORS; i++) {
    const c = cellRect(g, i), day = order[i], img = imgs[day];
    back.pushOperators(pushGraphicsState(), rectangle(c.x, c.y, c.w, c.h), clip(), endPath());
    if (img) {
      const s = Math.max(c.w / img.width, c.h / img.height); // cover
      const w = img.width * s, h = img.height * s;
      back.drawImage(img, { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, width: w, height: h });
    } else {
      back.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: hex(T.bg) });
      const fs = 9;
      back.drawText(fm, { x: c.x + (c.w - bold.widthOfTextAtSize(fm, fs)) / 2, y: c.y + c.h / 2 - 3, size: fs, font: bold, color: hex(T.title) });
    }
    back.pushOperators(popGraphicsState());
    // day label in the cell corner, outside the visible door window
    back.drawText(`Day ${day}`, { x: c.x + 1 * MM, y: c.y + 0.9 * MM, size: 5.5, font: reg, color: rgb(1, 1, 1), opacity: 0.9 });
  }
  back.drawText("PHOTO SHEET - glue behind the front sheet, lining up the corner marks", { x: g.margin * MM, y: (g.margin + 5) * MM, size: 8, font: bold, color: rgb(0.2, 0.2, 0.2) });
  marks(back, g, rgb(0, 0, 0));

  // ---------- Page 3: instructions ----------
  const how = pdf.addPage([W, H]);
  how.drawText("How to make your advent calendar", { x: g.margin * MM, y: H - 25 * MM, size: 22, font: bold, color: ink });
  const steps = [
    "You need: scissors or a craft knife, a ruler, glue stick, and card or thick paper (160-250gsm) if you have it.",
    "1. Print pages 1 and 2 at 100% / 'Actual size' (not 'Fit to page'). Page 1 is the front, page 2 is the photo sheet.",
    "2. Cut along the SOLID lines on each door: top, right and bottom. Leave the left edge attached.",
    "3. Fold each door open along the DASHED left edge. Crease it firmly with a ruler.",
    "4. Put a thin line of glue around the outer edge of page 2 (the photo sheet) and between the photos, away from the doors.",
    "5. Lay page 1 on top, matching the four corner marks, and press flat. Each door now hides its photo.",
    "6. Stick the finished sheet to a piece of card, then stand it up or hang it on the wall.",
    "Open door 1 on 1 December, door 2 on the 2nd, and so on. Photos are labelled with their day on the back sheet.",
  ];
  let y = H - 40 * MM;
  for (const s of steps) {
    const words = s.split(" "); let line = "";
    for (const w of words) {
      if (reg.widthOfTextAtSize(line + w, 11) > W - 2 * g.margin * MM) { how.drawText(line, { x: g.margin * MM, y, size: 11, font: reg, color: ink }); y -= 15; line = ""; }
      line += w + " ";
    }
    how.drawText(line, { x: g.margin * MM, y, size: 11, font: reg, color: ink }); y -= 22;
  }
  return pdf.save();
}

// Browser helper: File -> downscaled JPEG bytes (keeps the PDF small, converts HEIC/WebP where the browser can decode them).
export async function fileToJpegBytes(file, maxPx = 900) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const cv = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await cv.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return new Uint8Array(await blob.arrayBuffer());
}
