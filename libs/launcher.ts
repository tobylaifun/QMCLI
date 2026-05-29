import chalk from "chalk";
import { config } from "./config.ts";
import { fetchAsset, fetchLibraries } from "./versions.ts";
import { DownloadQueue } from "./downloader.ts";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import AdmZip from "adm-zip";
import { execSync, spawn } from "node:child_process";
import { release } from "node:os";
import McLog4j2Xml from "../mc/log4j2.xml.ts";
import { select } from "@inquirer/prompts";
import { getUsers, User } from "./users.ts";
import { t } from "../translations/translate.ts";
import packageJson from "../package.json" with { type: "json" };
import { LauncherGameConfig, loadConfig } from "./versionsConfig.ts";
import {
    arch,
    checkRules,
    getArchSuffix,
    getOs,
    parseLibNameToPath,
    rmDupLibs,
} from "./utils.ts";
import { MinecraftLibrary, MinecraftRule, VersionInfo } from "./types.ts";

export function getVersionFromVerJson(
    verJson: { qmcli_ver_id?: string; patches?: Array<{ id: string; version?: string }>; id?: string },
) {
    if (verJson.qmcli_ver_id !== undefined) {
        return verJson.qmcli_ver_id;
    }
    if (verJson.patches) {
        const patch = verJson.patches.find((p) => p.id == "game");
        if (patch && patch.version) return patch.version;
    }
    return verJson.id;
}

export function listGames(basepath: string) {
    const gamesDir = `${basepath}/versions`;
    const games: string[] = [];
    if (fs.existsSync(gamesDir)) {
        for (const game of fs.readdirSync(gamesDir)) {
            if (fs.existsSync(`${gamesDir}/${game}/${game}.json`)) {
                games.push(game);
            }
        }
    }
    return games;
}

export function deleteGame(basepath: string, game: string) {
    fs.rmSync(nodePath.join(basepath, "versions", game), { recursive: true });
}

function cpSep() {
    if (getOs() == "windows") return ";";
    return ":";
}

async function ensureAssets(verJson: VersionInfo, basepath: string, game: string): Promise<void> {
    console.log(chalk.blue(t("launch_fetching_asset")));
    try {
        const { tasks, totalSize } = await fetchAsset(verJson, basepath, game);
        if (tasks.length != 0) {
            const dl = new DownloadQueue(16, { totalSize });
            for (const task of tasks) dl.addTask(task);
            await dl.wait();
        }
        console.log(chalk.blue(t("launch_fetched_asset")));
    } catch (e) {
        console.log(chalk.red(t("err_failed")));
        console.log(e);
    }
}

async function ensureLibraries(verJson: VersionInfo, basepath: string, game: string): Promise<void> {
    console.log(chalk.blue(t("launch_fetching_libraries")));
    try {
        const { tasks, totalSize } = await fetchLibraries(verJson, basepath, game);
        if (tasks.length != 0) {
            const dl = new DownloadQueue(16, { totalSize });
            for (const task of tasks) dl.addTask(task);
            await dl.wait();
        }
        console.log(chalk.blue(t("launch_fetched_libraries")));
    } catch (e) {
        console.log(chalk.red(t("err_failed")));
        console.log(e);
    }
}

function prepareLibraries(
    verJson: VersionInfo,
    basepath: string,
    game: string,
): { extractDir: string; libraryPaths: string[] } {
    console.log(chalk.blue(t("launch_extracting_natives")));
    const os = getOs();
    const suffix = getArchSuffix();
    const extractLibs: string[] = [];
    let librariesDat: MinecraftLibrary[] = [];
    const extractDir = `${basepath}/versions/${game}/natives-${os}${suffix}`;

    for (const lib of (verJson.libraries ?? [])) {
        if (!lib.downloads && lib.url) {
            const path = parseLibNameToPath(lib.name);
            librariesDat.push({
                downloads: { artifact: { path, url: lib.url + path } },
                name: lib.name,
            });
            continue;
        }
        if (lib.downloads?.artifact) {
            const art = lib.downloads.artifact;
            if (art.path?.includes(`natives-${os}`)) {
                extractLibs.push(art.path);
            }
            if (lib.rules && checkRules(lib.rules, {
                os: { name: getOs(), arch: arch(), version: release() },
            })) {
                librariesDat.push(lib);
            } else if (!lib.rules) {
                librariesDat.push(lib);
            }
        }
        if (lib.downloads?.classifiers) {
            const nativePath = lib.downloads.classifiers[`natives-${os}`]?.path;
            if (nativePath) extractLibs.push(nativePath);
        }
        if (suffix != "") {
            if (lib.downloads?.artifact) {
                const art = lib.downloads.artifact;
                if (art.path?.includes(`natives-${os}${suffix}`)) {
                    extractLibs.push(art.path);
                }
            }
            const suffixedPath = lib.downloads?.classifiers?.[`natives-${os}${suffix}`]?.path;
            if (suffixedPath) extractLibs.push(suffixedPath);
        }
    }

    librariesDat = rmDupLibs(librariesDat);
    const libraryPaths: string[] = librariesDat.map((x) =>
        `${basepath}/libraries/${x.downloads?.artifact?.path ?? ""}`
    );
    libraryPaths.push(`${basepath}/versions/${game}/${game}.jar`);

    fs.mkdirSync(`${extractDir}/tmp`, { recursive: true });
    for (const lib of extractLibs) {
        const zip = new AdmZip(`${basepath}/libraries/${lib}`);
        zip.extractAllTo(`${extractDir}/tmp`, true);
    }
    console.log(chalk.blue(t("launch_moving_files")));
    fs.readdirSync(`${extractDir}/tmp`, { withFileTypes: true, recursive: true })
        .forEach((file) => {
            if (file.isFile() && !file.name.endsWith(".git") &&
                !file.name.endsWith(".sha1") && !file.name.endsWith(".class")) {
                fs.copyFileSync(
                    nodePath.join(file.parentPath, file.name),
                    nodePath.join(extractDir, file.name),
                );
            }
        });
    fs.rmSync(`${extractDir}/tmp`, { recursive: true });
    console.log(chalk.green(t("launch_extracting_natives_done")));

    return { extractDir, libraryPaths };
}

function buildArgParams(
    verJson: VersionInfo,
    gconfig: LauncherGameConfig,
    user: User,
    basepath: string,
    game: string,
    extractDir: string,
    libraryPaths: string[],
): Record<string, string | number | undefined> {
    return {
        "version_name": verJson.id,
        "version_type": "QMCLI v" + packageJson.version,
        "game_directory": gconfig.isolated
            ? `${basepath}/versions/${game}`
            : basepath,
        "library_directory": `${basepath}/libraries`,
        "classpath_separator": cpSep(),
        "assets_root": `${basepath}/assets`,
        "assets_index_name": verJson.assets,
        "natives_directory": extractDir,
        "launcher_name": "QMCLI",
        "launcher_version": "0.0.1",
        "classpath": libraryPaths.join(cpSep()),
        "resolution_width": gconfig.size!.width,
        "resolution_height": gconfig.size!.height,
        "auth_player_name": user.name,
        "auth_uuid": user.uuid,
        "auth_access_token": user.auth_access_token,
        "user_properties": "{}",
        "user_type": "msa",
    };
}

function substituteArgs(
    raw: string,
    argparams: Record<string, string | number | undefined>,
): string {
    let result = raw;
    for (const [key, value] of Object.entries(argparams)) {
        result = result.replaceAll(`$\{${key}\}`, String(value));
    }
    return result;
}

function buildBaseJvmFlags(gconfig: LauncherGameConfig): string[] {
    return [
        "-Xmn" + gconfig.ram!.min,
        "-Xmx" + gconfig.ram!.max,
        "-XX:+UnlockExperimentalVMOptions",
        "-XX:+UseG1GC",
        "-XX:G1NewSizePercent=20",
        "-XX:G1ReservePercent=20",
        "-XX:MaxGCPauseMillis=50",
        "-XX:G1HeapRegionSize=32m",
        "-XX:-UseAdaptiveSizePolicy",
        "-XX:-OmitStackTraceInFastThrow",
        "-XX:-DontCompileHugeMethods",
        "-Dfml.ignoreInvalidMinecraftCertificates=true",
        "-Dlog4j2.formatMsgNoLookups=true",
        "-Dfile.encoding=UTF-8",
    ];
}

function getJavaMajorVersion(javaExe: string): number {
    try {
        const verOut = execSync(`"${javaExe}" --version 2>&1`).toString();
        const match = verOut.match(/(\d+)/);
        if (match) return parseInt(match[1]);
    } catch {
        // java not found, will use default
    }
    return 0;
}

function buildJvmArgs(
    verJson: VersionInfo,
    gconfig: LauncherGameConfig,
    basepath: string,
    game: string,
    argparams: Record<string, string | number | undefined>,
    javaMajorVersion: number,
): string[] {
    const args: string[] = [];

    args.push(...buildBaseJvmFlags(gconfig));

    fs.writeFileSync(
        `${basepath}/versions/${game}/log4j2-qmcli.xml`,
        McLog4j2Xml,
        { encoding: "utf-8" },
    );
    if (verJson.logging?.client?.argument) {
        args.push(
            verJson.logging.client.argument.replaceAll(
                "${path}",
                `${basepath}/versions/${game}/log4j2-qmcli.xml`,
            ),
        );
    }

    args.push(`-Dminecraft.client.jar=${basepath}/versions/${game}/${game}.jar`);

    if (verJson.arguments?.jvm) {
        for (const param of verJson.arguments.jvm) {
            if (typeof param === "string") {
                const tmp = substituteArgs(param, argparams);
                if (tmp.startsWith("--sun-misc-unsafe-memory-access") && javaMajorVersion < 23) continue;
                args.push(tmp);
            } else {
                if (checkRules(param.rules ?? [], {
                    os: { name: getOs(), arch: arch(), version: release() },
                })) {
                    let tmp = Array.isArray(param.value)
                        ? param.value.join(" ")
                        : `${param.value}`;
                    tmp = substituteArgs(tmp, argparams);
                    if (tmp.startsWith("--sun-misc-unsafe-memory-access") && javaMajorVersion < 23) continue;
                    args.push(tmp);
                }
            }
        }
    } else if (verJson.minecraftArguments) {
        // Legacy format (pre-1.13): hardcoded JVM args with OS-specific rules
        for (const param of [
            {
                rules: [{ action: "allow", os: { name: "osx" } }],
                value: ["-XstartOnFirstThread"],
            },
            {
                rules: [{ action: "allow", os: { name: "windows" } }],
                value: "-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump",
            },
            {
                rules: [{ action: "allow", os: { arch: "x86" } }],
                value: "-Xss1M",
            },
            "-Djava.library.path=${natives_directory}",
            "-Djna.tmpdir=${natives_directory}",
            "-Dorg.lwjgl.system.SharedLibraryExtractPath=${natives_directory}",
            "-Dio.netty.native.workdir=${natives_directory}",
            "-Dminecraft.launcher.brand=${launcher_name}",
            "-Dminecraft.launcher.version=${launcher_version}",
            "-cp",
            "${classpath}",
        ] as (string | { rules?: MinecraftRule[]; value?: string | string[] })[]) {
            if (typeof param === "string") {
                args.push(substituteArgs(param, argparams));
            } else {
                if (checkRules(param.rules ?? [], {
                    os: { name: getOs(), arch: arch(), version: release() },
                })) {
                    const tmp = Array.isArray(param.value)
                        ? param.value.join(" ")
                        : `${param.value}`;
                    args.push(substituteArgs(tmp, argparams));
                }
            }
        }
    }

    return args;
}

function buildGameArgs(
    verJson: VersionInfo,
    argparams: Record<string, string | number | undefined>,
): string[] {
    const args: string[] = [];

    if (!verJson.arguments && verJson.minecraftArguments) {
        const parsed = verJson.minecraftArguments.split(" ");
        for (const param of parsed) {
            if (param.startsWith("${")) {
                args.push(substituteArgs(param, argparams));
            } else {
                args.push(param);
            }
        }
        args.push("--width", String(argparams.resolution_width), "--height", String(argparams.resolution_height));
        return args;
    }

    if (verJson.arguments?.game) {
        for (const param of verJson.arguments.game) {
            if (typeof param === "string") {
                args.push(substituteArgs(param, argparams));
            } else {
                if (checkRules(param.rules ?? [], {
                    os: { name: getOs(), arch: arch(), version: release() },
                    has_custom_resolution: true,
                })) {
                    const tmp = Array.isArray(param.value)
                        ? param.value.join("|$|")
                        : `${param.value}`;
                    args.push(...substituteArgs(tmp, argparams).split("|$|"));
                }
            }
        }
    }

    return args;
}

export async function launchGame(basepath: string, game: string) {
    const gconfig = loadConfig(basepath, game);
    const users = getUsers();
    if (users.length === 0) {
        console.log(chalk.red(t("launch_precheck_no_users")));
        return;
    }
    const user = await select({
        message: t("launch_user_select_prompt"),
        choices: users.map((p) => ({
            value: p,
            name: `${p.name} (${t("user_type." + p.type)})`,
            description: t("launch_user_select_user_desc", p.uuid, t("user_type." + p.type)),
            short: `${p.name} (${t("user_type." + p.type)})`,
        })),
    });

    const verJson = JSON.parse(
        fs.readFileSync(`${basepath}/versions/${game}/${game}.json`, { encoding: "utf-8" }),
    ) as VersionInfo;

    await ensureAssets(verJson, basepath, game);
    await ensureLibraries(verJson, basepath, game);

    const { extractDir, libraryPaths } = prepareLibraries(verJson, basepath, game);
    const argparams = buildArgParams(verJson, gconfig, user, basepath, game, extractDir, libraryPaths);
    const javaExe = gconfig.java || config.get<string>("java") || "java";
    const javaMajorVersion = getJavaMajorVersion(javaExe);

    const cmd: string[] = [
        ...buildJvmArgs(verJson, gconfig, basepath, game, argparams, javaMajorVersion),
        verJson.mainClass ?? "",
        ...buildGameArgs(verJson, argparams),
    ].filter(Boolean);

    const commandStr = cmd.map((p) => (p.includes(" ") ? `"${p}"` : p)).join(" ");
    console.log(commandStr);
    console.log(chalk.green(t("launch_starting")));
    console.log("java: ", javaExe);

    const ps = spawn(javaExe, cmd, { stdio: "inherit", shell: false, cwd: basepath });
    ps.on("exit", (num) => {
        if (num != 0) {
            console.log(chalk.red("---"));
            console.log(chalk.red(`exit code: ${num}`));
            const javaVersionData = execSync(`"${javaExe}" --version`).toString();
            console.log("help from launchers:");
            console.log(javaVersionData);
            console.log(`Recommended Java Version of this Minecraft Version: ${JSON.stringify(verJson.javaVersion)}`);
        }
    });
}
