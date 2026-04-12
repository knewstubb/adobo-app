import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const MANIFEST_PATH = path.join(PUBLIC_DIR, "manifest.json");

describe("Smoke tests for PWA manifest", () => {
  /**
   * Validates: Requirements 6.1
   * The PWA manifest file must exist in the public directory.
   */
  it("should have a manifest.json in public/", () => {
    expect(fs.existsSync(MANIFEST_PATH)).toBe(true);
  });

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));

  /**
   * Validates: Requirements 6.1
   * The manifest must include all required PWA fields.
   */
  it("should have required fields: name, short_name, start_url, display, icons", () => {
    expect(manifest).toHaveProperty("name");
    expect(manifest).toHaveProperty("short_name");
    expect(manifest).toHaveProperty("start_url");
    expect(manifest).toHaveProperty("display");
    expect(manifest).toHaveProperty("icons");
  });

  /**
   * Validates: Requirements 6.1
   * display must be "standalone" for installable PWA behaviour.
   */
  it('should have display set to "standalone"', () => {
    expect(manifest.display).toBe("standalone");
  });

  /**
   * Validates: Requirements 6.1
   * The icons array must have at least 2 entries with src, sizes, and type.
   */
  it("should have at least 2 icons with src, sizes, and type", () => {
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      expect(icon).toHaveProperty("src");
      expect(icon).toHaveProperty("sizes");
      expect(icon).toHaveProperty("type");
    }
  });

  /**
   * Validates: Requirements 6.1
   * The referenced icon files must exist on disk.
   */
  it("should have icon-192.png in public/", () => {
    expect(fs.existsSync(path.join(PUBLIC_DIR, "icon-192.png"))).toBe(true);
  });

  it("should have icon-512.png in public/", () => {
    expect(fs.existsSync(path.join(PUBLIC_DIR, "icon-512.png"))).toBe(true);
  });
});
