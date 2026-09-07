export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDeal, uploadDealContract, saveDealVerification, DealsApiError } from "@/lib/dealsApi";
import { extractContractFields, ContractExtractionError } from "@/lib/contractExtraction";
import { verifyContractAgainstBid } from "@/lib/contractVerification";

const MAX_FILE_BYTES = 10_000_000;

// Dealer uploads the sales contract for a deal they won. Runs AI extraction
// + deterministic verification against the winning bid's own price and
// dealer name in the same request, so the dealer sees the result
// immediately — never a separate "check later" step that could be skipped.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string; dealerName?: string } | undefined;
  if (!user?.id || user.role !== "dealer") {
    return NextResponse.json({ error: "You must be signed in as a dealer to upload paperwork." }, { status: 401 });
  }

  const { id } = await params;
  let deal;
  try {
    deal = await getDeal(id);
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not load this deal.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (!user.dealerName || deal.dealerName !== user.dealerName) {
    return NextResponse.json({ error: "Not authorized to upload paperwork for this deal" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A contract file is required." }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF contracts are accepted." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large (10 MB max)." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentBase64 = Buffer.from(bytes).toString("base64");

  try {
    await uploadDealContract(id, { fileName: file.name, contentBase64 });
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not save the uploaded contract.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Verification failing (no API key, a bad PDF, a transient AI error)
  // must never make the upload itself look like it failed — the dealer's
  // file is already saved. Surface it as needs_review instead.
  let verification;
  try {
    const extracted = await extractContractFields(bytes);
    if (!extracted) {
      verification = {
        status: "needs_review" as const,
        priceMatches: false,
        dealerNameMatches: false,
        flags: [{ severity: "warning" as const, message: "AI verification is not configured — review this contract manually." }],
        extracted: { totalOtdPrice: null, dealerName: null, buyerName: null, feeLines: [] },
        checkedAt: new Date().toISOString(),
      };
    } else {
      verification = verifyContractAgainstBid(extracted, {
        dealerName: deal.dealerName,
        totalOtdPrice: deal.totalOtdPrice,
      });
    }
  } catch (err) {
    const message = err instanceof ContractExtractionError ? err.message : "Could not read this contract automatically.";
    verification = {
      status: "needs_review" as const,
      priceMatches: false,
      dealerNameMatches: false,
      flags: [{ severity: "warning" as const, message }],
      extracted: { totalOtdPrice: null, dealerName: null, buyerName: null, feeLines: [] },
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const updated = await saveDealVerification(id, verification);
    return NextResponse.json({ deal: updated, verification });
  } catch (err) {
    // The verification result still reaches the caller even if persisting
    // it failed — better than losing the check the dealer is waiting on.
    return NextResponse.json({ deal: { ...deal, verification }, verification, persisted: false });
  }
}
