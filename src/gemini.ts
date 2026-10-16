import { RESPONSE_SCHEMA, SYSTEM_PROMPT } from "./tactics";
import type { Analysis, Arrow, Box, PlayLog, Point, Pose } from "./types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// 通常版（gemini-flash-latest）はいつも混雑しているので、軽い版を標準にする
export const DEFAULT_MODEL = "gemini-flash-lite-latest";

/** ビルド時に VITE_PROXY_URL を設定すると、APIキーを持たない中継サーバー経由で呼ぶ */
export const PROXY_URL: string = import.meta.env.VITE_PROXY_URL ?? "";

export interface GeminiSettings {
  apiKey: string;
  model: string;
}

export interface AnalyzeInput {
  imageBase64: string;
  mimeType: string;
  /** ユーザーが直した位置や、プレイ結果など */
  hints?: {
    prize?: Box;
    hole?: Box;
    previous?: Analysis;
    logs?: PlayLog[];
    note?: string;
  };
}

function buildUserText(input: AnalyzeInput): string {
  const h = input.hints;
  if (!h) return "この台の攻略手順を考えてください。";
  const lines = ["この台の攻略手順を考え直してください。"];
  if (h.prize) lines.push(`景品の正しい位置（ユーザーが修正）: ${JSON.stringify(h.prize)}`);
  if (h.hole) lines.push(`落とし口の正しい位置（ユーザーが修正）: ${JSON.stringify(h.hole)}`);
  if (h.previous) {
    lines.push("前回の提案:");
    h.previous.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s.title}: ${s.text}`));
  }
  if (h.logs?.length) {
    lines.push("実際にプレイした結果:");
    h.logs.forEach((l) => lines.push(`  手順${l.stepIndex + 1}を試した → ${l.result}`));
    lines.push("この結果を踏まえて、景品の今の位置から次の手を出してください。");
  }
  if (h.note) lines.push(`ユーザーからのメモ: ${h.note}`);
  return lines.join("\n");
}

function buildRequestBody(input: AnalyzeInput) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
          { text: buildUserText(input) },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.3,
    },
  };
}

// 混雑（503）や一時的なエラーが続いたときに切り替える別のモデル
const otherModel = (model: string) =>
  model === "gemini-flash-lite-latest" ? "gemini-flash-latest" : "gemini-flash-lite-latest";
const RETRY_WAITS = [2000, 5000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isBusy = (status: number) => status === 500 || status === 503 || status === 504;

export async function analyze(
  input: AnalyzeInput,
  settings: GeminiSettings,
  onRetry?: (message: string) => void,
): Promise<Analysis> {
  const body = buildRequestBody(input);
  if (!PROXY_URL && !settings.apiKey) {
    throw new Error("APIキーが設定されていません。右上の設定ボタンから入力してください。");
  }

  const call = (model: string) =>
    PROXY_URL
      ? fetch(PROXY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, body }),
        })
      : fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey },
          body: JSON.stringify(body),
        });

  const model = settings.model || DEFAULT_MODEL;
  let res = await call(model);
  for (const wait of RETRY_WAITS) {
    if (!isBusy(res.status)) break;
    onRetry?.("Gemini が混雑中。もう一度試しています…");
    await sleep(wait);
    res = await call(model);
  }
  if (isBusy(res.status)) {
    onRetry?.("混雑しているので、別のモデルで試しています…");
    res = await call(otherModel(model));
  }

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("無料枠の上限に達しました。少し時間をおいてから試してください。");
    if (res.status === 400 && text.includes("API key")) throw new Error("APIキーが正しくないようです。");
    if (isBusy(res.status)) {
      throw new Error("Gemini が混雑していて答えが返ってきませんでした。少し時間をおいて、もう一度「作戦を立てる」を押してください。");
    }
    throw new Error(`Gemini の呼び出しに失敗しました (${res.status})\n${text.slice(0, 300)}`);
  }

  const json = await res.json();
  const raw: string | undefined = json?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!raw) throw new Error("Gemini から答えが返ってきませんでした。写真を変えて試してください。");
  return normalize(JSON.parse(raw));
}

// ---- 返ってきた値の整形（範囲外や欠けた値で描画が壊れないように） ----

const clamp = (n: unknown) => Math.min(1000, Math.max(0, Number(n) || 0));

function toBox(v: unknown, fallback: Box): Box {
  if (!Array.isArray(v) || v.length < 4) return fallback;
  let [y1, x1, y2, x2] = v.map(clamp);
  if (y2 < y1) [y1, y2] = [y2, y1];
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 - y1 < 10) y2 = Math.min(1000, y1 + 10);
  if (x2 - x1 < 10) x2 = Math.min(1000, x1 + 10);
  return [y1, x1, y2, x2];
}

function toPoint(v: unknown, fallback: Point): Point {
  if (!Array.isArray(v) || v.length < 2) return fallback;
  return [clamp(v[0]), clamp(v[1])];
}

function toPose(v: unknown, fallback: Box): Pose | undefined {
  if (!v || typeof v !== "object") return undefined;
  const p = v as { box?: unknown; angle?: unknown };
  const angle = Number(p.angle);
  return { box: toBox(p.box, fallback), angle: Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : 0 };
}

function toTries(v: unknown): { min: number; max: number } {
  const t = (v ?? {}) as { min?: unknown; max?: unknown };
  const lo = Math.round(Number(t.min));
  const hi = Math.round(Number(t.max));
  const min = Math.min(30, Math.max(1, Number.isFinite(lo) ? lo : 3));
  const max = Math.min(30, Math.max(min, Number.isFinite(hi) ? hi : min));
  return { min, max };
}

const ARROWS: Arrow[] = ["left", "right", "up", "down", "rotate_cw", "rotate_ccw", "none"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalize(a: any): Analysis {
  const prizeBox = toBox(a?.prize?.box, [400, 300, 600, 600]);
  const center: Point = [(prizeBox[0] + prizeBox[2]) / 2, (prizeBox[1] + prizeBox[3]) / 2];
  const holeBox = toBox(a?.hole?.box, [700, 700, 950, 950]);
  return {
    setup: String(a?.setup ?? "不明"),
    claw: String(a?.claw ?? "不明"),
    prize: { label: String(a?.prize?.label ?? "景品"), box: prizeBox },
    hole: { box: holeBox },
    obstacles: Array.isArray(a?.obstacles)
      ? a.obstacles.map((o: { label?: string; box?: unknown }) => ({
          label: String(o?.label ?? ""),
          box: toBox(o?.box, [0, 0, 10, 10]),
        }))
      : [],
    steps: (Array.isArray(a?.steps) ? a.steps : []).slice(0, 6).map(
      (s: { title?: string; text?: string; target?: unknown; arrow?: string; after?: unknown }, i: number) => ({
        title: String(s?.title ?? `手順${i + 1}`),
        text: String(s?.text ?? ""),
        target: toPoint(s?.target, center),
        arrow: ARROWS.includes(s?.arrow as Arrow) ? (s.arrow as Arrow) : "none",
        after: toPose(s?.after, prizeBox),
      }),
    ),
    tries: toTries(a?.tries),
    goal: {
      ...(toPose(a?.goal, holeBox) ?? { box: holeBox, angle: 0 }),
      text: String(a?.goal?.text ?? "落とし口に落ちる"),
    },
    cautions: Array.isArray(a?.cautions) ? a.cautions.map(String) : [],
    confidence: ["low", "medium", "high"].includes(a?.confidence) ? a.confidence : "low",
  };
}

/** ?demo=1 のときに使うサンプル（APIを呼ばずに画面を確認できる） */
export function demoAnalysis(): Analysis {
  return normalize({
    setup: "石（アクリルダイヤ）の上に置かれた箱",
    claw: "3本爪",
    prize: { label: "手前の箱", box: [620, 140, 880, 390] },
    hole: { box: [640, 560, 840, 760] },
    obstacles: [{ label: "白いバー", box: [530, 80, 570, 900] }],
    steps: [
      {
        title: "左端を押す",
        text: "アームの中心を箱の左端より少し内側に。左の爪が石に刺さり、箱を右へ押します。",
        target: [740, 170],
        arrow: "right",
        after: { box: [620, 260, 880, 510], angle: 0 },
      },
      {
        title: "右奥の角を回す",
        text: "右奥の角に爪を掛け、右手前の角を穴へ向けるように回します。",
        target: [650, 470],
        arrow: "rotate_cw",
        after: { box: [630, 340, 870, 590], angle: 25 },
      },
      {
        title: "最後のひと押し",
        text: "穴に半分かかったら、左側の端を上から押さえて傾けます。",
        target: [760, 400],
        arrow: "none",
        after: { box: [650, 450, 860, 680], angle: 40 },
      },
    ],
    tries: { min: 4, max: 7 },
    goal: { box: [680, 560, 860, 740], angle: 70, text: "角から穴に傾いて落ちる" },
    cautions: [
      "写真だけではアームの強さは分かりません。1回目の動き方を見て続けるか決めましょう。",
      "1人各1個までの制限があります。",
    ],
    confidence: "medium",
  });
}
