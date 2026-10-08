import { describe, expect, it } from "vitest";
import { nextMosaicControlState, type MosaicControlAction } from "./control-state";

describe("Mosaic control transitions", () => {
  it.each([
    ["pause", false, 4],
    ["play", true, 4],
    ["clear", true, 4],
    ["restart", true, 5],
    ["reset", true, 5],
  ] as const)("increments the revision and applies %s semantics", (action, playing, restartKey) => {
    expect(nextMosaicControlState(
      { playing: true, revision: 8, restartKey: 4 },
      action as MosaicControlAction,
    )).toEqual({ playing, revision: 9, restartKey });
  });
});
