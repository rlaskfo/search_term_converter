import { HEADER_ROW_INDEX } from "./rules.js";

function getXLSX() {
  const x = globalThis.XLSX;
  if (!x) throw new Error("SheetJS(XLSX) 스크립트가 로드되지 않았습니다.");
  return x;
}

function normalizeCell(v) {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function findTargets(rows) {
  if (rows.length <= HEADER_ROW_INDEX) {
    return {
      rows,
      searchColIndex: -1,
      dataStartRowIndex: HEADER_ROW_INDEX + 1,
      targets: [],
      error: "행 수가 부족합니다(4행 헤더 필요).",
    };
  }

  const headerRow = rows[HEADER_ROW_INDEX];
  let searchColIndex = -1;
  for (let c = 0; c < headerRow.length; c++) {
    if (headerRow[c] === "검색어") {
      searchColIndex = c;
      break;
    }
  }

  if (searchColIndex < 0) {
    return {
      rows,
      searchColIndex: -1,
      dataStartRowIndex: HEADER_ROW_INDEX + 1,
      targets: [],
      error: '4번째 행에서 "검색어" 열을 찾지 못했습니다.',
    };
  }

  const dataStart = HEADER_ROW_INDEX + 1;
  const targets = [];
  const last = Math.min(rows.length - 1, dataStart + 500 - 1);
  for (let r = dataStart; r <= last; r++) {
    targets.push({ rowIndex: r, value: rows[r][searchColIndex] ?? "" });
  }

  return { rows, searchColIndex, dataStartRowIndex: dataStart, targets };
}

export function parseWorkbookBuffer(buf) {
  const XLSX = getXLSX();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const name = wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  const ref = sheet["!ref"];
  if (!ref) {
    return {
      rows: [],
      searchColIndex: -1,
      dataStartRowIndex: HEADER_ROW_INDEX + 1,
      targets: [],
      error: "시트가 비어 있습니다.",
    };
  }

  const range = XLSX.utils.decode_range(ref);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      row.push(normalizeCell(cell?.v));
    }
    rows.push(row);
  }

  return findTargets(rows);
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if ((ch === "," && !q) || (ch === "\t" && !q)) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsvBuffer(buf) {
  const u8 = new Uint8Array(buf);
  let start = 0;
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) start = 3;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(u8.slice(start));

  const lines = text.split(/\r?\n/).filter((l, i, a) => !(i === a.length - 1 && l === ""));
  const rows = lines.map((line) => splitCsvLine(line));
  const maxCols = Math.max(0, ...rows.map((r) => r.length));
  for (const r of rows) {
    while (r.length < maxCols) r.push("");
  }

  return findTargets(rows);
}

export function parseUpload(name, buf) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return parseCsvBuffer(buf);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return parseWorkbookBuffer(buf);
  return {
    rows: [],
    searchColIndex: -1,
    dataStartRowIndex: HEADER_ROW_INDEX + 1,
    targets: [],
    error: "지원 형식: xls, xlsx, csv",
  };
}
