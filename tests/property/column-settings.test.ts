import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  type ColKey,
  type ColumnSettings,
  ALL_COLUMNS,
  GANTT_DEFAULT_COLUMNS,
  LIST_DEFAULT_COLUMNS,
  GANTT_COL_KEY,
  LIST_COL_KEY,
  readColumnSettings,
  writeColumnSettings,
} from "@/components/ColumnsMenu";

// Mock localStorage for Node environment
class MockStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  key(index: number) { return [...this.store.keys()][index] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

// Install mock before each test
beforeEach(() => {
  const mock = new MockStorage();
  Object.defineProperty(globalThis, "localStorage", { value: mock, writable: true, configurable: true });
});

/** Arbitrary that generates a random subset of ALL_COLUMNS (always including "title") */
const arbVisibleColumns: fc.Arbitrary<ColKey[]> = fc
  .subarray([...ALL_COLUMNS] as ColKey[], { minLength: 0 })
  .map(cols => (cols.includes("title") ? cols : ["title" as ColKey, ...cols]));

/** Arbitrary that generates a valid ColumnSettings object */
const arbColumnSettings: fc.Arbitrary<ColumnSettings> = arbVisibleColumns.map(cols => ({
  visibleColumns: cols,
}));

/** Arbitrary that picks one of the two storage keys */
const arbStorageKey = fc.constantFrom(GANTT_COL_KEY, LIST_COL_KEY);

/**
 * Property 4: Column toggle-visibility correspondence
 *
 * For any column key and any toggle state (on/off), the column is rendered
 * in the active view if and only if its toggle is in the "on" position.
 *
 * We verify this by writing column settings and reading them back — the
 * read result must match what was written.
 *
 * **Validates: Requirements 12.2, 12.3**
 */
describe("P4: Column visibility matches toggle state", () => {
  it("reading column settings returns what was written", () => {
    fc.assert(
      fc.property(arbStorageKey, arbColumnSettings, (key, settings) => {
        writeColumnSettings(key, settings);
        const read = readColumnSettings(key, GANTT_DEFAULT_COLUMNS);
        expect(read.visibleColumns).toEqual(settings.visibleColumns);
      }),
      { numRuns: 200 },
    );
  });

  it("a column is visible iff it was included in visibleColumns", () => {
    fc.assert(
      fc.property(
        arbStorageKey,
        arbColumnSettings,
        fc.constantFrom(...ALL_COLUMNS),
        (key, settings, col) => {
          writeColumnSettings(key, settings);
          const read = readColumnSettings(key, GANTT_DEFAULT_COLUMNS);
          const isVisible = read.visibleColumns.includes(col);
          const wasSet = settings.visibleColumns.includes(col);
          expect(isVisible).toBe(wasSet);
        },
      ),
      { numRuns: 200 },
    );
  });
});

/**
 * Property 5: Per-view column isolation
 *
 * For any sequence of column toggle changes applied to one view (Gantt or List),
 * the other view's column settings SHALL remain unchanged.
 *
 * **Validates: Requirements 12.5**
 */
describe("P5: Toggling columns in one view does not affect the other view", () => {
  it("writing to gantt key does not change list key", () => {
    fc.assert(
      fc.property(arbColumnSettings, arbColumnSettings, (ganttSettings, listSettings) => {
        // Set up both views
        writeColumnSettings(GANTT_COL_KEY, ganttSettings);
        writeColumnSettings(LIST_COL_KEY, listSettings);

        // Modify gantt settings
        const newGantt: ColumnSettings = { visibleColumns: [...ALL_COLUMNS] };
        writeColumnSettings(GANTT_COL_KEY, newGantt);

        // List settings must be unchanged
        const listRead = readColumnSettings(LIST_COL_KEY, LIST_DEFAULT_COLUMNS);
        expect(listRead.visibleColumns).toEqual(listSettings.visibleColumns);
      }),
      { numRuns: 200 },
    );
  });

  it("writing to list key does not change gantt key", () => {
    fc.assert(
      fc.property(arbColumnSettings, arbColumnSettings, (ganttSettings, listSettings) => {
        writeColumnSettings(GANTT_COL_KEY, ganttSettings);
        writeColumnSettings(LIST_COL_KEY, listSettings);

        // Modify list settings
        const newList: ColumnSettings = { visibleColumns: ["title"] };
        writeColumnSettings(LIST_COL_KEY, newList);

        // Gantt settings must be unchanged
        const ganttRead = readColumnSettings(GANTT_COL_KEY, GANTT_DEFAULT_COLUMNS);
        expect(ganttRead.visibleColumns).toEqual(ganttSettings.visibleColumns);
      }),
      { numRuns: 200 },
    );
  });
});

/**
 * Property 6: Column settings localStorage round-trip
 *
 * For any valid ColumnSettings object, writing it to localStorage and
 * reading it back SHALL produce an equivalent object.
 *
 * **Validates: Requirements 12.6**
 */
describe("P6: Column settings survive localStorage round-trip", () => {
  it("write then read produces equivalent settings", () => {
    fc.assert(
      fc.property(arbStorageKey, arbColumnSettings, (key, settings) => {
        writeColumnSettings(key, settings);
        const read = readColumnSettings(key, GANTT_DEFAULT_COLUMNS);
        expect(read).toEqual(settings);
      }),
      { numRuns: 200 },
    );
  });

  it("defaults are returned when localStorage is empty", () => {
    const ganttRead = readColumnSettings(GANTT_COL_KEY, GANTT_DEFAULT_COLUMNS);
    expect(ganttRead.visibleColumns).toEqual(GANTT_DEFAULT_COLUMNS);

    const listRead = readColumnSettings(LIST_COL_KEY, LIST_DEFAULT_COLUMNS);
    expect(listRead.visibleColumns).toEqual(LIST_DEFAULT_COLUMNS);
  });

  it("defaults are returned when localStorage contains corrupt data", () => {
    localStorage.setItem(GANTT_COL_KEY, "not-valid-json{{{");
    const read = readColumnSettings(GANTT_COL_KEY, GANTT_DEFAULT_COLUMNS);
    expect(read.visibleColumns).toEqual(GANTT_DEFAULT_COLUMNS);
  });
});
