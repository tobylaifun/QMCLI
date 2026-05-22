import chalk from "chalk";
import { config } from "./config";
import { DownloadQueue, DownloadTask } from "./downloader";
import { m } from "./mirrors";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import McLauncherProfiles from "../mc/launcher_profiles.json";
import {
    checkRules,
    getArchSuffix,
    getOs,
    parseLibNameToPath,
    rmDupLibs,
} from "./utils";
// import zl from "zip-lib";
import AdmZip from "adm-zip";
import jsSHA from "jssha";
import { execSync, spawn, spawnSync } from "node:child_process";
import arch from "arch";
import { platform, release, version } from "node:os";
import McLog4j2Xml from "../mc/log4j2.xml";
import { select } from "@inquirer/prompts";
import { getUsers } from "./users";
import { t } from "../translations/translate";
import packageJson from "../package.json";
import { loadConfig } from "./versionsConfig";

export interface MCVersion {
    id: string;
    type: string;
    url: string;
    time: string;
    releaseTime: string;
}

export async function getVersions(): Promise<MCVersion[]> {
    const verUrl = m(
        "https://launchermeta.mojang.com/mc/game/version_manifest.json",
    );
    const resp = await fetch(verUrl);
    const data = await resp.json();
    return data.versions;
}

function createPathIfNotExists(path: string) {
    if (!fs.existsSync(path)) fs.mkdirSync(path, { recursive: true });
}

export async function fetchAsset(verInfo: any, path: string, gameName: string) {
    // will check and download new assets
    const { assets, assetIndex } = verInfo;
    let totalSize = 0;
    const assetIndexContent = await (await fetch(m(assetIndex.url))).json();
    createPathIfNotExists(`${path}/assets/indexes`);
    createPathIfNotExists(`${path}/assets/objects`);
    createPathIfNotExists(`${path}/assets/virtual`);
    createPathIfNotExists(`${path}/assets/skins`);
    fs.writeFileSync(
        `${path}/assets/indexes/${assetIndex.id}.json`,
        JSON.stringify(assetIndexContent),
    );
    const tasks: DownloadTask[] = [];
    const legacy = assetIndex.id === "legacy";
    for (const name in assetIndexContent.objects) {
        const hash = assetIndexContent.objects[name].hash;
        const url = m(
            `https://resources.download.minecraft.net/${
                hash.substring(0, 2)
            }/${hash}`,
        );
        const file = legacy
            ? `${path}/assets/virtual/legacy/${name}`
            : `${path}/assets/objects/${hash.substring(0, 2)}/${hash}`;
        if (fs.existsSync(file)) {
            // check sha1 of existing file
            const content: Uint8Array = new Uint8Array(fs.readFileSync(file));
            const sha1 = new jsSHA("SHA-1", "UINT8ARRAY").update(content)
                .getHash("HEX");
            if (sha1 !== assetIndexContent.objects[name].hash) {
                console.log(
                    chalk.yellow(t("asset_hash_mismatch_redownload", name)),
                );
            } else {
                continue;
            }
        }
        createPathIfNotExists(nodePath.dirname(file));
        tasks.push({
            url,
            filename: file,
            extra: { size: assetIndexContent.objects[name].size },
        });
        totalSize += assetIndexContent.objects[name].size;
    }
    return {
        tasks,
        totalSize,
    };
}

export async function fetchLibraries(
    verInfo: any,
    basepath: string,
    gameName: string,
) {
    const tasks = [];
    let totalSize = 0;
    // libraries
    createPathIfNotExists(`${basepath}/libraries`);
    for (const lib of verInfo.libraries) {
        let artifact: any;
        if (lib.url && !lib.downloads) {
            const path = parseLibNameToPath(lib.name);
            artifact={
                path: path,
                url: lib.url + path,
            }
        } else {
            // const { downloads: { artifact } } = lib;
            artifact = lib.downloads?.artifact;
        }
        if (artifact) {
            const { path, url, size, sha1 } = artifact;
            const filename = `${basepath}/libraries/${path}`;
            let push = true;
            if (!sha1 && fs.existsSync(filename)) {
                push = false;
            } else if (fs.existsSync(filename)) {
                // check sha1 of existing file
                const content: Uint8Array = new Uint8Array(
                    fs.readFileSync(filename),
                );
                const newsha1 = new jsSHA("SHA-1", "UINT8ARRAY").update(
                    content,
                )
                    .getHash("HEX");
                if (newsha1 == sha1) {
                    push = false;
                } else {
                    console.log(
                        chalk.yellow(
                            t("asset_hash_mismatch_redownload", path),
                        ),
                    );
                }
            }
            if (push) {
                tasks.push({
                    url: m(url),
                    filename: filename,
                    extra: { size },
                });
                totalSize += size;
                createPathIfNotExists(
                    nodePath.dirname(filename),
                );
            }
        }
        // if have classifiers
        if (lib.downloads?.classifiers) {
            for (
                const [key, val] of Object.entries<any>(
                    lib.downloads.classifiers,
                )
            ) {
                const { path, url, size, sha1 } = val;
                const filename = `${basepath}/libraries/${path}`;
                let push = true;
                if (fs.existsSync(filename)) {
                    // check sha1 of existing file
                    const content: Uint8Array = new Uint8Array(
                        fs.readFileSync(filename),
                    );
                    const newsha1 = new jsSHA("SHA-1", "UINT8ARRAY").update(
                        content,
                    )
                        .getHash("HEX");
                    if (newsha1 == sha1) {
                        push = false;
                    } else {
                        console.log(
                            chalk.yellow(
                                t("asset_hash_mismatch_redownload", path),
                            ),
                        );
                    }
                }
                if (push) {
                    tasks.push({
                        url: m(url),
                        filename: filename,
                        extra: { size },
                    });
                    totalSize += size;
                    createPathIfNotExists(
                        nodePath.dirname(filename),
                    );
                }
            }
        }
    }
    return {
        tasks,
        totalSize,
    };
}

export function getVersionFromVerJson(verJson: any) {
    if (verJson.qmcli_ver_id !== undefined) {
        return verJson.qmcli_ver_id;
    }
    if (verJson.patches) {
        const patch = verJson.patches.find((p: any) => p.id == "game");
        if (patch && patch.version) return patch.version;
    }
    return verJson.id;
}

export async function downloadVersion(
    verUrl: string,
    basepath: string,
    gameName: string,
): Promise<void> {
    const versionPath = `${basepath}/versions/${gameName}`;
    createPathIfNotExists(versionPath);
    const verInfo = await (await fetch(verUrl)).json();
    const originalVerInfo = JSON.parse(JSON.stringify(verInfo));
    verInfo.qmcli_ver_id = verInfo.id;
    verInfo.patches = verInfo.patches || [];
    verInfo.patches.push({
        ...originalVerInfo,
        id: "game",
        priority: 0,
        version: verInfo.id,
    });
    verInfo.id = gameName;
    fs.writeFileSync(
        `${versionPath}/${gameName}.json`,
        JSON.stringify(verInfo, null, 4),
    );
    const tasks: DownloadTask[] = [];
    const assets = await fetchAsset(verInfo, basepath, gameName);
    let totalSize = assets.totalSize;
    // assetsIndex json
    tasks.push(...assets.tasks);
    const libraries = await fetchLibraries(verInfo, basepath, gameName);
    totalSize += libraries.totalSize;
    tasks.push(...libraries.tasks);

    // client.jar
    const { downloads: { client } } = verInfo;
    tasks.push({
        url: client.url,
        filename: `${versionPath}/${gameName}.jar`,
        extra: { size: client.size },
    });
    totalSize += client.size;
    // logging
    // will use custom log4j2.xml
    // if (verInfo.logging?.client?.file?.id) {
    //     const { logging: { client: { file: { id, sha1, size, url } } } } =
    //         verInfo;
    //     tasks.push({
    //         url: m(url),
    //         filename: `${versionPath}/${id}`,
    //         extra: { size },
    //     });
    // }
    // sort task by size (descending)
    tasks.sort((a, b) => b.extra.size - a.extra.size);
    console.log(chalk.green(t("start_download")));
    let dl = new DownloadQueue(16, { totalSize });
    for (const task of tasks) {
        dl.addTask(task);
    }
    await dl.wait();
    console.log(chalk.green(t("download_completed")));
    console.log(chalk.cyan(t("creating_neccessary_files")));
    // launcher profiles
    if (!fs.existsSync(`${basepath}/launcher_profiles.json`)) {
        fs.writeFileSync(
            `${basepath}/launcher_profiles.json`,
            JSON.stringify(McLauncherProfiles),
        );
    }
    console.log(chalk.green(t("done")));
}

export async function listGames(basepath: string) {
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

function cpSep() {
    if (getOs() == "windows") return ";";
    return ":";
}

export async function launchGame(basepath: string, game: string) {
    const gconfig = loadConfig(basepath, game);
    // login
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
            description: t(
                "launch_user_select_user_desc",
                p.uuid,
                t("user_type." + p.type),
            ),
            short: `${p.name} (${t("user_type." + p.type)})`,
        })),
    });
    let verJson = JSON.parse(
        fs.readFileSync(`${basepath}/versions/${game}/${game}.json`, {
            encoding: "utf-8",
        }),
    );
    // verJson=mergeVerJsonPatches(verJson,true);
    // fetch asset
    console.log(chalk.blue(t("launch_fetching_asset")));
    try {
        const { tasks, totalSize } = await fetchAsset(verJson, basepath, game);
        if (tasks.length != 0) {
            let dl = new DownloadQueue(16, { totalSize });
            for (const task of tasks) {
                dl.addTask(task);
            }
            await dl.wait();
        }
        console.log(chalk.blue(t("launch_fetched_asset")));
    } catch (e) {
        console.log(chalk.red(t("err_failed")));
        console.log(e);
    }
    // fetch libraries
    console.log(chalk.blue(t("launch_fetching_libraries")));
    try {
        {
            const { tasks, totalSize } = await fetchLibraries(
                verJson,
                basepath,
                game,
            );
            if (tasks.length != 0) {
                let dl = new DownloadQueue(16, { totalSize });
                for (const task of tasks) {
                    dl.addTask(task);
                }
                await dl.wait();
            }
        }
        console.log(chalk.blue(t("launch_fetched_libraries")));
    } catch (e) {
        console.log(chalk.red(t("err_failed")));
        console.log(e);
    }
    // extract natives
    // a much more easy way: check file names
    console.log(chalk.blue(t("launch_extracting_natives")));
    const os = getOs();
    const suffix = getArchSuffix();
    const extractLibs: string[] = [];
    let libraries_dat: any[] = [];
    const extractDir = `${basepath}/versions/${game}/natives-${os}${suffix}`;
    for (const lib of verJson.libraries) {
        if(!lib.downloads&&lib.url){
            const path=parseLibNameToPath(lib.name)
            libraries_dat.push({
                downloads:{
                    artifact:{
                        path: path,
                        url: lib.url+path
                    },
                },
                name: lib.name
            })
        }
        // no suffix
        if (lib.downloads?.artifact) {
            if (lib.downloads.artifact.path.includes(`natives-${os}`)) {
                extractLibs.push(lib.downloads.artifact.path);
            }
            // check rules
            if (
                lib.rules && checkRules(lib.rules, {
                    os: { name: getOs(), arch: arch(), version: release() },
                })
            ) {
                libraries_dat.push(lib);
            } else if (!lib.rules) {
                libraries_dat.push(lib);
            }
        }
        if (lib.downloads?.classifiers) {
            if (lib.downloads.classifiers[`natives-${os}`]) {
                extractLibs.push(
                    lib.downloads.classifiers[`natives-${os}`].path,
                );
            }
        }
        // has suffix
        if (suffix != "") {
            if (lib.downloads?.artifact) {
                if (
                    lib.downloads.artifact.path.includes(
                        `natives-${os}${suffix}`,
                    )
                ) {
                    extractLibs.push(lib.downloads.artifact.path);
                }
            }
            if (lib.downloads?.classifiers) {
                if (lib.downloads.classifiers[`natives-${os}${suffix}`]) {
                    extractLibs.push(
                        lib.downloads.classifiers[`natives-${os}${suffix}`]
                            .path,
                    );
                }
            }
        }
    }
    libraries_dat = rmDupLibs(libraries_dat);
    let libraries: string[] = libraries_dat.map((x: any) =>
        `${basepath}/libraries/${x.downloads.artifact.path}`
    );
    libraries.push(`${basepath}/versions/${game}/${game}.jar`);
    fs.mkdirSync(`${extractDir}/tmp`, { recursive: true });
    for (const lib of extractLibs) {
        // console.log(chalk.blue(`extracting ${lib}...`));
        // await zl.extract(`${basepath}/libraries/${lib}`, `${extractDir}/tmp`);
        const zip = new AdmZip(`${basepath}/libraries/${lib}`);
        zip.extractAllTo(`${extractDir}/tmp`, true);
    }
    // fs recursively get all the files in /tmp folder
    // and move them to the natives folder
    console.log(chalk.blue(t("launch_moving_files")));
    fs.readdirSync(`${extractDir}/tmp`, {
        withFileTypes: true,
        recursive: true,
    }).forEach(
        (file) => {
            if (
                file.isFile() && !file.name.endsWith(".git") &&
                !file.name.endsWith(".sha1") && !file.name.endsWith(".class")
            ) {
                fs.copyFileSync(
                    nodePath.join(
                        file.parentPath,
                        file.name,
                    ),
                    nodePath.join(
                        extractDir,
                        file.name,
                    ),
                );
            }
        },
    );
    // delete tmp
    fs.rmSync(`${extractDir}/tmp`, { recursive: true });
    console.log(chalk.green(t("launch_extracting_natives_done")));
    // parse start up arguments
    const cmd = [];
    // parse arguments above
    const argparams = {
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
        "classpath": `${libraries.join(cpSep())}`,
        "resolution_width": gconfig.size!.width,
        "resolution_height": gconfig.size!.height,

        // user stuff
        "auth_player_name": user.name,
        "auth_uuid": user.uuid,
        "auth_access_token": user.auth_access_token,
        "user_properties": "{}",
        "user_type": "msa",
    };
    cmd.push(
        // ram min
        "-Xmn" + gconfig.ram!.min,
        // ram max
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
        // UTF-8
        "-Dfile.encoding=UTF-8"
    );
    fs.writeFileSync(
        `${basepath}/versions/${game}/log4j2-qmcli.xml`,
        McLog4j2Xml,
        { encoding: "utf-8" },
    );
    cmd.push(
        verJson.logging.client.argument.replaceAll(
            "${path}",
            `${basepath}/versions/${game}/log4j2-qmcli.xml`,
        ),
    );
    cmd.push(`-Dminecraft.client.jar=${basepath}/versions/${game}/${game}.jar`);
    let javaMajorVersion = 0;
    try {
        const jre = gconfig.java || config.get("java");
        const verOut = execSync(`"${jre}" --version 2>&1`).toString();
        const match = verOut.match(/(\d+)/);
        if (match) javaMajorVersion = parseInt(match[1]);
    } catch {}
    const parseJvmArgs = (args: any) => {
        for (const param of args) {
            if (typeof param === "string") {
                let tmp = param;
                for (const [key, value] of Object.entries(argparams)) {
                    tmp = tmp.replaceAll(`$\{${key}\}`, value);
                }
                if (tmp.startsWith("--sun-misc-unsafe-memory-access") && javaMajorVersion < 23) {
                    continue;
                }
                cmd.push(tmp);
            } else {
                // parse rules
                if (
                    checkRules(param.rules, {
                        os: { name: getOs(), arch: arch(), version: release() },
                    })
                ) {
                    let tmp = Array.isArray(param.value)
                        ? param.value.map((p: string) => `${p}`).join(" ")
                        : `${param.value}`;
                    for (const [key, value] of Object.entries(argparams)) {
                        tmp = tmp.replaceAll(`$\{${key}\}`, value);
                    }
                    if (tmp.startsWith("--sun-misc-unsafe-memory-access") && javaMajorVersion < 23) {
                        continue;
                    }
                    cmd.push(tmp);
                }
            }
        }
    };
    if (verJson.arguments) {
        // 1.13+
        // jvm
        parseJvmArgs(verJson.arguments.jvm);
        cmd.push(verJson.mainClass);
        for (const param of verJson.arguments.game) {
            if (typeof param === "string") {
                let tmp = param;
                for (const [key, value] of Object.entries(argparams)) {
                    tmp = tmp.replaceAll(`$\{${key}\}`, value);
                }
                cmd.push(tmp);
            } else {
                if (
                    checkRules(param.rules, {
                        os: { name: getOs(), arch: arch(), version: release() },
                        has_custom_resolution: true,
                    })
                ) {
                    let tmp = Array.isArray(param.value)
                        ? param.value.map((p: string) => `${p}`).join("|$|")
                        : `${param.value}`;
                    for (const [key, value] of Object.entries(argparams)) {
                        tmp = tmp.replaceAll(`$\{${key}\}`, value);
                    }
                    cmd.push(...tmp.split("|$|"));
                }
            }
        }
    } else if (verJson.minecraftArguments) {
        // now we need to modify jvm stuff on our own
        parseJvmArgs([
            {
                "rules": [
                    {
                        "action": "allow",
                        "os": {
                            "name": "osx",
                        },
                    },
                ],
                "value": [
                    "-XstartOnFirstThread",
                ],
            },
            {
                "rules": [
                    {
                        "action": "allow",
                        "os": {
                            "name": "windows",
                        },
                    },
                ],
                "value":
                    "-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump",
            },
            {
                "rules": [
                    {
                        "action": "allow",
                        "os": {
                            "arch": "x86",
                        },
                    },
                ],
                "value": "-Xss1M",
            },
            "-Djava.library.path=${natives_directory}",
            "-Djna.tmpdir=${natives_directory}",
            "-Dorg.lwjgl.system.SharedLibraryExtractPath=${natives_directory}",
            "-Dio.netty.native.workdir=${natives_directory}",
            "-Dminecraft.launcher.brand=${launcher_name}",
            "-Dminecraft.launcher.version=${launcher_version}",
            "-cp",
            "${classpath}",
        ]);
        cmd.push(verJson.mainClass);
        let args = verJson.minecraftArguments.split(" ");
        for (const param of args) {
            if (param.startsWith("${")) {
                let tmp = param;
                for (const [key, value] of Object.entries(argparams)) {
                    tmp = tmp.replaceAll(`$\{${key}\}`, value);
                }
                cmd.push(tmp);
            } else {
                cmd.push(param);
            }
        }
        // extras
        cmd.push(...[
            "--width",
            argparams.resolution_width,
            "--height",
            argparams.resolution_height,
        ]);
    }
    if (user.type === "offline") {}

    let command = cmd.map((p) => {
        if (p.includes(" ")) {
            return `"${p}"`;
        } else return p;
    }).join(" ");
    console.log(command)
    console.log(chalk.green(t("launch_starting")));
    const javaexe = gconfig.java || config.get("java");
    console.log("java: ", javaexe);
    const ps = spawn(javaexe, cmd, {
        stdio: "inherit",
        shell: false,
        cwd: basepath,
    });
    ps.on("exit", (num) => {
        if (num != 0) {
            console.log(chalk.red("---"));
            console.log(chalk.red(`exit code: ${num}`));
            let javaVersionData = execSync(`"${javaexe}" --version`).toString();
            console.log("help from launchers:");
            console.log(javaVersionData);
            console.log(
                `Recommended Java Version of this Minecraft Version: ${
                    JSON.stringify(verJson.javaVersion)
                }`,
            );
        }
    });
}

export function deleteGame(basepath: string, game: string) {
    fs.rmSync(nodePath.join(basepath, "versions", game), { recursive: true });
}
