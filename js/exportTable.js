import { HEADER_ROW_INDEX } from "./rules.js";

function getXLSX() {
  const x = globalThis.XLSX;
  if (!x) throw new Error("SheetJS(XLSX) 스크립트가 로드되지 않았습니다.");
  return x;
}

export function buildExportSheet(rows, resultByRow) {
  const out = rows.map((r) => [...r]);
  const maxCol = Math.max(0, ...out.map((r) => r.length));
  const sugCol = maxCol;
  const reasonCol = maxCol + 1;
  for (const r of out) {
    while (r.length < maxCol) r.push("");
  }
  if (out.length === 0) return [["제안 검색어", "사유"]];

  const headerRowIndex = HEADER_ROW_INDEX;
  for (let r = 0; r < out.length; r++) {
    while (out[r].length <= reasonCol) out[r].push("");
  }
  out[headerRowIndex][sugCol] = "제안 검색어";
  out[headerRowIndex][reasonCol] = "사유";

  resultByRow.forEach((v, rowIdx) => {
    if (rowIdx < 0 || rowIdx >= out.length) return;
    out[rowIdx][sugCol] = v.suggested;
    out[rowIdx][reasonCol] = v.reason;
  });
  return out;
}

export function writeXlsxBinary(data, sheetName = "결과") {
  const XLSX = getXLSX();
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, sheetName.slice(0, 31));
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

export function downloadArrayBuffer(buf, filename) {
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
