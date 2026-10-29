# Returns Triage Assistant — an LLM deployment demo

A small web app that turns a customer's free-text return email into a structured case for support staff. It flags missing information and the policy rules that might apply, then drafts a reply. Every output is run through automated guardrail checks, and every quote the model used is highlighted on the original letter, so a reviewer can see at a glance that nothing was invented.

The AI organises and drafts. **Staff decide** whether the return is accepted and how much is refunded.

> Built on a graduate course case study in which I redesigned Costco Taiwan's online return process around generative AI. Not affiliated with Costco. All sample emails are fictional.

## Why this exists

In the course project, my team tested the same prompt on Claude, Gemini and ChatGPT. The prompt's constraints worked: no model invented rules, converted dates or promised refunds. But the three models **judged the same facts differently**, for example marking "number of boxes" as *not provided* in one output and *unclear* in another. Two models also called a screen line a "defect", which only staff can decide.

This demo is the next step: move from "a good prompt in a chat window" to something closer to a deployable tool.

| Problem found in the course test | What this demo does about it |
|---|---|
| Status labels varied between runs and models | Output is forced into a fixed JSON schema; each field must be one of three statuses |
| Models sometimes paraphrased instead of quoting | Every quote is checked against the original email in code |
| Models used judgement words such as "defect" | The reply is scanned for banned terms |
| Reply length and scope drifted | Length and scope are checked automatically |
| Human review took time | The code checks what it can verify, so staff only review the parts that need judgement |

## How it works

```
Browser (index.html)
   │  POST /api/triage { email }
   ▼
Netlify Function (netlify/functions/triage.mjs)
   │  system prompt + rule excerpt + JSON schema
   │  API key stays on the server
   ▼
Gemini API ──► structured JSON
   │
   ▼
Browser renders the case, runs 6 guardrail checks,
and highlights every quote on the original letter
```

**Output sections**

1. Required-info checklist: the 6 items policy rule 7 requires
2. Case summary per product: reason, condition, packaging, received date, payment, invoice
3. Possibly applicable rules, flagged when staff need to confirm
4. Situations the rule excerpt does not cover
5. Questions to ask the customer
6. A draft reply of up to 120 characters

**Automated guardrail checks**

| Check | Why |
|---|---|
| Every quote appears verbatim in the email | Catches invented or paraphrased "evidence" |
| Fields marked *provided* or *unclear* include a quote | No unsupported claims |
| All 6 required items are checked | Nothing silently skipped |
| Only rules 1–7 are cited | No rules from outside the excerpt |
| Reply is 120 characters or fewer | Keeps scope tight |
| Reply avoids "defect", promises and seal requests | The AI must not make the company's decisions |

These checks cover only what code can verify. Semantic judgement, such as over-inference, still needs a human reviewer. That split is deliberate.

## Known limitations

- **No order data.** The model cannot verify what the customer says, for example whether the item was really bought online. A real deployment would pass the order record and flag mismatches. This was the main finding of the course test.
- **The rule excerpt is a summary** of the public policy, written by my team. It is not the official text, and it would need an owner to keep it current.
- **Few test cases.** Three sample emails are not enough to measure accuracy. The next step would be 30–50 labelled emails with a pass rate tracked per check.
- **No retrieval yet.** All 7 rules fit in the prompt. With the full policy, the next step would be retrieval (RAG) over the policy pages.

## Run it yourself

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com).
2. Deploy this repo on Netlify ("Import from Git"). No build command is needed.
3. In Netlify go to **Site configuration → Environment variables** and add `GEMINI_API_KEY`.
4. Optional: set `GEMINI_MODEL` to use a different model. The default is `gemini-flash-latest`.

## Language

Replies follow the customer's language (Chinese or English).

## Stack

Plain HTML/CSS/JS · Netlify Functions (Node) · Gemini API with structured output

---

Selina Huang · [Portfolio](https://10xuan12.github.io/selina-portfolio/) · [GitHub](https://github.com/10xuan12)
