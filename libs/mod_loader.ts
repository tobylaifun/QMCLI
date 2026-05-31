import nodePath from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import { confirm, select } from "@inquirer/prompts";
import { t } from "../translations/translate.ts";
import { VersionInfo } from "./types.ts";
import { BaseInstaller, removePatch } from "./mod/base.ts";
import { FabricInstaller } from "./mod/fabric.ts";
import { ForgeInstaller } from "./mod/forge.ts";
import { NeoForgedInstaller } from "./mod/neoforged.ts";
import { QuiltInstaller } from "./mod/quilt.ts";
import { detectModLoader, LoaderTypes } from "./mod/detect.ts";

export { addPatch, removePatch, BaseInstaller } from "./mod/base.ts";
export type { InstallerEntry } from "./mod/base.ts";
export { detectModLoader } from "./mod/detect.ts";

const installers: Record<LoaderTypes, typeof BaseInstaller> = {
  fabric: FabricInstaller,
  forge: ForgeInstaller,
  quilt: QuiltInstaller,
  neoforged: NeoForgedInstaller,
};

export async function autoInstallPrompt(
  basepath: string,
  game: string,
  mcversion: string,
) {
  const gamePath = nodePath.join(basepath, "versions", game);
  let verJson = JSON.parse(
    fs.readFileSync(nodePath.join(gamePath, game + ".json"), {
      encoding: "utf-8",
    }),
  ) as VersionInfo;
  const detected = detectModLoader(verJson);
  const loader = await select<LoaderTypes>({
    message: t("auto_install_prompt_select_mod_loader"),
    choices: [
      {
        name: `${detected == "fabric" ? "✅ " : ""}Fabric`,
        value: "fabric",
        disabled: detected !== false && detected != "fabric",
      },
      {
        name: `${detected == "quilt" ? "✅ " : ""}Quilt`,
        value: "quilt",
        disabled: detected !== false && detected != "quilt",
      },
      {
        name: `${detected == "forge" ? "✅ " : ""}Forge`,
        value: "forge",
        disabled: detected !== false && detected != "forge",
      },
      {
        name: `${detected == "neoforged" ? "✅ " : ""}NeoForge`,
        value: "neoforged",
        disabled: detected !== false && detected != "neoforged",
      },
    ],
  });
  const installer = installers[loader];
  if (!detected) {
    const loader_versions = await installer.getInstallersFromMcVersion(
      mcversion,
    );
    if (!loader_versions) {
      console.log(chalk.red(t("auto_install_prompt_no_loaders_found")));
      return;
    }
    loader_versions.sort((a, b) => {
      const pa = a.version.split(".")[0] !== undefined ? a.version.replace(/-.*$/, "").split(".").map(Number) : [0];
      const pb = b.version.split(".")[0] !== undefined ? b.version.replace(/-.*$/, "").split(".").map(Number) : [0];
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] ?? 0;
        const nb = pb[i] ?? 0;
        if (na !== nb) return nb - na;
      }
      return 0;
    });
    const loader_version = await select({
      message: t("auto_install_prompt_select_loader_version"),
      choices: loader_versions.map((v) => ({
        name: v.version,
        value: v,
      })),
    });
    console.log(chalk.green(t("operation_starting")));
    await installer.install(loader_version, basepath, game);
    console.log(chalk.green(t("operation_completed")));
  } else {
    const action = await select({
      message: t("auto_install_select_action_prompt"),
      choices: [
        {
          name: t("auto_install_select_action_info"),
          value: "info",
          description: t("auto_install_select_action_info_desc"),
        },
        {
          name: t("auto_install_select_action_delete"),
          value: "delete",
          description: t("auto_install_select_action_delete_desc"),
        },
      ],
    });
    if (action == "info") {
      console.log(chalk.green(t("auto_install_info_loader", detected)));
      if (!verJson.patches) {
        console.log(
          chalk.yellow(t("auto_install_info_err_no_patches")),
        );
      } else {
        const patch = verJson.patches?.find((p) => p.id == detected);
        if (!patch) {
          console.log(
            chalk.yellow(
              t(
                "auto_install_info_err_no_patches_named",
                detected,
              ),
            ),
          );
          return;
        }
        console.log(
          chalk.green(
            t("auto_install_version_loader", patch.version),
          ),
        );
      }
    } else if (action == "delete") {
      const confirm_ = await confirm({
        message: t("auto_install_confirm_delete"),
        default: false,
      });
      if (confirm_) {
        const patchIndex = verJson.patches?.findIndex((p) =>
          p.id == detected
        ) ?? -1;
        if (patchIndex == -1) {
          console.log(
            chalk.red(
              t(
                "auto_install_info_err_no_patches_named",
                detected,
              ),
            ),
          );
          console.log(chalk.red(t("err_failed")));
          return;
        }

        verJson = removePatch(verJson, verJson.patches![patchIndex]);
        fs.writeFileSync(
          nodePath.join(gamePath, game + ".json"),
          JSON.stringify(verJson, null, 4),
        );
        console.log(chalk.green(t("operation_completed")));
      }
    }
  }
}
