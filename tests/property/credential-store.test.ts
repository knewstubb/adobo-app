import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import type { AdoCredentials } from "@/lib/credential-store";

/**
 * **Validates: Requirements 1.4**
 *
 * Property 1: Credential store round-trip
 * For any valid AdoCredentials object (with arbitrary non-empty org, project,
 * team, and PAT strings), storing via setCredentials() and retrieving via
 * getCredentials() should produce an object deeply equal to the original.
 */

// In-memory localStorage mock for Node.js
function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

// Arbitrary that generates AdoCredentials with non-empty strings
const arbAdoCredentials: fc.Arbitrary<AdoCredentials> = fc.record({
  org: fc.string({ minLength: 1 }),
  project: fc.string({ minLength: 1 }),
  team: fc.string({ minLength: 1 }),
  pat: fc.string({ minLength: 1 }),
});

describe("Credential Store — Property Tests", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createLocalStorageMock();
    vi.stubGlobal("localStorage", mockStorage);
  });

  it("Property 1: setCredentials then getCredentials round-trips any AdoCredentials", async () => {
    // Dynamic import so the module picks up the stubbed localStorage
    const { setCredentials, getCredentials } = await import(
      "@/lib/credential-store"
    );

    fc.assert(
      fc.property(arbAdoCredentials, (creds) => {
        setCredentials(creds);
        const retrieved = getCredentials();
        expect(retrieved).toEqual(creds);
      }),
      { numRuns: 100 }
    );
  });
});
