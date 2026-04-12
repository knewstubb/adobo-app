import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getHeaders } from "@/lib/ado-connector";
import type { AdoCredentials } from "@/lib/credential-store";

/**
 * **Validates: Requirements 3.2, 8.1**
 *
 * Property 2: Auth header construction
 * For any AdoCredentials object, getHeaders(creds) should return an
 * Authorization header whose value equals "Basic " + btoa(":" + creds.pat),
 * and the base64 portion should be valid (decodable via atob).
 */

// Arbitrary that generates AdoCredentials with non-empty strings
const arbAdoCredentials: fc.Arbitrary<AdoCredentials> = fc.record({
  org: fc.string({ minLength: 1 }),
  project: fc.string({ minLength: 1 }),
  team: fc.string({ minLength: 1 }),
  pat: fc.string({ minLength: 1 }),
});

describe("ADO Connector — Property Tests", () => {
  it("Property 2: getHeaders produces correct Basic auth header for any credentials", () => {
    fc.assert(
      fc.property(arbAdoCredentials, (creds) => {
        const headers = getHeaders(creds) as Record<string, string>;

        // Authorization header equals "Basic " + btoa(":" + creds.pat)
        const expectedToken = btoa(":" + creds.pat);
        expect(headers.Authorization).toBe(`Basic ${expectedToken}`);

        // The base64 portion is valid (atob should not throw)
        const base64Part = headers.Authorization.replace("Basic ", "");
        expect(() => atob(base64Part)).not.toThrow();

        // Decoded value matches the original ":" + pat
        const decoded = atob(base64Part);
        expect(decoded).toBe(":" + creds.pat);
      }),
      { numRuns: 100 }
    );
  });
});
