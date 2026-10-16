import { describe, expect, it } from "vite-plus/test";

import { locateSegments, speechMatchKey } from "./readAloudHighlight";

describe("speechMatchKey", () => {
  it("keeps only lowercased letters and digits", () => {
    expect(speechMatchKey("I changed **two** files in `apps/web`!")).toBe(
      "ichangedtwofilesinappsweb",
    );
    expect(speechMatchKey("Æblegrød, 3 gange.")).toBe("æblegrød3gange");
  });
});

describe("locateSegments", () => {
  it("finds spoken sentences in rendered text despite markup and table separators", () => {
    const rendered = speechMatchKey("Summary I changed two files. File Change a.ts added");
    expect(locateSegments(rendered, ["Summary", "I changed two files.", "File, Change"])).toEqual([
      { start: 0, end: 7 },
      { start: 7, end: 23 },
      { start: 23, end: 33 },
    ]);
  });

  it("lands a repeated sentence on its own occurrence and skips text it cannot find", () => {
    const rendered = speechMatchKey("Done. Not spoken here. Done.");
    expect(locateSegments(rendered, ["Done.", "Missing.", "Done."])).toEqual([
      { start: 0, end: 4 },
      null,
      { start: 17, end: 21 },
    ]);
  });
});
