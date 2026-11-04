// Thousands separators on dollar inputs: the pure edit logic (typing, deleting, pasting, caret) and the real
// <MoneyInput> driven in jsdom, including that the caller only ever sees the plain number.
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { applyMoneyEdit, formatMoneyText, sanitizeMoney } from "./moneyInput";

describe("formatMoneyText / sanitizeMoney", () => {
  it("adds commas to whole dollars", () => {
    assert.equal(formatMoneyText("10000"), "10,000");
    assert.equal(formatMoneyText("999"), "999");
    assert.equal(formatMoneyText("1234567"), "1,234,567");
    assert.equal(formatMoneyText(""), "");
    assert.equal(formatMoneyText(null), "");
    assert.equal(formatMoneyText(12500), "12,500");
  });
  it("keeps cents only where allowed", () => {
    assert.equal(formatMoneyText("1234.5", { allowCents: true }), "1,234.5");
    assert.equal(formatMoneyText("1234.", { allowCents: true }), "1,234.");
    assert.equal(formatMoneyText("1234.567", { allowCents: true }), "1,234.56");
    assert.equal(formatMoneyText("1234.50"), "1,234", "whole-dollar field drops cents");
    assert.equal(sanitizeMoney(".5", { allowCents: true }), "0.5");
  });
  it("sanitizes pasted money", () => {
    assert.equal(sanitizeMoney("$10,000.00", { allowCents: true }), "10000.00");
    assert.equal(sanitizeMoney("$10,000.00"), "10000");
    assert.equal(sanitizeMoney(" $ 1 234 "), "1234");
    assert.equal(sanitizeMoney("abc"), "");
    assert.equal(sanitizeMoney("007"), "7");
    assert.equal(sanitizeMoney("-1,500", { allowNegative: true }), "-1500");
    assert.equal(sanitizeMoney("-1,500"), "1500");
  });
});

describe("applyMoneyEdit: typing, deleting, pasting, caret", () => {
  it("typing the 4th digit inserts a comma and keeps the caret after the new digit", () => {
    const e = applyMoneyEdit("1000", "1,0000", 6, "insertText"); // a 0 typed at the end of "1,000"
    assert.equal(e.raw, "10000");
    assert.equal(e.display, "10,000");
    assert.equal(e.caret, 6);
    const f = applyMoneyEdit("100", "1000", 4, "insertText");
    assert.equal(f.display, "1,000");
    assert.equal(f.caret, 5);
  });
  it("typing in the middle keeps the caret next to what was typed", () => {
    // "10,000" -> caret after "1", type 5 -> "150,000"
    const e = applyMoneyEdit("10000", "150,000", 2, "insertText");
    assert.equal(e.raw, "150000");
    assert.equal(e.display, "150,000");
    assert.equal(e.caret, 2);
  });
  it("backspace removes a digit and re-commas", () => {
    const e = applyMoneyEdit("10000", "10,00", 5, "deleteContentBackward"); // deleted last 0
    assert.equal(e.display, "1,000");
    assert.equal(e.caret, 5);
  });
  it("backspace over a comma deletes the digit before it instead of doing nothing", () => {
    // "10,000" caret right after the comma (index 3), Backspace removes the comma -> "10000", caret 2
    const e = applyMoneyEdit("10000", "10000", 2, "deleteContentBackward");
    assert.equal(e.raw, "1000");
    assert.equal(e.display, "1,000");
    assert.equal(e.caret, 1);
  });
  it("forward-delete over a comma deletes the digit after it", () => {
    // "10,000" caret before the comma (index 2), Delete removes the comma -> "10000", caret 2
    const e = applyMoneyEdit("10000", "10000", 2, "deleteContentForward");
    assert.equal(e.raw, "1000");
    assert.equal(e.display, "1,000");
    assert.equal(e.caret, 3); // "1,0|00": the caret stays between the same two digits
  });
  it("deleting everything gives an empty value", () => {
    const e = applyMoneyEdit("5", "", 0, "deleteContentBackward");
    assert.deepEqual(e, { raw: "", display: "", caret: 0 });
  });
  it("rejects letters without moving the caret", () => {
    const e = applyMoneyEdit("1000", "1,0a00", 4, "insertText"); // typed "a" after "1,0"
    assert.equal(e.raw, "1000");
    assert.equal(e.display, "1,000");
    assert.equal(e.caret, 3);
  });
  it("a typed point is dropped on whole-dollar fields and kept where cents are allowed", () => {
    assert.equal(applyMoneyEdit("1000", "1,000.", 6, "insertText").display, "1,000");
    const c = applyMoneyEdit("1000", "1,000.", 6, "insertText", { allowCents: true });
    assert.equal(c.display, "1,000.");
    assert.equal(c.caret, 6);
    assert.equal(applyMoneyEdit("1000.", "1,000.5", 7, "insertText", { allowCents: true }).raw, "1000.5");
    assert.equal(applyMoneyEdit("1000.55", "1,000.559", 9, "insertText", { allowCents: true }).raw, "1000.55", "no third decimal");
  });
  it("pasting $10,000.00", () => {
    const whole = applyMoneyEdit("", "$10,000.00", 10, "insertFromPaste");
    assert.equal(whole.raw, "10000");
    assert.equal(whole.display, "10,000");
    assert.equal(whole.caret, 6);
    const cents = applyMoneyEdit("", "$10,000.00", 10, "insertFromPaste", { allowCents: true });
    assert.equal(cents.raw, "10000.00");
    assert.equal(cents.display, "10,000.00");
    assert.equal(cents.caret, 9);
  });
  it("leading zeros and a leading point", () => {
    const z = applyMoneyEdit("0", "05", 2, "insertText");
    assert.equal(z.raw, "5");
    assert.equal(z.caret, 1);
    const p = applyMoneyEdit("", ".", 1, "insertText", { allowCents: true });
    assert.equal(p.raw, "0.");
    assert.equal(p.caret, 2);
  });
  it("negative values only where allowed", () => {
    assert.equal(applyMoneyEdit("", "-", 1, "insertText", { allowNegative: true }).raw, "-");
    const e = applyMoneyEdit("-100", "-1,000", 6, "insertText", { allowNegative: true });
    assert.equal(e.display, "-1,000");
    assert.equal(e.caret, 6);
    assert.equal(applyMoneyEdit("", "-", 1, "insertText").raw, "");
  });
});

describe("<MoneyInput> in jsdom", () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "InputEvent", "KeyboardEvent", "MouseEvent"]) define(k, w[k]);
    define("IS_REACT_ACT_ENVIRONMENT", true);
  });
  after(() => dom.window.close());

  async function mount(props: { allowCents?: boolean; allowNegative?: boolean; initial?: string; min?: number }) {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { MoneyInput } = await import("../components/MoneyInput");
    const doc = dom.window.document;
    const host = doc.getElementById("root")!;
    host.innerHTML = "";
    const submitted: string[] = [];
    function Form() {
      const [v, setV] = React.useState(props.initial ?? "");
      submitted.length = 0;
      submitted.push(v);
      return React.createElement(MoneyInput, { value: v, onValueChange: setV, allowCents: props.allowCents, allowNegative: props.allowNegative, "aria-label": "amt", min: props.min });
    }
    const root = createRoot(host);
    await act(async () => { root.render(React.createElement(Form)); });
    const input = host.querySelector("input") as HTMLInputElement;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    /** Replace [start,end) with `text` the way a browser edit does, then fire the input event. */
    const edit = async (start: number, end: number, text: string, inputType: string) => {
      const cur = input.value;
      const next = cur.slice(0, start) + text + cur.slice(end);
      const caret = start + text.length;
      await act(async () => {
        setter.call(input, next);
        input.setSelectionRange(caret, caret);
        input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, inputType, data: text }));
      });
    };
    const type = async (s: string) => { for (const ch of s) await edit(input.selectionStart!, input.selectionEnd!, ch, "insertText"); };
    const backspace = async () => {
      const [s, e] = [input.selectionStart!, input.selectionEnd!];
      if (s !== e) return edit(s, e, "", "deleteContentBackward");
      if (s > 0) return edit(s - 1, s, "", "deleteContentBackward");
    };
    const del = async () => {
      const [s, e] = [input.selectionStart!, input.selectionEnd!];
      if (s !== e) return edit(s, e, "", "deleteContentForward");
      if (s < input.value.length) return edit(s, s + 1, "", "deleteContentForward");
    };
    const caretTo = (n: number) => input.setSelectionRange(n, n);
    return { input, type, backspace, del, caretTo, edit, submitted, unmount: () => act(async () => root.unmount()) };
  }

  it("is a text box with the decimal keypad", async () => {
    const m = await mount({});
    assert.equal(m.input.type, "text");
    assert.equal(m.input.inputMode, "decimal");
    await m.unmount();
  });

  it("typing 10000 shows 10,000 and submits the plain number", async () => {
    const m = await mount({});
    await m.type("10000");
    assert.equal(m.input.value, "10,000");
    assert.equal(m.submitted[0], "10000");
    assert.equal(m.input.selectionStart, 6);
    await m.unmount();
  });

  it("typing digit by digit adds the comma exactly when needed", async () => {
    const m = await mount({});
    const seen: string[] = [];
    for (const ch of "1234567") { await m.type(ch); seen.push(m.input.value); }
    assert.deepEqual(seen, ["1", "12", "123", "1,234", "12,345", "123,456", "1,234,567"]);
    assert.equal(m.input.selectionStart, m.input.value.length);
    await m.unmount();
  });

  it("inserting in the middle keeps the caret next to the new digit", async () => {
    const m = await mount({ initial: "10000" });
    assert.equal(m.input.value, "10,000");
    m.caretTo(1);
    await m.type("5");
    assert.equal(m.input.value, "150,000");
    assert.equal(m.input.selectionStart, 2);
    await m.type("7");
    assert.equal(m.input.value, "1,570,000");
    assert.equal(m.input.selectionStart, 4); // "1,57|0,000"
    assert.equal(m.submitted[0], "1570000");
    await m.unmount();
  });

  it("backspace deletes through commas and keeps the caret", async () => {
    const m = await mount({ initial: "1234567" }); // 1,234,567
    await m.backspace();
    assert.equal(m.input.value, "123,456");
    m.caretTo(4); // right after the comma in "123,456"
    await m.backspace(); // over the comma -> removes the 3
    assert.equal(m.input.value, "12,456");
    assert.equal(m.input.selectionStart, 2);
    assert.equal(m.submitted[0], "12456");
    await m.unmount();
  });

  it("forward delete over a comma removes the next digit", async () => {
    const m = await mount({ initial: "10000" }); // 10,000
    m.caretTo(2);
    await m.del();
    assert.equal(m.input.value, "1,000");
    assert.equal(m.input.selectionStart, 3);
    assert.equal(m.submitted[0], "1000");
    await m.unmount();
  });

  it("deleting everything submits an empty string", async () => {
    const m = await mount({ initial: "250" });
    await m.backspace(); await m.backspace(); await m.backspace();
    assert.equal(m.input.value, "");
    assert.equal(m.submitted[0], "");
    await m.unmount();
  });

  it("selecting all and typing replaces the value", async () => {
    const m = await mount({ initial: "10000" });
    await m.edit(0, 6, "7", "insertText");
    assert.equal(m.input.value, "7");
    assert.equal(m.submitted[0], "7");
    await m.unmount();
  });

  it("pasting $10,000.00 works on both whole-dollar and cents fields", async () => {
    const whole = await mount({});
    await whole.edit(0, 0, "$10,000.00", "insertFromPaste");
    assert.equal(whole.input.value, "10,000");
    assert.equal(whole.submitted[0], "10000");
    await whole.unmount();
    const cents = await mount({ allowCents: true });
    await cents.edit(0, 0, "$10,000.00", "insertFromPaste");
    assert.equal(cents.input.value, "10,000.00");
    assert.equal(cents.submitted[0], "10000.00");
    assert.equal(cents.input.selectionStart, 9);
    await cents.unmount();
  });

  it("cents: two decimals at most, only where the field allows", async () => {
    const m = await mount({ allowCents: true });
    await m.type("1234.567");
    assert.equal(m.input.value, "1,234.56");
    assert.equal(m.submitted[0], "1234.56");
    await m.unmount();
    const whole = await mount({});
    await whole.type("12.5");
    assert.equal(whole.input.value, "125");
    await whole.unmount();
  });

  it("letters are ignored and the caret stays put", async () => {
    const m = await mount({ initial: "1000" });
    m.caretTo(2);
    await m.type("x");
    assert.equal(m.input.value, "1,000");
    assert.equal(m.input.selectionStart, 2);
    await m.unmount();
  });

  it("negative sign only where allowed", async () => {
    const neg = await mount({ allowNegative: true });
    await neg.type("-2500");
    assert.equal(neg.input.value, "-2,500");
    assert.equal(neg.submitted[0], "-2500");
    await neg.unmount();
    const pos = await mount({});
    await pos.type("-2500");
    assert.equal(pos.input.value, "2,500");
    await pos.unmount();
  });

  it("passes min/max and other attributes through so validation is unchanged", async () => {
    const m = await mount({ min: 0 });
    assert.equal(m.input.getAttribute("min"), "0");
    assert.equal(m.input.getAttribute("aria-label"), "amt");
    await m.unmount();
  });
});

describe("a field whose state is a number, and a real dealer form", () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "InputEvent", "KeyboardEvent", "MouseEvent"]) define(k, w[k]);
    define("IS_REACT_ACT_ENVIRONMENT", true);
  });
  after(() => dom.window.close());

  const typeInto = async (input: HTMLInputElement, text: string) => {
    const { act } = await import("react");
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    for (const ch of text) {
      const s = input.selectionStart!;
      const next = input.value.slice(0, s) + ch + input.value.slice(input.selectionEnd!);
      await act(async () => {
        setter.call(input, next);
        input.setSelectionRange(s + 1, s + 1);
        input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }));
      });
    }
  };

  it("a Number() state keeps a half-typed '12.' and ends on the right number", async () => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { MoneyInput } = await import("../components/MoneyInput");
    const host = dom.window.document.getElementById("root")!;
    let latest = -1;
    function Host() {
      const [n, setN] = React.useState(0);
      latest = n;
      return React.createElement(MoneyInput, { value: n, allowCents: true, onValueChange: (v: string) => setN(Number(v)) });
    }
    const root = createRoot(host);
    await act(async () => { root.render(React.createElement(Host)); });
    const input = host.querySelector("input") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    await typeInto(input, "12500.5");
    assert.equal(input.value, "12,500.5");
    assert.equal(latest, 12500.5);
    await act(async () => root.unmount());
  });

  it("the dealer trade-allowance fields show commas, and the form state / payload stay plain numbers", async () => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { TradeAllowanceFields } = await import("../components/trade/TradeAllowanceFields");
    const { emptyTradeForm, tradeFormPayload, toNum } = await import("./trade/dealerForm");
    const host = dom.window.document.getElementById("root")!;
    let state = emptyTradeForm();
    function Host() {
      const [s, setS] = React.useState(emptyTradeForm());
      state = s;
      return React.createElement(TradeAllowanceFields, { state: s, set: (p: Partial<typeof s>) => setS((c) => ({ ...c, ...p })), trade: { ownership: "owned", payoffEstimate: 0, sharePayoff: true } as never });
    }
    const root = createRoot(host);
    await act(async () => { root.render(React.createElement(Host)); });
    const single = host.querySelector<HTMLInputElement>('[data-testid="allowance-single"]')!;
    single.focus();
    await typeInto(single, "18500");
    assert.equal(single.value, "18,500");
    assert.equal(state.single, "18500");
    assert.equal(toNum(state.single), 18500);
    assert.equal(single.inputMode, "decimal");
    assert.deepEqual((tradeFormPayload(state) as { allowance: unknown }).allowance, { mode: "single", single: "18500" }, "the submitted allowance is the plain number, no commas");
    await act(async () => root.unmount());
  });
});

describe("which fields use the shared money input", () => {
  const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const dollars = [
    "components/UsedQuoteForm.tsx", "components/LeaseCalculatorForm.tsx", "components/LeaseCalculatorSheet.tsx", "components/CounterSheetForm.tsx",
    "components/trade/TradeAllowanceFields.tsx", "components/trade/DealerTradeConfirm.tsx", "components/trade/TradeInStep.tsx",
    "components/TradeInSubmissionModal.tsx", "components/TradeInAppraisalPanel.tsx", "components/StagedDeals.tsx", "components/DealerStagePanel.tsx",
    "components/AcceptCounterPanel.tsx", "components/BiddingWizard.tsx", "components/DealerPortal.tsx", "components/OfferCompareView.tsx",
    "components/AiNegotiatorAssistant.tsx", "app/rfq/[id]/page.tsx", "app/admin/approvals/ApprovalsClient.tsx",
  ];
  for (const f of dollars) it(`${f} uses MoneyInput`, () => assert.match(read(f), /MoneyInput/));

  it("non-dollar fields stay plain: no commas in VIN, ZIP, mileage, APR, percent or money factor", () => {
    assert.match(read("components/trade/TradeInStep.tsx"), /id="trade-mileage" inputMode="numeric"/);
    assert.match(read("components/trade/TradeInStep.tsx"), /id="trade-zip" inputMode="numeric"/);
    assert.match(read("components/StagedDeals.tsx"), /<input inputMode="decimal" aria-label="Your APR"/);
    assert.match(read("components/DealerStagePanel.tsx"), /<input inputMode="decimal" aria-label="APR percent"/);
    assert.match(read("components/UsedQuoteForm.tsx"), /formatPercentInput\(raw\)/);
    assert.match(read("components/OfferCompareView.tsx"), /step="0\.0001"/);
  });
});
