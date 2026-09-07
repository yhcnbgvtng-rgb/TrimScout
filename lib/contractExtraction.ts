/**
 * Reads an uploaded sales-contract PDF and pulls out the fields
 * lib/contractVerification.ts checks against the winning bid.
 *
 * The LLM here only reads and structures what's on the page — it never
 * decides whether the contract is acceptable. That decision (does the
 * price match, does the dealer match) is deterministic code in
 * lib/contractVerification.ts, same split as lib/negotiationPolicy.ts /
 * lib/negotiationCopy.ts.
 */

import { serverSecret } from "./serverSecret";
import type { ContractExtractedFields } from "./contractVerification";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const MAX_CONTRACT_TEXT_CHARS = 15000;

export class ContractExtractionError extends Error {}

async function extractPdfText(pdfBytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(pdfBytes, { mergePages: true });
  const text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  return text;
}

function safeJsonFromModelText(text: string): unknown {
  // Claude sometimes wraps JSON in a code fence despite instructions not
  // to — strip it rather than fail the whole extraction over formatting.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  return JSON.parse(candidate);
}

function coerceExtractedFields(raw: unknown): ContractExtractedFields {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const totalOtdPrice =
    typeof obj.totalOtdPrice === "number" && Number.isFinite(obj.totalOtdPrice) ? obj.totalOtdPrice : null;
  const dealerName = typeof obj.dealerName === "string" && obj.dealerName.trim() ? obj.dealerName.trim() : null;
  const buyerName = typeof obj.buyerName === "string" && obj.buyerName.trim() ? obj.buyerName.trim() : null;
  const feeLines = Array.isArray(obj.feeLines)
    ? obj.feeLines
        .filter(
          (l): l is { label: unknown; amount: unknown } => !!l && typeof l === "object"
        )
        .map((l) => ({
          label: typeof l.label === "string" ? l.label : "Unlabeled fee",
          amount: typeof l.amount === "number" && Number.isFinite(l.amount) ? l.amount : 0,
        }))
        .filter((l) => l.amount !== 0)
    : [];
  return { totalOtdPrice, dealerName, buyerName, feeLines };
}

/**
 * Returns null (not an error) when ANTHROPIC_API_KEY isn't configured —
 * callers should treat that as "AI verification unavailable," not a
 * failure of the upload itself.
 */
export async function extractContractFields(pdfBytes: Uint8Array): Promise<ContractExtractedFields | null> {
  const apiKey = serverSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return null;

  const fullText = await extractPdfText(pdfBytes);
  const text = fullText.slice(0, MAX_CONTRACT_TEXT_CHARS);
  if (!text.trim()) {
    throw new ContractExtractionError("Could not read any text from this PDF — it may be a scanned image.");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content:
            "You are extracting structured data from a vehicle sale contract or buyer's order. " +
            "Read the text below and return ONLY a JSON object (no prose, no code fence) with exactly these keys:\n" +
            '  "totalOtdPrice": number | null — the final total amount due / out-the-door price / total sale price.\n' +
            '  "dealerName": string | null — the selling dealership\'s name.\n' +
            '  "buyerName": string | null — the buyer\'s name, if present.\n' +
            '  "feeLines": array of {"label": string, "amount": number} — every itemized fee, tax, or add-on charge line you can find (doc fee, destination, tax, accessories, etc). Do not include the vehicle price itself as a fee line.\n' +
            "Use null for any field you can't find. Never invent a number that isn't in the text.\n\n" +
            `Contract text:\n"""\n${text}\n"""`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ContractExtractionError(`AI extraction request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const modelText = json?.content?.[0]?.text;
  if (typeof modelText !== "string" || !modelText.trim()) {
    throw new ContractExtractionError("AI extraction returned an empty response.");
  }

  let parsed: unknown;
  try {
    parsed = safeJsonFromModelText(modelText);
  } catch {
    throw new ContractExtractionError("Could not parse the AI's extraction response.");
  }

  return coerceExtractedFields(parsed);
}
