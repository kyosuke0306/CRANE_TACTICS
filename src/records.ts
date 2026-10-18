// プレイ記録。スマホのブラウザの中（localStorage）にだけ保存する。

import type { LastResult, SetupType, Technique } from "./types";

export type Outcome = "playing" | "get" | "giveup";

/** 1回分：その時の写真、立てた作戦の1手目、そのプレイで景品がどう動いたか */
export interface RoundLog {
  thumb: string;
  step: string;
  technique?: Technique;
  /** このあとプレイした結果（まだなら first） */
  result: LastResult;
}

export interface PlayRecord {
  id: string;
  startedAt: number;
  updatedAt: number;
  outcome: Outcome;
  plays: number;
  price: number;
  setup: string;
  setupType: SetupType;
  claw: string;
  clawCount: number;
  prizeLabel: string;
  rounds: RoundLog[];
}

const MAX_RECORDS = 50;
const key = () => (new URLSearchParams(location.search).has("demo") ? "ct.records.demo" : "ct.records");

export function loadRecords(): PlayRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(key()) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(list: PlayRecord[]) {
  // 容量がいっぱいなら古い記録から消して入れ直す
  let l = list.slice(0, MAX_RECORDS);
  while (l.length) {
    try {
      localStorage.setItem(key(), JSON.stringify(l));
      return;
    } catch {
      l = l.slice(0, -1);
    }
  }
}

/** 新しい順に並べて保存（同じ id は置き換え） */
export function saveRecord(r: PlayRecord) {
  r.updatedAt = Date.now();
  write([r, ...loadRecords().filter((x) => x.id !== r.id)].sort((a, b) => b.startedAt - a.startedAt));
}

export function deleteRecord(id: string) {
  write(loadRecords().filter((x) => x.id !== id));
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const RESULT_WORD: Record<LastResult, string> = {
  first: "",
  moved_well: "前進",
  moved_little: "少し前進",
  no_move: "動かず",
  wrong_way: "逆方向",
};
const OUTCOME_WORD: Record<Outcome, string> = { playing: "途中でやめた", get: "取れた", giveup: "あきらめた" };

/** Gemini に渡す「過去の記録」の要約（新しいものから数件） */
export function pastNotes(excludeId?: string, limit = 5): string[] {
  return loadRecords()
    .filter((r) => r.id !== excludeId && r.rounds.length)
    .slice(0, limit)
    .map((r) => {
      const moves = r.rounds
        .filter((x) => x.result !== "first")
        .map((x) => `${x.step}→${RESULT_WORD[x.result]}`)
        .join("、");
      return `${r.setup}（${r.claw}）: ${moves || "記録なし"} ／ ${r.plays}回で${OUTCOME_WORD[r.outcome]}`;
    });
}
