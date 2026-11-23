import { describe, expect, test } from "bun:test";
import { diffLines, splitLines, statOf } from "./diff";

describe("line counts", () => {
  test("a final newline ends the last line instead of adding an empty one", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n")).toEqual([""]);
  });
  test("a new 3-line file is +3, not +4", () => { expect(statOf(diffLines("", "n1\nn2\nn3\n"))).toEqual({ add: 3, del: 0 }); });
  test("replacing one line with two is +2 -1", () => { expect(statOf(diffLines("one\ntwo\nthree\n", "one\nTWO\nextra\nthree\n"))).toEqual({ add: 2, del: 1 }); });
  test("deleting a file counts every line removed", () => { expect(statOf(diffLines("x\ny\n", ""))).toEqual({ add: 0, del: 2 }); });
});
