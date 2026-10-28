// The only way into the World_View: three.js and world/build load with import() when a world opens (Requirement 7.1).
import type { World, WorldOptions } from "./build";

export async function openWorld(host: HTMLElement, opts: WorldOptions): Promise<World> {
  return (await import("./build")).buildWorld(host, opts);
}
