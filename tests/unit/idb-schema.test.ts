import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { getDB, _resetDB } from "@/lib/idb-cache";

/**
 * Smoke test for IndexedDB schema.
 * Validates: Requirements 2.1, 2.5
 */
describe("IndexedDB schema smoke test", () => {
  beforeEach(() => {
    _resetDB();
  });

  const EXPECTED_STORES = [
    "workItems",
    "iterations",
    "teamMembers",
    "savedViews",
    "syncMetadata",
    "workItemTags",
    "viewHiddenItems",
    "workItemLinks",
    "syncAreaPaths",
  ] as const;

  it("should create all 9 object stores", async () => {
    const db = await getDB();
    const storeNames = Array.from(db.objectStoreNames);
    for (const store of EXPECTED_STORES) {
      expect(storeNames, `missing store: ${store}`).toContain(store);
    }
    expect(storeNames).toHaveLength(9);
  });

  it("should have all 7 indexes on workItems store", async () => {
    const db = await getDB();
    const tx = db.transaction("workItems", "readonly");
    const store = tx.objectStore("workItems");
    const indexNames = Array.from(store.indexNames);

    const expected = [
      "by-state",
      "by-assignedTo",
      "by-iterationPath",
      "by-parentId",
      "by-epicId",
      "by-featureId",
      "by-initiativeId",
    ];
    for (const idx of expected) {
      expect(indexNames, `missing index: ${idx}`).toContain(idx);
    }
    expect(indexNames).toHaveLength(7);
    await tx.done;
  });

  it("should have by-sortOrder index on savedViews store", async () => {
    const db = await getDB();
    const tx = db.transaction("savedViews", "readonly");
    const store = tx.objectStore("savedViews");
    expect(Array.from(store.indexNames)).toContain("by-sortOrder");
    await tx.done;
  });

  it("should have by-tag index on workItemTags store", async () => {
    const db = await getDB();
    const tx = db.transaction("workItemTags", "readonly");
    const store = tx.objectStore("workItemTags");
    expect(Array.from(store.indexNames)).toContain("by-tag");
    await tx.done;
  });

  it("should have by-viewId index on viewHiddenItems store", async () => {
    const db = await getDB();
    const tx = db.transaction("viewHiddenItems", "readonly");
    const store = tx.objectStore("viewHiddenItems");
    expect(Array.from(store.indexNames)).toContain("by-viewId");
    await tx.done;
  });

  it("should have by-sourceId and by-targetId indexes on workItemLinks store", async () => {
    const db = await getDB();
    const tx = db.transaction("workItemLinks", "readonly");
    const store = tx.objectStore("workItemLinks");
    const indexNames = Array.from(store.indexNames);
    expect(indexNames).toContain("by-sourceId");
    expect(indexNames).toContain("by-targetId");
    await tx.done;
  });
});
