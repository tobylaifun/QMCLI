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
  const hasForgeLib = (verJson.libraries ?? []).some((lib) =>
    lib.name?.startsWith("net.minecraftforge:forge:")
  );
  const hasNeoForgeLib = (verJson.libraries ?? []).some((lib) =>
    lib.name?.startsWith("net.neoforged:")
  );

  for (const patch of verJson.patches || []) {
    if (patch.mainClass?.includes("fabricmc")) {
      return "fabric";
    } else if (patch.mainClass?.includes("quiltmc")) {
      return "quilt";
    } else if (
      patch.mainClass?.includes("ForgeBootstrap") ||
      hasLaunchTarget(patch.arguments?.game, "forge_client") ||
      hasLaunchTarget(patch.arguments?.game, "forgeclient") ||
      hasForgeLib
    ) {
      return "forge";
    } else if (
      patch.mainClass?.includes("neoforge") ||
      hasLaunchTarget(patch.arguments?.game, "neoforgeclient") ||
      hasNeoForgeLib
    ) {
      return "neoforged";
    }
  }
  const mc = verJson.mainClass ?? "";
  const verArgs = (verJson as { arguments?: { game?: string[] } }).arguments;
  if (mc.includes("fabricmc")) {
    return "fabric";
  } else if (mc.includes("quiltmc")) {
    return "quilt";
  } else if (
    mc.includes("ForgeBootstrap") ||
    hasLaunchTarget(verArgs?.game, "forge_client") ||
    hasLaunchTarget(verArgs?.game, "forgeclient") ||
    hasForgeLib
  ) {
    return "forge";
  } else if (
    mc.includes("neoforge") ||
    hasLaunchTarget(verArgs?.game, "neoforgeclient") ||
    hasNeoForgeLib
  ) {
    return "neoforged";
  }
  return false;
}
