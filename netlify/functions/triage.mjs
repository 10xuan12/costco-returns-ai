// Netlify Function: keeps the Gemini API key on the server.
// GET  /api/triage -> returns the rule excerpt and model name (for display)
// POST /api/triage -> { email } -> structured triage result from Gemini

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const MAX_CHARS = 1500;

// Rule excerpt summarised by our team from Costco Taiwan's public return policy
// and FAQ (checked 2026-10-18 and 2026-10-26). Not the official wording.
export const RULES = [
  "電器類（含電視）須自收到商品起 90 天內退貨，退貨前須移除個人資料。",
  "退貨時須將商品、保證書、贈品、所有配件與包裝盒（含外箱）一併退回；無法回復原狀會影響退款進度。",
  "收到商品發現瑕疵，請於收貨 24 小時內拍照留存並聯絡客服。",
  "分期付款訂單不能在賣場退貨，須線上申請或聯絡客服。",
  "公司戶發票於賣場退貨時須攜帶公司大小章或發票章。",
  "客製化、安裝商品及指定貴金屬不可退貨。",
  "透過客服中心辦理退貨，須提供：會員卡號、訂單編號、商品名稱／件數、退貨商品包裝箱數、取件資訊（姓名／電話／地址）、退貨原因。",
];

export const REQUIRED_INFO = ["會員卡號", "訂單編號", "商品名稱／件數", "退貨商品包裝箱數", "取件資訊（姓名／電話／地址）", "退貨原因"];

const STATUS = ["已提供", "尚未提供", "表述不明"];

const SYSTEM_PROMPT = `你是好市多線上購物的退貨客服助理，工作是協助客服人員整理會員來信，不是替公司做決定。

規則：
1. 只依據「會員來信」與「退貨規則摘錄」整理。不得補充會員未提供的資訊，不得引用摘錄以外的規則。
2. 每個欄位標示「已提供」「尚未提供」或「表述不明」：
   - 已提供：來信明確寫出。
   - 尚未提供：來信完全沒提到。
   - 表述不明：有提到但不完整或有歧義（例如只說「上週買」而沒說收貨日）。
3. quote 必須是來信中逐字出現的原文片段；尚未提供時 quote 留空字串。
4. 不得把時間換算成日期，不得判定是否超過期限。
5. 商品狀況照會員原話記錄，不得自行判斷為「瑕疵」「損壞」或「故障」；是否屬瑕疵由人員檢查判定。
6. 摘錄沒有涵蓋的情況（例如食品），放進 uncovered，寫明「摘錄未涵蓋，需人員確認」。
7. 規則 5 是「賣場」退貨的情境；線上退貨是否需要用印，標示需人員確認，不可直接要求會員準備印章。
8. 回覆草稿 120 字以內：只說明需要補充的資料與下一步。不承諾可以退貨、退款時間、金額或取件時段，不使用「瑕疵」一詞，不提出摘錄以外的做法。`;

const statusField = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: STATUS },
    quote: { type: "STRING" },
  },
  required: ["status", "quote"],
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    required_info: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          item: { type: "STRING", enum: REQUIRED_INFO },
          status: { type: "STRING", enum: STATUS },
          quote: { type: "STRING" },
          note: { type: "STRING" },
        },
        required: ["item", "status", "quote"],
      },
    },
    products: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          product: { type: "STRING" },
          return_reason: statusField,
          condition: statusField,
          packaging: statusField,
          received_date: statusField,
          payment: statusField,
          invoice: statusField,
        },
        required: ["product", "return_reason", "condition", "packaging", "received_date", "payment", "invoice"],
      },
    },
    rules: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          rule_no: { type: "INTEGER" },
          reason: { type: "STRING" },
          needs_staff_check: { type: "BOOLEAN" },
        },
        required: ["rule_no", "reason", "needs_staff_check"],
      },
    },
    uncovered: { type: "ARRAY", items: { type: "STRING" } },
    questions: { type: "ARRAY", items: { type: "STRING" } },
    reply_draft: { type: "STRING" },
  },
  required: ["required_info", "products", "rules", "uncovered", "questions", "reply_draft"],
};

function buildUserPrompt(email) {
  const rules = RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");
  return `【會員來信】\n${email}\n\n【退貨規則摘錄】\n${rules}`;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default async (req) => {
  if (req.method === "GET") return json({ rules: RULES, model: MODEL });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const key = process.env.GEMINI_API_KEY;
  if (!key) return json({ error: "Server is missing GEMINI_API_KEY." }, 500);

  let email = "";
  try {
    ({ email = "" } = await req.json());
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  email = String(email).trim();
  if (!email) return json({ error: "請貼上會員來信。" }, 400);
  if (email.length > MAX_CHARS) return json({ error: `來信請在 ${MAX_CHARS} 字以內。` }, 400);

  const started = Date.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(email) }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    const status = res.status === 429 ? 429 : 502;
    const message = res.status === 429 ? "已達 Gemini 免費額度上限，請稍後再試。" : "Gemini API 呼叫失敗。";
    console.error("Gemini error", res.status, detail.slice(0, 500));
    return json({ error: message }, status);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  try {
    const result = JSON.parse(text);
    return json({ result, model: MODEL, ms: Date.now() - started });
  } catch {
    console.error("Unparseable model output", text.slice(0, 500));
    return json({ error: "模型輸出格式錯誤，請再試一次。" }, 502);
  }
};

export const config = { path: "/api/triage" };
