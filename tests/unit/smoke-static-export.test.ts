import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_DIR = path.resolve(__dirname, "../../src");

/** Recursively collect all .ts and .tsx files under a directory */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function grepFiles(files: string[], pattern: RegExp): { file: string; line: number; text: string }[] {
  const matches: { file: string; line: number; text: string }[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    lines.forEach((text, idx) => {
      if (pattern.test(text)) {
        matches.push({ file: path.relative(SRC_DIR, file), line: idx + 1, text: text.trim() });
      }
    });
  }
  return matches;
}

describe("Smoke tests for static export", () => {
  const sourceFiles = collectSourceFiles(SRC_DIR);

  /**
   * Validates: Requirements 7.5
   * No Supabase client library should be imported in production source code.
   */
  it("should have zero imports of @supabase/supabase-js in src/", () => {
    const matches = grepFiles(sourceFiles, /@supabase\/supabase-js/);
    expect(matches, `Found @supabase/supabase-js references:\n${JSON.stringify(matches, null, 2)}`).toHaveLength(0);
  });

  /**
   * Validates: Requirements 7.4
   * No Node.js Buffer API should be used in client code.
   */
  it("should have zero uses of Buffer.from in src/", () => {
    const matches = grepFiles(sourceFiles, /Buffer\.from/);
    expect(matches, `Found Buffer.from references:\n${JSON.stringify(matches, null, 2)}`).toHaveLength(0);
  });

  /**
   * Validates: Requirements 7.4
   * No server-side ADO env vars should be referenced in client code.
   */
  it("should have zero references to process.env.ADO_ in src/", () => {
    const matches = grepFiles(sourceFiles, /process\.env\.ADO_/);
    expect(matches, `Found process.env.ADO_ references:\n${JSON.stringify(matches, null, 2)}`).toHaveLength(0);
  });

  /**
   * Validates: Requirements 7.2
   * No server actions should exist in the static export codebase.
   */
  it('should have zero "use server" directives in src/', () => {
    const matches = grepFiles(sourceFiles, /["']use server["']/);
    expect(matches, `Found "use server" directives:\n${JSON.stringify(matches, null, 2)}`).toHaveLength(0);
  });

  /**
   * Validates: Requirements 7.1
   * next.config.ts must set output: "export" for static site generation.
   */
  it('should have output: "export" in next.config.ts', () => {
    const configPath = path.resolve(__dirname, "../../next.config.ts");
    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toMatch(/output:\s*["']export["']/);
  });

  /**
   * Validates: Requirements 7.1
   * next.config.ts must disable image optimization for static export.
   */
  it("should have images: { unoptimized: true } in next.config.ts", () => {
    const configPath = path.resolve(__dirname, "../../next.config.ts");
    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toMatch(/images:\s*\{[^}]*unoptimized:\s*true/);
  });
});
