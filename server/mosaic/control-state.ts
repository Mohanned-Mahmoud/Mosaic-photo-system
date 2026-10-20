import type { MosaicControl } from "../../shared/mosaic";

export type MosaicControlAction =
  | "play"
  | "pause"
  | "restart"
  | "clear"
  | "reset"
  | "toggle-fill"
  | "toggle-screensaver"
  | "next-target"
  | "prev-target"
  | "set-target";

export function nextMosaicControlState(
  current: MosaicControl,
  action: MosaicControlAction,
  options?: { targetIndex?: number; maxTargets?: number },
): MosaicControl {
  let nextTarget = current.targetIndex ?? 0;
  const count = options?.maxTargets && options.maxTargets > 0 ? options.maxTargets : 1000;
  if (action === "next-target") {
    nextTarget = (nextTarget + 1) % count;
  } else if (action === "prev-target") {
    nextTarget = (nextTarget - 1 + count) % count;
  } else if (action === "set-target" && typeof options?.targetIndex === "number") {
    nextTarget = Math.max(0, options.targetIndex);
  } else if (action === "reset") {
    nextTarget = 0;
  }

  return {
    playing: action === "play" ? true : action === "pause" ? false : current.playing,
    revision: current.revision + 1,
    restartKey: current.restartKey + (action === "restart" || action === "reset" ? 1 : 0),
    autoFill: action === "toggle-fill" ? !current.autoFill : Boolean(current.autoFill),
    screensaver: action === "toggle-screensaver" ? !current.screensaver : Boolean(current.screensaver),
    targetIndex: nextTarget,
  };
}
