import { deepmerge } from "deepmerge-ts";
import { PatchEntry, VersionInfo } from "../types.ts";

export function addPatch(
  verJson: VersionInfo,
  patch: Record<string, unknown>,
  meta: Record<string, unknown>,
) {
  const merged = deepmerge(verJson, patch) as VersionInfo;
  merged.patches = merged.patches || [];
  merged.patches.push({ ...patch, ...meta } as unknown as PatchEntry);
  return merged;
}

export function removePatch(verJson: VersionInfo, patch: PatchEntry) {
  const oriVerJson = JSON.parse(
    JSON.stringify(verJson.patches?.find((p) => p.id == "game")),
  ) as VersionInfo;
  oriVerJson.patches = JSON.parse(
    JSON.stringify(verJson.patches?.filter((p) => p != patch)),
  );
  return oriVerJson;
}

export interface InstallerEntry {
  url?: string;
  mcversion: string;
  version: string;
  branch?: string;
}

export class BaseInstaller {
  static getInstallersFromMcVersion(
    _mcVersion: string,
  ): Promise<InstallerEntry[] | null> {
    return Promise.resolve(null);
  }
  static install(
    _entry: InstallerEntry,
    _basepath: string,
    _game: string,
  ): Promise<void> {
    return Promise.resolve();
  }
}
