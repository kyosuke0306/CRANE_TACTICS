// Cloudflare Worker: ブラウザから届いた解析リクエストを Gemini に中継する。
// APIキーは Worker のシークレット（GEMINI_API_KEY）にだけ置き、公開リポジトリやブラウザには出さない。

interface Env {
  GEMINI_API_KEY: string;
  /** 例: https://kyosuke0306.github.io （カンマ区切りで複数可） */
  ALLOWED_ORIGINS: string;
  /** 使ってよいモデル（カンマ区切り） */
  ALLOWED_MODELS: string;
}

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });
    if (!allowed.includes(origin)) return new Response("Forbidden", { status: 403, headers: cors });

    const len = Number(req.headers.get("Content-Length") ?? 0);
    if (len > MAX_BODY_BYTES) return new Response("Payload Too Large", { status: 413, headers: cors });

    let payload: { model?: string; body?: unknown };
    try {
      payload = await req.json();
    } catch {
      return new Response("Bad Request", { status: 400, headers: cors });
    }

    const models = env.ALLOWED_MODELS.split(",").map((s) => s.trim());
    const model = payload.model && models.includes(payload.model) ? payload.model : models[0];

    const upstream = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(payload.body),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
