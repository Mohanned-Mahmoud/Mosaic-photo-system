import { describe, expect, it } from "vitest";
import { nextMosaicControlState, type MosaicControlAction } from "./control-state";

describe("Mosaic control transitions", () => {
  it.each([
    ["pause", false, 4, false, false, 0],
    ["play", true, 4, false, false, 0],
    ["clear", true, 4, false, false, 0],
    ["restart", true, 5, false, false, 0],
    ["reset", true, 5, false, false, 0],
    ["toggle-fill", true, 4, true, false, 0],
    ["toggle-screensaver", true, 4, false, true, 0],
    ["next-target", true, 4, false, false, 1],
  ] as const)("increments the revision and applies %s semantics", (action, playing, restartKey, autoFill, screensaver, targetIndex) => {
    expect(nextMosaicControlState(
      { playing: true, revision: 8, restartKey: 4, autoFill: false, screensaver: false, targetIndex: 0 },
      action as MosaicControlAction,
    )).toEqual({ playing, revision: 9, restartKey, autoFill, screensaver, targetIndex });
  });
});
