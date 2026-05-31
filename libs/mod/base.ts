import { deepmerge } from "deepmerge-ts";
import { PatchEntry, VersionInfo } from "../types.ts";

export function addPatch(
  verJson: VersionInfo,
  patch: Record<string, unknown>,
  meta: Record<string, unknown>,
) {
  // 剥离 loader profile 内部字段，防止它们污染根级别的 version JSON
  // id/inheritsFrom 会覆盖游戏身份；_comment/version/priority/complianceLevel 是 Forge 内部元数据
  const {
    id: _patchId,
    inheritsFrom: _inheritsFrom,
    _comment: _comment,
    version: _version,
    priority: _priority,
    complianceLevel: _complianceLevel,
    ...safePatch
  } = patch;
  const merged = deepmerge(verJson, safePatch) as VersionInfo;
  merged.patches = merged.patches || [];
  merged.patches.push({ ...patch, ...meta } as unknown as PatchEntry);
  return merged;
}

export function removePatch(verJson: VersionInfo, patch: PatchEntry) {
  const oriPatch = verJson.patches?.find((p) => p.id === "game");
  if (!oriPatch) return verJson;
  const savedId = verJson.id;
  // 用 game patch 的数据覆盖回根字段（还原到原版 MC 状态），但跳过内部元数据字段
  // 注意：deepmerge-ts 对数组的行为是替换而非拼接，因此 libraries/arguments 会被还原而非累积
  const {
    id: _gameId,
    version: _gameVersion,
    priority: _gamePriority,
    ...patchData
  } = JSON.parse(JSON.stringify(oriPatch));
  const result = deepmerge(verJson, patchData) as VersionInfo;
  // id 不能被 game patch 的 "game" 覆盖
  result.id = savedId;
  // 只移除指定的 loader patch，保留 game patch（后续安装其他 loader 还需要）
  result.patches = (verJson.patches?.filter((p) => p !== patch) ?? []) as PatchEntry[];
  return result;
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
