import { describe, expect, it } from "vitest";
import { template } from "./template.ts";

describe("student-facing FTE security claim", () => {
  it("states exact format membership without claiming exact uniformity", () => {
    const lesson = template().replace(/\s+/g, " ");
    expect(lesson).toContain("its exact guarantee is membership");
    expect(lesson).toContain("does not make the output distribution uniform");
    expect(lesson).not.toContain("uniformly random member of the language");
    expect(lesson).not.toContain("within it the guarantee is exact");
  });
});
