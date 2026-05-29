import { m } from "./mirrors.ts";
import nodePath from "node:path";
import fs from "node:fs";
import { deepmerge } from "deepmerge-ts";
import { fetchLibraries } from "./versions.ts";
import { DownloadQueue } from "./downloader.ts";
import { t } from "../translations/translate.ts";
import chalk from "chalk";
import { confirm, select, Separator } from "@inquirer/prompts";
import { parseLibNameToPath } from "./utils.ts";
import { PatchEntry, VersionInfo } from "./types.ts";

export function addPatch(verJson: VersionInfo, patch: Record<string, unknown>, meta: Record<string, unknown>) {
    const merged = deepmerge(verJson, patch) as VersionInfo;
    merged.patches = merged.patches || [];
    merged.patches.push({ ...patch, ...meta } as unknown as PatchEntry);
    return merged;
}

export function removePatch(verJson: VersionInfo, patch: PatchEntry) {
    const oriVerJson = JSON.parse(JSON.stringify(verJson.patches?.find((p) => p.id == "game"))) as VersionInfo;
    oriVerJson.patches = JSON.parse(JSON.stringify(verJson.patches?.filter((p) => p != patch)));
    return oriVerJson;
}

export interface InstallerEntry {
    url?: string;
    mcversion: string;
    version: string;
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

class FabricInstaller extends BaseInstaller {
    static loader = "fabric";
    static fabricapi = "https://meta.fabricmc.net/v2";
    static headers = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
    };
    static async getInstallersFromMcVersion(
        mcVersion: string,
    ): Promise<InstallerEntry[] | null> {
        const apiSupportedMcVersions = m(
            this.fabricapi + "/versions/game",
        );
        const supportedMcVersions =
            (await (await fetch(apiSupportedMcVersions, {
                headers: this.headers,
            })).json() as {
                version: string;
                stable: boolean;
            }[]).map((v) => v.version);
        if (!supportedMcVersions.includes(mcVersion)) {
            return null;
        }
        const apiLoaderVersions = m(
            `${this.fabricapi}/versions/loader/${mcVersion}`,
        );
        const loaderVersions =
            (await (await fetch(apiLoaderVersions, { headers: this.headers }))
                .json()) as {
                    loader: { version: string; stable: boolean };
                }[];
        return loaderVersions.map((v) => ({
            version: v.loader.version,
            mcversion: mcVersion,
        }));
    }
    static async install(
        entry: InstallerEntry,
        basepath: string,
        game: string,
    ): Promise<void> {
        const apiProfile = m(
            `${this.fabricapi}/versions/loader/${entry.mcversion}/${entry.version}/profile/json`,
        );
        const profileJson =
            await (await fetch(apiProfile, { headers: this.headers })).json();
        let originalVerJson = JSON.parse(
            fs.readFileSync(`${basepath}/versions/${game}/${game}.json`, {
                encoding: "utf-8",
            }),
        ) as VersionInfo;
        for (let i = 0; i < profileJson.libraries.length; i++) {
            const path = parseLibNameToPath(
                profileJson.libraries[i].name,
            );
            profileJson.libraries[i] = {
                "downloads": {
                    "artifact": {
                        "path": path,
                        "sha1": profileJson.libraries[i].sha1,
                        "size": profileJson.libraries[i].size,
                        "url": profileJson.libraries[i].url + path,
                    },
                },
                "name": profileJson.libraries[i].name,
            };
        }
        const merged = deepmerge(originalVerJson, profileJson);
        originalVerJson.patches = originalVerJson.patches || [];
        originalVerJson = addPatch(originalVerJson, profileJson, {
            id: this.loader,
            priority: 30000,
            version: entry.version,
        });

        if (
            !fs.existsSync(`${basepath}/versions/${game}/${game}-original.json`)
        ) {
            fs.copyFileSync(
                `${basepath}/versions/${game}/${game}.json`,
                `${basepath}/versions/${game}/${game}-original.json`,
            );
        }
        fs.writeFileSync(
            `${basepath}/versions/${game}/${game}.json`,
            JSON.stringify(originalVerJson, null, 4),
            { encoding: "utf-8" },
        );
        const { tasks, totalSize } = await fetchLibraries(
            merged as VersionInfo,
            basepath,
            game,
        );
        if (tasks.length != 0) {
            const dl = new DownloadQueue(16, { totalSize });
            for (const task of tasks) {
                dl.addTask(task);
            }
            await dl.wait();
        }
    }
}
class QuiltInstaller extends FabricInstaller {
    static override loader = "quilt";
    static override fabricapi = "https://meta.quiltmc.org/v3";
}

type LoaderTypes = "fabric" | "forge" | "quilt" | "neoforged";
const installers: Record<LoaderTypes, typeof BaseInstaller> = {
    fabric: FabricInstaller,
    forge: BaseInstaller,
    quilt: QuiltInstaller,
    neoforged: BaseInstaller,
};

export function detectModLoader(verJson: VersionInfo): LoaderTypes | "unknown" | false {
    for (const patch of verJson.patches || []) {
        if (patch.mainClass?.includes("fabricmc")) {
            return "fabric";
        } else if (patch.mainClass?.includes("quiltmc")) {
            return "quilt";
        } else if (patch.arguments?.game?.includes("forgeclient")) {
            return "forge";
        } else if (patch.arguments?.game?.includes("neoforgeclient")) {
            return "neoforged";
        }
    }
    const mc = verJson.mainClass ?? "";
    const verArgs = (verJson as { arguments?: { game?: string[] } }).arguments;
    if (mc.includes("fabricmc")) {
        return "fabric";
    } else if (mc.includes("quiltmc")) {
        return "quilt";
    } else if (verArgs?.game?.includes("forgeclient")) {
        return "forge";
    } else if (verArgs?.game?.includes("neoforgeclient")) {
        return "neoforged";
    }
    return false;
}

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
            new Separator(),
            {
                name: `${detected == "forge" ? "✅ " : ""}Forge ❌todo`,
                value: "forge",
                disabled: detected !== false && detected != "forge" || true,
            },
            {
                name: `${detected == "neoforged" ? "✅ " : ""}NeoForge ❌todo`,
                value: "neoforged",
                disabled: detected !== false && detected != "neoforged" || true,
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
                const patch = verJson.patches?.find((p) =>
                    p.id == detected
                );
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
