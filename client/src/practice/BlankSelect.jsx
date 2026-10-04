import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

// The word picker inside a Fill in the Blanks blank.
//
// This replaces a native <select>. An <option> accepts almost no styling — padding and font-size
// are ignored by most browsers, and the open list is drawn by the operating system — so the list
// could never be made to match the rest of the product no matter what CSS was written for it.
// The native control also drew its own focus border, in the system accent colour, which is what
// kept reappearing around a focused blank after every attempt to remove it.
//
// It is a listbox, built to the ARIA pattern rather than approximated:
//   - the trigger is a button with role="combobox", aria-expanded and aria-controls
//   - the popup is role="listbox", each word role="option" with aria-selected
//   - Enter / Space / Arrow opens; Arrows move; Enter or Space picks; Escape closes and returns
//     focus to the trigger; Tab or an outside click closes without changing the answer
// Keyboard users keep everything a <select> gave them, and screen readers are told the same story.

export default function BlankSelect({ options, value, onChange, disabled, label, placeholder = "" }) {
  const [open, setOpen] = useState(false);
  // Which option the keyboard is on, which is NOT the chosen one — moving through the list must
  // not change the answer until the student commits to it.
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const chosen = value === null || value === undefined ? -1 : Number(value);
  const chosenLabel = chosen >= 0 ? options[chosen] : "";

  const close = useCallback((returnFocus) => {
    setOpen(false);
    setActive(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // An outside click or a scroll of the page closes the list. Bound only while it is open, so a
  // passage of twelve blanks is not eleven idle document listeners.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) close(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  // Keeps the active option in view when arrowing past the edge of a scrolling list.
  useEffect(() => {
    if (!open || active < 0) return;
    // Guarded: jsdom does not implement scrollIntoView, and this is a convenience, not behaviour.
    const option = listRef.current?.children[active];
    if (typeof option?.scrollIntoView === "function") option.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openList(startAt) {
    if (disabled) return;
    setOpen(true);
    setActive(startAt ?? (chosen >= 0 ? chosen : 0));
  }

  function pick(index) {
    onChange(index);
    close(true);
  }

  function onTriggerKeyDown(event) {
    if (disabled) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ":
        event.preventDefault();
        openList(event.key === "ArrowUp" ? options.length - 1 : undefined);
        break;
      default:
        break;
    }
  }

  function onListKeyDown(event) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => (i - 1 + options.length) % options.length);
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (active >= 0) pick(active);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  }

  return (
    <span className="blank-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="blank-select__trigger"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={chosenLabel ? "blank-select__value" : "blank-select__value is-empty"}>
          {chosenLabel || placeholder}
        </span>
        <ChevronDown size={14} className="blank-select__caret" aria-hidden="true" />
      </button>

      {open && (
        <ul
          id={listId}
          className="blank-select__list"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          // Focus moves to the list so the arrow keys have somewhere to land. A <ul> cannot carry
          // autoFocus, so it is focused as the ref is attached.
          ref={(node) => {
            listRef.current = node;
            if (node && document.activeElement !== node) node.focus();
          }}
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={index}
              role="option"
              aria-selected={index === chosen}
              className={[
                "blank-select__option",
                index === chosen && "is-chosen",
                index === active && "is-active"
              ].filter(Boolean).join(" ")}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(index)}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
