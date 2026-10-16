import "./style.css";
import { takePhoto } from "./camera";
import { analyze, demoAnalysis, DEFAULT_MODEL, PROXY_URL, type AnalyzeInput, type GeminiSettings } from "./gemini";
import { Overlay } from "./overlay";
import type { Analysis, PlayLog } from "./types";

// ---------- DOM ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const startEl = $("start");
const boardEl = $("board");
const canvas = $<HTMLCanvasElement>("canvas");
const loadingEl = $("loading");
const loadingText = $("loadingText");
const preAnalyze = $("preAnalyze");
const resultEl = $("result");
const errorEl = $("error");
const reanalyzeBtn = $<HTMLButtonElement>("reanalyzeBtn");
const nextMoveBtn = $<HTMLButtonElement>("nextMoveBtn");
const fbNote = $<HTMLTextAreaElement>("fbNote");
const settingsDlg = $<HTMLDialogElement>("settings");

const overlay = new Overlay(canvas);
const isDemo = new URLSearchParams(location.search).has("demo");

// ---------- 状態 ----------
let photo: { base64: string; mime: string } | null = null;
let analysis: Analysis | null = null;
let step = 0;
let logs: PlayLog[] = [];
let selectedResult: string | null = null;
let photoRetaken = false;

// ---------- 設定（ブラウザ内に保存） ----------
function loadSettings(): GeminiSettings {
  try {
    return {
      apiKey: localStorage.getItem("ct.apiKey") ?? "",
      model: localStorage.getItem("ct.model") ?? DEFAULT_MODEL,
    };
  } catch {
    return { apiKey: "", model: DEFAULT_MODEL };
  }
}
function saveSettings(s: GeminiSettings) {
  try {
    localStorage.setItem("ct.apiKey", s.apiKey);
    localStorage.setItem("ct.model", s.model);
  } catch {
    /* プライベートモードなどでは保存できない */
  }
}
let settings = loadSettings();

function openSettings() {
  $("keyFields").hidden = Boolean(PROXY_URL);
  $<HTMLInputElement>("apiKey").value = settings.apiKey;
  $<HTMLInputElement>("model").value = settings.model;
  settingsDlg.showModal();
}
$("settingsBtn").addEventListener("click", openSettings);

const tipsDlg = $<HTMLDialogElement>("tipsDlg");
$("tipsBtn").addEventListener("click", () => tipsDlg.showModal());
// 枠の外（背景）をタップしても閉じる
tipsDlg.addEventListener("click", (e) => {
  if (e.target === tipsDlg) tipsDlg.close();
});
settingsDlg.addEventListener("close", () => {
  if (settingsDlg.returnValue !== "save") return;
  settings = {
    apiKey: $<HTMLInputElement>("apiKey").value.trim(),
    model: $<HTMLInputElement>("model").value.trim() || DEFAULT_MODEL,
  };
  saveSettings(settings);
});

// ---------- 写真の読み込み（送る前に縮小して通信量を節約） ----------
async function readPhoto(file: Blob): Promise<{ base64: string; mime: string; img: HTMLImageElement }> {
  const url = URL.createObjectURL(file);
  try {
    const src = await loadImage(url);
    const max = 1280;
    const r = Math.min(1, max / Math.max(src.naturalWidth, src.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(src.naturalWidth * r);
    c.height = Math.round(src.naturalHeight * r);
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.85);
    const img = await loadImage(dataUrl);
    return { base64: dataUrl.split(",")[1], mime: "image/jpeg", img };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("写真を読み込めませんでした"));
    img.src = src;
  });
}

async function onPhoto(file: Blob | null | undefined, keepContext: boolean) {
  if (!file) return;
  hideError();
  try {
    const p = await readPhoto(file);
    photo = { base64: p.base64, mime: p.mime };
    startEl.hidden = true;
    boardEl.hidden = false;
    overlay.setImage(p.img);
    if (keepContext && analysis) {
      // プレイ後の撮り直し：前回の作戦と結果は覚えたまま、印だけ消す
      photoRetaken = true;
      overlay.setAnalysis(null);
      nextMoveBtn.disabled = false;
      nextMoveBtn.textContent = selectedResult ? "次の手を考える" : "この写真で次の手を考える";
    } else {
      resetAll();
    }
  } catch (e) {
    showError((e as Error).message);
  }
}

// アプリ内カメラで撮る。使えないときだけ端末標準の撮影画面に任せる
async function capture(keepContext: boolean, fallbackInput: string) {
  const result = await takePhoto();
  if (result === "unavailable") {
    $<HTMLInputElement>(fallbackInput).click();
    return;
  }
  onPhoto(result, keepContext);
}
$("cameraBtn").addEventListener("click", () => capture(false, "cameraInput"));
$("retakeBtn").addEventListener("click", () => capture(true, "retakeInput"));

$<HTMLInputElement>("cameraInput").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  onPhoto(input.files?.[0], false);
  input.value = "";
});
$<HTMLInputElement>("retakeInput").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  onPhoto(input.files?.[0], true);
  input.value = "";
});

function resetAll() {
  analysis = null;
  logs = [];
  selectedResult = null;
  photoRetaken = false;
  overlay.setAnalysis(null);
  preAnalyze.hidden = false;
  resultEl.hidden = true;
  reanalyzeBtn.hidden = true;
  clearFeedback();
}

function backToStart() {
  photo = null;
  resetAll();
  boardEl.hidden = true;
  startEl.hidden = false;
  window.scrollTo({ top: 0 });
}
$("resetBtn").addEventListener("click", backToStart);
$("newBtn").addEventListener("click", backToStart);

// ---------- 解析 ----------
const LOADING_LINES = ["台を観察中…", "落とし口を探しています…", "アームの角度を計算中…", "作戦会議中…"];

async function run(hints?: AnalyzeInput["hints"]) {
  if (!photo) return;
  if (!PROXY_URL && !isDemo && !settings.apiKey) {
    openSettings();
    return;
  }
  hideError();
  loadingEl.hidden = false;
  let i = 0;
  loadingText.textContent = LOADING_LINES[0];
  const timer = setInterval(() => {
    i = (i + 1) % LOADING_LINES.length;
    loadingText.textContent = LOADING_LINES[i];
  }, 1600);

  try {
    const a = isDemo
      ? await new Promise<Analysis>((r) => setTimeout(() => r(demoAnalysis()), 900))
      : await analyze({ imageBase64: photo.base64, mimeType: photo.mime, hints }, settings, (msg) => {
          clearInterval(timer);
          loadingText.textContent = msg;
        });
    analysis = a;
    step = 0;
    photoRetaken = false;
    overlay.setAnalysis(a);
    renderResult();
    preAnalyze.hidden = true;
    resultEl.hidden = false;
    reanalyzeBtn.hidden = true;
    canvas.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    showError((e as Error).message);
  } finally {
    clearInterval(timer);
    loadingEl.hidden = true;
  }
}

$("analyzeBtn").addEventListener("click", () => run());

overlay.onEdit = () => {
  reanalyzeBtn.hidden = false;
};

reanalyzeBtn.addEventListener("click", () => {
  if (!analysis) return;
  run({ prize: analysis.prize.box, hole: analysis.hole.box, previous: analysis, logs });
});

// ---------- 結果の表示 ----------
const CONF_LABEL = { low: "自信：低め", medium: "自信：ふつう", high: "自信：高め" } as const;

function renderResult() {
  if (!analysis) return;
  $("setupChip").textContent = analysis.setup;
  $("clawChip").textContent = analysis.claw;
  const conf = $("confChip");
  conf.textContent = CONF_LABEL[analysis.confidence];
  conf.className = `chip conf-${analysis.confidence}`;

  const list = $("cautionList");
  list.replaceChildren(
    ...analysis.cautions.map((c) => {
      const li = document.createElement("li");
      li.textContent = c;
      return li;
    }),
  );
  renderStep();
}

function renderStep() {
  if (!analysis) return;
  const steps = analysis.steps;
  const s = steps[step];
  const dots = $("stepDots");
  dots.replaceChildren(
    ...steps.map((_, i) => {
      const b = document.createElement("button");
      b.textContent = String(i + 1);
      b.className = i === step ? "active" : "";
      b.setAttribute("aria-label", `手順${i + 1}`);
      b.addEventListener("click", () => goStep(i));
      return b;
    }),
  );
  $("stepTitle").textContent = s ? `${step + 1}. ${s.title}` : "手順が見つかりませんでした";
  $("stepText").textContent = s?.text ?? "写真を撮り直すか、印を直して作戦を立て直してください。";
  $<HTMLButtonElement>("prevStep").disabled = step <= 0;
  $<HTMLButtonElement>("nextStep").disabled = step >= steps.length - 1;
  overlay.setStep(step);
}

function goStep(i: number) {
  if (!analysis) return;
  step = Math.max(0, Math.min(analysis.steps.length - 1, i));
  renderStep();
}
$("prevStep").addEventListener("click", () => goStep(step - 1));
$("nextStep").addEventListener("click", () => goStep(step + 1));

// 写真の左右スワイプでも手順を切り替え（印のドラッグ中は除く）
let swipeX: number | null = null;
canvas.addEventListener("pointerdown", (e) => (swipeX = e.clientX));
canvas.addEventListener("pointerup", (e) => {
  if (swipeX === null || overlay.lastGestureWasDrag || !analysis) return (swipeX = null);
  const dx = e.clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 60) goStep(step + (dx < 0 ? 1 : -1));
});

// ---------- プレイ結果 ----------
document.querySelectorAll<HTMLButtonElement>(".fb-buttons .btn-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    const result = btn.dataset.result!;
    if (result === "取れた") {
      $("win").hidden = false;
      return;
    }
    selectedResult = result;
    document.querySelectorAll(".fb-buttons .btn-chip").forEach((b) => b.classList.toggle("selected", b === btn));
    nextMoveBtn.disabled = false;
    nextMoveBtn.textContent = "次の手を考える";
  });
});

nextMoveBtn.addEventListener("click", () => {
  if (!analysis) return;
  const note = fbNote.value.trim();
  if (selectedResult) logs.push({ stepIndex: step, result: note ? `${selectedResult}（${note}）` : selectedResult });
  const previous = analysis;
  const hints: AnalyzeInput["hints"] = {
    previous,
    logs,
    note: photoRetaken
      ? "写真はプレイ後に撮り直したものです。今の写真から位置を読み取ってください。"
      : "写真はプレイ前のものです。結果から景品の今の位置を推測してください。",
  };
  if (!photoRetaken) {
    hints.prize = previous.prize.box;
    hints.hole = previous.hole.box;
  }
  clearFeedback();
  run(hints);
});

function clearFeedback() {
  selectedResult = null;
  fbNote.value = "";
  nextMoveBtn.disabled = true;
  nextMoveBtn.textContent = "次の手を考える";
  document.querySelectorAll(".fb-buttons .btn-chip").forEach((b) => b.classList.remove("selected"));
}

$("winClose").addEventListener("click", () => {
  $("win").hidden = true;
  backToStart();
});

// ---------- エラー ----------
function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}
function hideError() {
  errorEl.hidden = true;
}

if (isDemo) document.title += "（デモ）";
