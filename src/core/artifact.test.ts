import { createHash } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { clayArtifactPath, isArtifactPath } from "../shared/artifact";
import { artifactFilename, parseArtifact } from "./artifact";
import { writeZip } from "./zip";

describe("Clay artifact compatibility", () => {
  it("defaults saves to .clay and opens both extensions", () => {
    expect(artifactFilename("My canvas")).toBe("my-canvas.clay");
    expect(clayArtifactPath("My canvas.caddis")).toBe("My canvas.clay");
    expect(clayArtifactPath("My canvas.CLAY")).toBe("My canvas.clay");
    expect(clayArtifactPath("My canvas")).toBe("My canvas.clay");
    expect(isArtifactPath("My canvas.clay")).toBe(true);
    expect(isArtifactPath("My canvas.CADDIS")).toBe(true);
    expect(isArtifactPath("My canvas.zip")).toBe(false);
  });

  it.each(["clay", "caddis"])("loads %s artifacts with their saved data", (name) => {
    const data = Buffer.from(JSON.stringify({ greeting: "Still here" }));
    const manifest = {
      format: `${name}-artifact`,
      version: 1,
      app: { name, version: "0.3.0" },
      canvas: { mode: "html", rev: 0 },
      files: [{ path: "data.json", role: "data", sha256: createHash("sha256").update(data).digest("hex") }],
    };
    const buffer = writeZip([
      { path: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
      { path: "data.json", data },
    ]);
    expect(parseArtifact(buffer).data).toEqual({ greeting: "Still here" });
  });
});
