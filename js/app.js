import { HEADER_ROW_INDEX } from "./rules.js";
import { parseUpload } from "./parseFile.js";
import { buildExportSheet, writeXlsxBinary, downloadArrayBuffer } from "./exportTable.js";
import { analyzeKeyword } from "./gpt.js";

const LS_KEY = "sc_openai_key";
const LS_BASE = "sc_api_base";
const LS_MODEL = "sc_openai_model";
const LS_REMEMBER = "sc_remember_key";

/** @type {{ rows: string[][]; targets: { rowIndex: number; value: string }[]; error?: string } | null} */
let parsed = null;
/** @type {Map<number, { suggested: string; reason: string }>} */
const resultsByRow = new Map();
let batchIndex = 0;
let batchRunning = false;
let pauseFlag = false;
let abortFlag = false;

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 없음`);
  return el;
};

function loadSettings() {
  try {
    const remember = localStorage.getItem(LS_REMEMBER) === "1";
    $("rememberKey").checked = remember;
    if (remember) {
      $("apiKey").value = localStorage.getItem(LS_KEY) || "";
      $("apiBase").value = localStorage.getItem(LS_BASE) || "https://api.openai.com/v1";
      $("apiModel").value = localStorage.getItem(LS_MODEL) || "gpt-4o-mini";
    } else {
      $("apiBase").value = "https://api.openai.com/v1";
      $("apiModel").value = "gpt-4o-mini";
    }
  } catch {
    $("apiBase").value = "https://api.openai.com/v1";
  }
}

function saveSettings() {
  try {
    if ($("rememberKey").checked) {
      localStorage.setItem(LS_REMEMBER, "1");
      localStorage.setItem(LS_KEY, $("apiKey").value.trim());
      localStorage.setItem(LS_BASE, $("apiBase").value.trim() || "https://api.openai.com/v1");
      localStorage.setItem(LS_MODEL, $("apiModel").value.trim() || "gpt-4o-mini");
    } else {
      localStorage.removeItem(LS_REMEMBER);
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_BASE);
      localStorage.removeItem(LS_MODEL);
    }
  } catch {
    /* ignore */
  }
}

function getApiOpts() {
  return {
    apiKey: $("apiKey").value.trim(),
    baseUrl: $("apiBase").value.trim() || "https://api.openai.com/v1",
    model: $("apiModel").value.trim() || "gpt-4o-mini",
  };
}

function renderSingleTable(result) {
  const wrap = $("singleResult");
  wrap.classList.remove("hidden");
  wrap.innerHTML = `
    <table class="result">
      <thead><tr><th>원본</th><th>제안 검색어</th><th>사유</th></tr></thead>
      <tbody>
        <tr>
          <td>${escapeHtml(result.original)}</td>
          <td>${escapeHtml(result.suggested || "—")}</td>
          <td>${escapeHtml(result.reason)}</td>
        </tr>
      </tbody>
    </table>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function onSingle() {
  const kw = $("singleKeyword").value.trim();
  if (!kw) return;
  $("btnSingle").disabled = true;
  $("singleResult").classList.add("hidden");
  try {
    saveSettings();
    const r = await analyzeKeyword(kw, getApiOpts());
    renderSingleTable(r);
  } catch (e) {
    renderSingleTable({
      original: kw,
      suggested: "",
      reason: e instanceof Error ? e.message : "요청 실패",
    });
  } finally {
    $("btnSingle").disabled = false;
  }
}

function showParseError(msg) {
  const el = $("parseError");
  if (msg) {
    el.textContent = msg;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function renderPreview() {
  if (!parsed?.rows.length) return;
  const start = HEADER_ROW_INDEX;
  const end = Math.min(parsed.rows.length - 1, start + 8);
  const slice = [];
  for (let i = start; i <= end; i++) slice.push(parsed.rows[i]);
  $("preview").innerHTML =
    `<table class="result"><tbody>` +
    slice
      .map(
        (row) =>
          `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`
      )
      .join("") +
    `</tbody></table>`;
}

function renderBatchTable() {
  if (!parsed?.targets.length) return;
  const wrap = $("batchPreview");
  wrap.classList.remove("hidden");
  const rows = parsed.targets.slice(0, 30).map((t) => {
    const r = resultsByRow.get(t.rowIndex);
    return `<tr>
      <td>${t.rowIndex + 1}</td>
      <td>${escapeHtml(t.value)}</td>
      <td>${escapeHtml(r?.suggested ?? "—")}</td>
      <td>${escapeHtml(r?.reason ?? "—")}</td>
    </tr>`;
  });
  wrap.innerHTML = `
    <h3 class="small" style="margin:0 0 8px">결과 미리보기 (최대 30행)</h3>
    <table class="result">
      <thead><tr><th>행</th><th>검색어</th><th>제안 검색어</th><th>사유</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
}

function updateBatchMeta() {
  const total = parsed?.targets.length ?? 0;
  const pct = total === 0 ? 0 : Math.round((batchIndex / total) * 100);
  $("batchMeta").textContent = `대상 ${total}건 · 진행 ${batchIndex}/${total} (${pct}%)`;
}

async function onFileChange(ev) {
  const f = ev.target.files?.[0];
  showParseError("");
  parsed = null;
  resultsByRow.clear();
  batchIndex = 0;
  $("batchControls").classList.add("hidden");
  $("batchPreview").classList.add("hidden");
  if (!f) return;

  try {
    const buf = await f.arrayBuffer();
    const p = parseUpload(f.name, buf);
    if (p.error) {
      showParseError(p.error);
      return;
    }
    parsed = p;
    $("batchControls").classList.remove("hidden");
    updateBatchMeta();
    renderPreview();
    renderBatchTable();
  } catch (e) {
    showParseError(e instanceof Error ? e.message : String(e));
  }
}

async function runBatch() {
  if (!parsed?.targets.length) return;
  pauseFlag = false;
  abortFlag = false;
  batchRunning = true;
  $("btnBatchStart").disabled = true;
  $("btnPause").disabled = false;
  $("btnAbort").disabled = false;

  let idx = batchIndex;
  const opts = getApiOpts();

  try {
    while (idx < parsed.targets.length) {
      if (abortFlag) break;
      while (pauseFlag) {
        await new Promise((r) => setTimeout(r, 200));
        if (abortFlag) break;
      }
      if (abortFlag) break;

      const t = parsed.targets[idx];
      if (!t.value.trim()) {
        resultsByRow.set(t.rowIndex, { suggested: "", reason: "SKIP(빈 검색어)" });
      } else {
        saveSettings();
        const r = await analyzeKeyword(t.value, opts);
        resultsByRow.set(t.rowIndex, { suggested: r.suggested, reason: r.reason });
      }
      idx += 1;
      batchIndex = idx;
      updateBatchMeta();
      renderBatchTable();
    }
  } finally {
    batchRunning = false;
    $("btnBatchStart").disabled = false;
    $("btnPause").disabled = true;
    $("btnAbort").disabled = true;
  }
}

function pauseBatch() {
  pauseFlag = true;
}

function resumeBatch() {
  pauseFlag = false;
  if (!batchRunning && parsed?.targets.length && batchIndex < parsed.targets.length) {
    void runBatch();
  }
}

function abortBatch() {
  abortFlag = true;
  pauseFlag = false;
}

function resetBatch() {
  abortFlag = true;
  pauseFlag = false;
  batchIndex = 0;
  resultsByRow.clear();
  batchRunning = false;
  updateBatchMeta();
  renderBatchTable();
  $("btnBatchStart").disabled = false;
  $("btnPause").disabled = true;
}

function onDownload() {
  if (!parsed?.rows.length) return;
  const grid = buildExportSheet(parsed.rows, resultsByRow);
  const buf = writeXlsxBinary(grid, "결과");
  const name = `search_result_${new Date().toISOString().slice(0, 10)}.xlsx`;
  downloadArrayBuffer(buf, name);
}

function bind() {
  $("btnSingle").addEventListener("click", () => void onSingle());
  $("singleKeyword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") void onSingle();
  });

  $("fileInput").addEventListener("change", (e) => void onFileChange(e));
  $("btnBatchStart").addEventListener("click", () => {
    if (!batchRunning) void runBatch();
  });
  $("btnPause").addEventListener("click", pauseBatch);
  $("btnResume").addEventListener("click", resumeBatch);
  $("btnAbort").addEventListener("click", abortBatch);
  $("btnReset").addEventListener("click", resetBatch);
  $("btnDownload").addEventListener("click", onDownload);

  ["apiKey", "apiBase", "apiModel"].forEach((id) => {
    $(id).addEventListener("change", saveSettings);
  });
  $("rememberKey").addEventListener("change", saveSettings);
}

loadSettings();
bind();
