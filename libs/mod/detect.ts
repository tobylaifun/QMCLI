import { VersionInfo } from "../types.ts";

export type LoaderTypes = "fabric" | "forge" | "quilt" | "neoforged";

export function detectModLoader(
  verJson: VersionInfo,
): LoaderTypes | "unknown" | false {
  const hasLaunchTarget = (
    args?: Array<string | { value?: string | string[] }>,
    target?: string,
  ) => {
    if (!args || !target) return false;
    for (let i = 0; i < args.length - 1; i++) {
      const cur = args[i];
      const next = args[i + 1];
      if (cur === "--launchTarget" && next === target) return true;
    }
    return false;
  };

  // 只从 patches 检测 loader，不检查根级别字段
  // 根字段可能来自旧代码泄露或数据损坏，不应作为判断依据
  for (const patch of verJson.patches || []) {
    if (patch.mainClass?.includes("fabricmc")) {
      return "fabric";
    }
    if (patch.mainClass?.includes("quiltmc")) {
      return "quilt";
    }
    if (
      patch.mainClass?.includes("ForgeBootstrap") ||
      hasLaunchTarget(patch.arguments?.game, "forge_client") ||
      hasLaunchTarget(patch.arguments?.game, "forgeclient")
    ) {
      return "forge";
    }
    if (
      patch.mainClass?.includes("neoforge") ||
      hasLaunchTarget(patch.arguments?.game, "neoforgeclient")
    ) {
      return "neoforged";
    }
  }
  return false;
}
