import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleUndoRedoKeydown,
  type KeyboardShortcutCallbacks,
} from "@/lib/undo-redo-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let undoFn: ReturnType<typeof vi.fn>;
let redoFn: ReturnType<typeof vi.fn>;
let callbacks: KeyboardShortcutCallbacks;

beforeEach(() => {
  undoFn = vi.fn();
  redoFn = vi.fn();
  callbacks = { undo: undoFn, redo: redoFn };
});

/** Build a minimal KeyboardEvent-like object for testing. */
function makeKeyEvent(
  overrides: Partial<KeyboardEvent> & { target?: Partial<HTMLElement> } = {}
): KeyboardEvent {
  const { target, ...rest } = overrides;
  const targetEl = {
    tagName: "DIV",
    isContentEditable: false,
    ...target,
  } as HTMLElement;

  return {
    key: "z",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    target: targetEl,
    ...rest,
  } as unknown as KeyboardEvent;
}

// ---------------------------------------------------------------------------
// Task 6.2 – Keyboard shortcut handling
// Validates: Requirements 5.1, 5.2, 5.3
// ---------------------------------------------------------------------------

describe("Task 6.2 – Keyboard shortcut handling", () => {
  // ---- Req 5.1: Ctrl+Z triggers undo when no text input focused -----------

  describe("Ctrl+Z triggers undo (Req 5.1)", () => {
    it("calls undo when Ctrl+Z is pressed on a non-input element", () => {
      // Stub navigator.platform to non-Mac
      vi.stubGlobal("navigator", { platform: "Win32" });

      const e = makeKeyEvent({ ctrlKey: true, key: "z" });
      const handled = handleUndoRedoKeydown(e, callbacks);

      expect(handled).toBe(true);
      expect(undoFn).toHaveBeenCalledOnce();
      expect(redoFn).not.toHaveBeenCalled();
      expect(e.preventDefault).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("calls undo when Cmd+Z is pressed on macOS", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });

      const e = makeKeyEvent({ metaKey: true, key: "z" });
      const handled = handleUndoRedoKeydown(e, callbacks);

      expect(handled).toBe(true);
      expect(undoFn).toHaveBeenCalledOnce();
      expect(redoFn).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  // ---- Req 5.2: Ctrl+Shift+Z triggers redo when no text input focused -----

  describe("Ctrl+Shift+Z triggers redo (Req 5.2)", () => {
    it("calls redo when Ctrl+Shift+Z is pressed on a non-input element", () => {
      vi.stubGlobal("navigator", { platform: "Win32" });

      const e = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "z" });
      const handled = handleUndoRedoKeydown(e, callbacks);

      expect(handled).toBe(true);
      expect(redoFn).toHaveBeenCalledOnce();
      expect(undoFn).not.toHaveBeenCalled();
      expect(e.preventDefault).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("calls redo when Cmd+Shift+Z is pressed on macOS", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });

      const e = makeKeyEvent({ metaKey: true, shiftKey: true, key: "z" });
      const handled = handleUndoRedoKeydown(e, callbacks);

      expect(handled).toBe(true);
      expect(redoFn).toHaveBeenCalledOnce();
      expect(undoFn).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  // ---- Req 5.3: Shortcuts suppressed on text inputs -----------------------

  describe("Shortcuts suppressed on text inputs (Req 5.3)", () => {
    it("does NOT call undo when target is an INPUT element", () => {
      vi.stubGlobal("navigator", { platform: "Win32" });

      const e = makeKeyEvent({
        ctrlKey: true,
        key: "z",
        target: { tagName: "INPUT", isContentEditable: false },
      });
      const handled = handleUndoRedoKeydown(e, callbacks);

      expect(handled).toBe(false);
      expect(undoFn).not.toHaveBeenCalled();
      expect(redoFn).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("does NOT call undo when target is a TEXTAREA element", () => {
      vi.stubGlobal("navigator", { platform: "Win32" });

      const e = makeKeyEvent({
        ctrlKey: true,
        key: "z",
        target: { tagName: "TEXTAREA", isContentEditable: false },
      });
      const handled = handleUndoRedoKeydown(e, callbacks);

      expect(handled).toBe(false);
      expect(undoFn).not.toHaveBeenCalled();
      expect(redoFn).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("does NOT call undo when target is a contentEditable element", () => {
      vi.stubGlobal("navigator", { platform: "Win32" });

      const e = makeKeyEvent({
        ctrlKey: true,
        key: "z",
        target: { tagName: "DIV", isContentEditable: true },
      });
      const handled = handleUndoRedoKeydown(e, callbacks);

      expect(handled).toBe(false);
      expect(undoFn).not.toHaveBeenCalled();
      expect(redoFn).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("does NOT call redo when target is an INPUT element", () => {
      vi.stubGlobal("navigator", { platform: "Win32" });

      const e = makeKeyEvent({
        ctrlKey: true,
        shiftKey: true,
        key: "z",
        target: { tagName: "INPUT", isContentEditable: false },
      });
      const handled = handleUndoRedoKeydown(e, callbacks);

      expect(handled).toBe(false);
      expect(redoFn).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  // ---- Edge cases: unrelated keys are ignored -----------------------------

  describe("Unrelated keys are ignored", () => {
    it("does not trigger on Ctrl+A", () => {
      vi.stubGlobal("navigator", { platform: "Win32" });

      const e = makeKeyEvent({ ctrlKey: true, key: "a" });
      const handled = handleUndoRedoKeydown(e, callbacks);

      expect(handled).toBe(false);
      expect(undoFn).not.toHaveBeenCalled();
      expect(redoFn).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("does not trigger on plain Z without modifier", () => {
      vi.stubGlobal("navigator", { platform: "Win32" });

      const e = makeKeyEvent({ key: "z" });
      const handled = handleUndoRedoKeydown(e, callbacks);

      expect(handled).toBe(false);
      expect(undoFn).not.toHaveBeenCalled();
      expect(redoFn).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });
});
