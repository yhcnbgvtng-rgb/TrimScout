"use client";

// A combobox shared by every primary /search filter (State, Make, Model, Trim, Factory options):
// the trigger itself IS the text field, always typeable — not a button you must click before a
// separate search box appears. Follows the WAI-ARIA combobox pattern (role="combobox" on the
// input, role="listbox" on the popup, aria-activedescendant tracking the arrow-keyed row) so
// State/Make/Model/Trim can be tabbed to and typed into immediately, with ArrowUp/ArrowDown/Enter
// to select without touching the mouse. A live hit-count shows on every row and on the closed
// trigger once a value is picked — e.g. `NJ · 84,210`. Quiet slate chrome with a soft blue
// selected/hover state (never the admin sheet's emerald "shouty chip" look — a deliberate,
// separate style for this buyer-facing page). Supports both single-select (State/Make/Model/Trim)
// and multi-select (factory options) through the same component so the two behave identically
// otherwise.
//
// Confirmed live 2026-09-27: an earlier version used a plain <button> trigger that opened a
// popover containing a separate search <input>, auto-focused via a useEffect + setTimeout(0).
// That auto-focus is exactly the kind of call mobile Safari silently drops — it only honors
// .focus() (and the keyboard it triggers) when called synchronously within the user gesture that
// caused it, and a setTimeout callback runs on a later task, outside that gesture. It also meant
// Tab could never reach a typeable field directly (a native <button> discards keystrokes), which
// is what "click or tab -> can type" in the report actually required. Making the trigger itself
// the input sidesteps both: focus already IS the gesture, and Tab lands somewhere typeable.

import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
  /** In-stock vehicles matching this option under the CURRENT filters — not a global count. */
  count: number;
}

interface BaseProps {
  label: string;
  placeholder: string;
  options: DropdownOption[];
  loading?: boolean;
  /** Shown in place of the trigger when the filter isn't unlocked yet — kept out of the DOM entirely by the caller otherwise (progressive-unlock). */
  disabledHint?: string;
  /**
   * Shown instead of the generic "No matches." when `options` itself is empty (not loading) —
   * i.e. there's genuinely nothing to search, as opposed to a search term matching nothing. Lets
   * a caller distinguish "this data doesn't exist yet" from "try a different search term," which
   * look identical without this — e.g. factory options for a make/model the crawler hasn't
   * captured any option data for yet vs. a real search with no results.
   */
  emptyMessage?: string;
}

interface SingleProps extends BaseProps {
  multi?: false;
  value: string;
  onChange: (value: string) => void;
}

interface MultiProps extends BaseProps {
  multi: true;
  value: string[];
  onChange: (value: string[]) => void;
}

type Props = SingleProps | MultiProps;

export default function SearchableDropdown(props: Props) {
  const { label, placeholder, options, loading, disabledHint, emptyMessage } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const getOptionId = (value: string) => `${listboxId}-opt-${value}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const selectedSet = props.multi ? new Set(props.value) : null;

  const triggerText = useMemo(() => {
    if (!props.multi) {
      const opt = options.find((o) => o.value === props.value);
      if (!props.value) return "";
      return opt ? `${opt.label} · ${opt.count.toLocaleString()}` : props.value;
    }
    if (props.value.length === 0) return "";
    // The intersection of several must-have options can never exceed the smallest individual
    // option's own count — showing that minimum is an honest upper bound on the real combined
    // result, not a sum that would overstate it.
    const picked = options.filter((o) => selectedSet!.has(o.value));
    const minCount = picked.length ? Math.min(...picked.map((o) => o.count)) : 0;
    return `${props.value.length} option${props.value.length === 1 ? "" : "s"} · ${minCount.toLocaleString()}`;
  }, [props.multi, props.value, options, selectedSet]);

  const hasValue = props.multi ? props.value.length > 0 : Boolean(props.value);

  if (disabledHint) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">{label}</span>
        <div
          title={disabledHint}
          className="flex w-full cursor-not-allowed items-center justify-between rounded-xl border border-border bg-surface/50 px-3 py-2.5 text-sm text-ink-faint"
        >
          <span>{disabledHint}</span>
        </div>
      </div>
    );
  }

  const openMenu = () => {
    if (open) return;
    setOpen(true);
    setQuery("");
    setActiveIndex(-1);
  };

  const closeMenu = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  };

  const selectSingle = (value: string) => {
    if (props.multi) return;
    props.onChange(props.value === value ? "" : value);
    closeMenu();
    inputRef.current?.blur();
  };

  const toggleMulti = (value: string) => {
    if (!props.multi) return;
    const next = selectedSet!.has(value) ? props.value.filter((v) => v !== value) : [...props.value, value];
    props.onChange(next);
  };

  const selectAt = (index: number) => {
    const o = filtered[index];
    if (!o) return;
    props.multi ? toggleMulti(o.value) : selectSingle(o.value);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    props.multi ? props.onChange([]) : props.onChange("");
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return openMenu();
      setActiveIndex((i) => (i + 1 >= filtered.length ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openMenu();
      setActiveIndex((i) => (i - 1 < 0 ? filtered.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && activeIndex >= 0) selectAt(activeIndex);
    } else if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        closeMenu();
        inputRef.current?.blur();
      }
    } else if (e.key === "Tab") {
      closeMenu();
    }
  };

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={listboxId} className="text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">
        {label}
      </label>
      <div
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
          hasValue ? "border-sky-500/50 bg-sky-950/20" : "border-border bg-surface-elevated focus-within:border-border-strong"
        }`}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          id={listboxId}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listboxId}-listbox`}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? getOptionId(filtered[activeIndex]?.value ?? "") : undefined}
          autoComplete="off"
          value={open ? query : triggerText}
          placeholder={hasValue ? undefined : placeholder}
          onFocus={openMenu}
          onClick={openMenu}
          onChange={(e) => {
            if (!open) setOpen(true);
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={closeMenu}
          className="w-full min-w-0 truncate bg-transparent text-sm font-semibold text-white placeholder:font-normal placeholder:text-ink-light focus:outline-none"
        />
        {hasValue && !open && (
          <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={clear} aria-label={`Clear ${label}`} className="shrink-0 text-ink-faint hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </div>

      {open && (
        <div
          id={`${listboxId}-listbox`}
          role="listbox"
          aria-multiselectable={props.multi || undefined}
          className="absolute left-0 top-full z-30 mt-1.5 max-h-64 w-72 max-w-[90vw] overflow-y-auto rounded-xl border border-border-strong bg-surface-elevated py-1 shadow-2xl"
        >
          {loading ? (
            <div className="px-3 py-4 text-center text-xs text-ink-faint">Loading…</div>
          ) : options.length === 0 && emptyMessage ? (
            <div className="px-3 py-4 text-center text-xs text-ink-faint">{emptyMessage}</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-ink-faint">No matches.</div>
          ) : (
            filtered.map((o, idx) => {
              const selected = props.multi ? selectedSet!.has(o.value) : props.value === o.value;
              const active = idx === activeIndex;
              const zero = o.count === 0;
              return (
                <button
                  key={o.value}
                  id={getOptionId(o.value)}
                  role="option"
                  aria-selected={selected}
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => selectAt(idx)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors ${
                    selected ? "bg-sky-500/15 text-sky-300" : active ? "bg-surface text-white" : zero ? "text-ink-faint hover:bg-surface" : "text-ink-light hover:bg-surface"
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    {props.multi && (
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          selected ? "border-sky-400 bg-sky-500/30" : "border-border"
                        }`}
                      >
                        {selected && <span className="h-1.5 w-1.5 rounded-sm bg-sky-300" />}
                      </span>
                    )}
                    <span className="truncate">{o.label}</span>
                  </span>
                  <span className={`shrink-0 tabular-nums ${selected ? "text-sky-300/80" : "text-ink-faint"}`}>{o.count.toLocaleString()}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
