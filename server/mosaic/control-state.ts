import type { MosaicControl } from "../../shared/mosaic";

export type MosaicControlAction = "play" | "pause" | "restart" | "clear" | "reset";

export function nextMosaicControlState(
  current: MosaicControl,
  action: MosaicControlAction,
): MosaicControl {
  return {
    playing: action !== "pause",
    revision: current.revision + 1,
    restartKey: current.restartKey + (action === "restart" || action === "reset" ? 1 : 0),
  };
}
