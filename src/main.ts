import "./style.css";
import { takePhoto } from "./camera";
import { analyze, demoAnalysis, DEFAULT_MODEL, PROXY_URL, type AnalyzeInput, type GeminiSettings } from "./gemini";
import { StepDiagram, techniqueOf } from "./diagram";
import { Overlay } from "./overlay";
import type { Analysis, LastResult, SetupType } from "./types";

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
const settingsDlg = $<HTMLDialogElement>("settings");

const overlay = new Overlay(canvas);
const diagram = new StepDiagram($("diagram"));
const TECH_LABEL = { push: "押す", rotate: "回す", press: "押さえる", lift: "持ち上げる" } as const;
const isDemo = new URLSearchParams(location.search).has("demo");

// ---------- 状態 ----------
let photo: { base64: string; mime: string } | null = null;
let analysis: Analysis | null = null;
let step = 0;
/** 結果の写真を撮った回数（＝プレイした回数） */
let plays = 0;
/** 撮った写真の小さな画像（履歴表示用） */
let history: { thumb: string; result: LastResult }[] = [];
/** 解析に失敗したとき「作戦を立てる」でやり直すための条件 */
let pendingHints: AnalyzeInput["hints"] | undefined;

// ---------- 設定（ブラウザ内に保存） ----------
function loadSettings(): GeminiSettings {
  try {
    // 以前の標準モデルが保存されていたら、新しい標準（軽い版）に置き換える
    if (localStorage.getItem("ct.model") === "gemini-flash-latest" && !localStorage.getItem("ct.modelMigrated")) {
      localStorage.removeItem("ct.model");
    }
    localStorage.setItem("ct.modelMigrated", "1");
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
async function readPhoto(file: Blob): Promise<{ base64: string; mime: string; img: HTMLImageElement; thumb: string }> {
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
    const t = document.createElement("canvas");
    const tr = 160 / Math.max(c.width, c.height);
    t.width = Math.round(c.width * tr);
    t.height = Math.round(c.height * tr);
    t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
    return { base64: dataUrl.split(",")[1], mime: "image/jpeg", img, thumb: t.toDataURL("image/jpeg", 0.7) };
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

let currentThumb = "";

async function onPhoto(file: Blob | null | undefined, isResult: boolean) {
  if (!file) return;
  hideError();
  try {
    const p = await readPhoto(file);
    const before = photo;
    photo = { base64: p.base64, mime: p.mime };
    startEl.hidden = true;
    boardEl.hidden = false;
    overlay.setImage(p.img);
    if (isResult && analysis && before) {
      // プレイ後の写真：前の写真と見比べて、続きの作戦を立てる
      plays++;
      history.push({ thumb: currentThumb, result: "first" });
      currentThumb = p.thumb;
      overlay.setAnalysis(null);
      $("photoInfo").hidden = true;
      resultEl.hidden = true;
      pendingHints = { previous: analysis, beforePhoto: before, plays };
      run(pendingHints);
    } else {
      currentThumb = p.thumb;
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
  plays = 0;
  history = [];
  pendingHints = undefined;
  overlay.setAnalysis(null);
  $("photoInfo").hidden = true;
  preAnalyze.hidden = false;
  resultEl.hidden = true;
  reanalyzeBtn.hidden = true;
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
      ? await new Promise<Analysis>((r) => setTimeout(() => r(demoAnalysis(hints?.plays ?? 0)), 900))
      : await analyze({ imageBase64: photo.base64, mimeType: photo.mime, hints }, settings, (msg) => {
          clearInterval(timer);
          loadingText.textContent = msg;
        });
    analysis = a;
    step = 0;
    pendingHints = undefined;
    if (history.length) history[history.length - 1].result = a.lastResult;
    overlay.setAnalysis(a);
    renderResult();
    preAnalyze.hidden = true;
    resultEl.hidden = false;
    reanalyzeBtn.hidden = true;
    canvas.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    preAnalyze.hidden = false;
    showError((e as Error).message);
  } finally {
    clearInterval(timer);
    loadingEl.hidden = true;
  }
}

$("analyzeBtn").addEventListener("click", () => run(pendingHints));

overlay.onEdit = () => {
  reanalyzeBtn.hidden = false;
};

reanalyzeBtn.addEventListener("click", () => {
  if (!analysis) return;
  run({ prize: analysis.prize.box, hole: analysis.hole.box, previous: analysis, plays });
});

// ---------- 結果の表示 ----------
const CONF_LABEL = { low: "自信：低め", medium: "自信：ふつう", high: "自信：高め" } as const;
const CONF_WORD = { low: "低め", medium: "ふつう", high: "高め" } as const;
const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_COINS = 10;

function svgEl(markup: string, cls: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", cls);
  svg.innerHTML = markup;
  return svg;
}

// ---------- 1プレイの値段 ----------
function loadPrice(): number {
  try {
    const v = Number(localStorage.getItem("ct.price"));
    return v > 0 ? v : 100;
  } catch {
    return 100;
  }
}
let price = loadPrice();
const yen = (n: number) => n.toLocaleString("ja-JP");

const priceDlg = $<HTMLDialogElement>("priceDlg");
const priceInput = $<HTMLInputElement>("priceInput");
$("priceBtn").addEventListener("click", () => {
  priceInput.value = String(price);
  priceDlg.showModal();
});
priceDlg.querySelectorAll<HTMLButtonElement>("[data-price]").forEach((b) =>
  b.addEventListener("click", () => {
    priceInput.value = b.dataset.price!;
    priceDlg.close("save");
  }),
);
priceDlg.addEventListener("close", () => {
  const v = Math.round(Number(priceInput.value));
  if (priceDlg.returnValue !== "save" || !(v > 0)) return;
  price = v;
  try {
    localStorage.setItem("ct.price", String(v));
  } catch {
    /* 保存できなくても今回は使う */
  }
  if (analysis) renderCost(analysis.tries);
});

/** 見込み回数をコインで、かかりそうな金額を数字で見せる */
function renderCost(t: { min: number; max: number }) {
  const shown = Math.min(plays + t.max, MAX_COINS);
  const coin = '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/>';
  $("coins").replaceChildren(
    ...Array.from({ length: shown }, (_, i) =>
      svgEl(coin, i < plays ? "coin used" : i < plays + t.min ? "coin" : "coin maybe"),
    ),
  );
  const range = (a: number, b: number) => (a === b ? yen(a) : `${yen(a)}〜${yen(b)}`);
  $("triesNum").textContent = t.min === t.max ? String(t.min) : `${t.min}〜${t.max}`;
  const cost = range(t.min * price, t.max * price);
  $("costNum").textContent = cost;
  // 桁が多いときは小さくして1行に収める
  $("costNum").style.fontSize = cost.length > 11 ? "20px" : cost.length > 8 ? "24px" : "";
  $("priceLabel").textContent = `1回 ¥${yen(price)}`;
  const spent = $("spent");
  spent.hidden = plays === 0;
  spent.textContent = `使った ¥${yen(plays * price)}（${plays}回）`;
}

// ---------- 台の種類・アーム（絵で見せる） ----------
const SETUP_INFO: Record<SetupType, { label: string; icon: string }> = {
  stones: {
    label: "石の上",
    icon: '<rect x="6" y="5" width="12" height="9" rx="1"/><circle cx="5" cy="18" r="2"/><circle cx="10" cy="18.5" r="2"/><circle cx="15" cy="18" r="2"/><circle cx="20" cy="18.5" r="1.8"/>',
  },
  bridge: {
    label: "橋渡し",
    icon: '<rect x="5" y="6" width="14" height="8" rx="1"/><circle cx="7" cy="17" r="2.2"/><circle cx="17" cy="17" r="2.2"/><path d="M12 15v6m-2-2 2 2 2-2"/>',
  },
  flat: {
    label: "平置き",
    icon: '<rect x="4" y="8" width="11" height="9" rx="1"/><path d="M2 17h15M17 17v4M17 13h5"/>',
  },
  hook: {
    label: "フック",
    icon: '<path d="M4 5h16M12 5v5"/><path d="M12 10a4 4 0 1 0 4 4"/><rect x="8" y="17" width="8" height="4" rx="1"/>',
  },
  pusher: {
    label: "押し出し",
    icon: '<path d="M3 11h12v10M15 21h6"/><rect x="6" y="6" width="6" height="5" rx="1"/><path d="M14 8h5m-2-2 2 2-2 2"/>',
  },
  other: {
    label: "その他",
    icon: '<rect x="5" y="8" width="14" height="11" rx="1.5"/><path d="M9.5 4.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4"/>',
  },
};

function clawIcon(n: number): string {
  const head = '<path d="M12 2v4"/><rect x="8" y="6" width="8" height="4" rx="1.5"/>';
  if (n === 2) return head + '<path d="M9 10c-4 2-4 7-1 10l2-1M15 10c4 2 4 7 1 10l-2-1"/>';
  if (n >= 3) return head + '<path d="M9 10c-4 2-4 7-1 10l2-1M15 10c4 2 4 7 1 10l-2-1M12 10v9"/>';
  return head + '<path d="M10.5 14a1.8 1.8 0 1 1 2.2 1.7c-.5.2-.7.5-.7 1M12 19.5v.5"/>';
}

function miniTile(id: string, icon: string, label: string, title: string) {
  const tile = $(id);
  tile.replaceChildren(svgEl(icon, "mini-ico"), Object.assign(document.createElement("small"), { textContent: label }));
  tile.title = title;
}

// ---------- 前回からの変化・履歴 ----------
const RESULT_INFO: Record<Exclude<LastResult, "first">, { label: string; cls: string; icon: string }> = {
  moved_well: { label: "前進！", cls: "good", icon: '<path d="M5 12h14m-5-5 5 5-5 5"/>' },
  moved_little: { label: "少し前進", cls: "little", icon: '<path d="M8 12h8m-3-3 3 3-3 3"/>' },
  no_move: { label: "動かず", cls: "none", icon: '<path d="M6 12h12"/>' },
  wrong_way: { label: "逆方向", cls: "wrong", icon: '<path d="M19 12H5m5-5-5 5 5 5"/>' },
};

function renderHistory() {
  const box = $("history");
  box.hidden = history.length === 0;
  const items = [...history.map((h) => h.thumb), currentThumb];
  box.replaceChildren(
    ...items.map((src, i) => {
      const fig = document.createElement("figure");
      fig.className = i === items.length - 1 ? "now" : "";
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      const cap = document.createElement("figcaption");
      cap.textContent = i === items.length - 1 ? "今" : String(i + 1);
      fig.append(img, cap);
      const r = i > 0 ? history[i - 1]?.result : undefined;
      if (r && r !== "first") fig.classList.add(RESULT_INFO[r].cls);
      return fig;
    }),
  );
}

function renderResult() {
  if (!analysis) return;
  renderCost(analysis.tries);
  const setup = SETUP_INFO[analysis.setupType];
  miniTile("setupTile", setup.icon, setup.label, analysis.setup);
  miniTile("clawTile", clawIcon(analysis.clawCount), analysis.clawCount ? `${analysis.clawCount}本爪` : "アーム", analysis.claw);
  $("photoInfo").hidden = false;
  const conf = $("confTile");
  conf.className = `tile conf-badge conf-${analysis.confidence}`;
  conf.setAttribute("aria-label", CONF_LABEL[analysis.confidence]);
  $("confLevel").textContent = CONF_WORD[analysis.confidence];

  const last = $("lastResult");
  const info = analysis.lastResult === "first" ? null : RESULT_INFO[analysis.lastResult];
  last.hidden = !info;
  if (info) {
    last.className = `last-result ${info.cls}`;
    last.replaceChildren(svgEl(info.icon, "ico"), Object.assign(document.createElement("span"), { textContent: info.label }));
  }
  renderHistory();

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

const FLAG_SVG = '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/>';

function renderStep() {
  if (!analysis) return;
  const steps = analysis.steps;
  const last = steps.length; // 最後の「ゴール」
  const isGoal = step === last;
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
    (() => {
      const b = document.createElement("button");
      b.className = `goal-dot${isGoal ? " active" : ""}`;
      b.setAttribute("aria-label", "ゴール");
      b.append(svgEl(FLAG_SVG, "ico"));
      b.addEventListener("click", () => goStep(last));
      return b;
    })(),
  );
  $("stepCard").classList.toggle("goal", isGoal);
  if (isGoal) {
    $("stepTitle").textContent = "GET!";
    $("stepText").textContent = analysis.goal.text;
  } else {
    $("stepTitle").textContent = s ? `${step + 1}. ${s.title}` : "手順が見つかりませんでした";
    $("stepText").textContent = s?.text ?? "写真を撮り直すか、印を直して作戦を立て直してください。";
  }
  $<HTMLButtonElement>("prevStep").disabled = step <= 0;
  $<HTMLButtonElement>("nextStep").disabled = step >= last;
  overlay.setStep(step);
  diagram.show(isGoal ? null : analysis, step);
  if (s && !isGoal) $("techLabel").textContent = TECH_LABEL[techniqueOf(s)];
}

function goStep(i: number) {
  if (!analysis) return;
  step = Math.max(0, Math.min(analysis.steps.length, i));
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
$("winBtn").addEventListener("click", () => {
  const n = plays + 1;
  $("winSpent").textContent = `${n}回・¥${yen(n * price)}でゲット！`;
  $("win").hidden = false;
});

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
