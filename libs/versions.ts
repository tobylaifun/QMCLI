import chalk from "chalk";
import { config } from "./config.ts";
import { DownloadQueue, DownloadTask } from "./downloader.ts";
import { m } from "./mirrors.ts";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import McLauncherProfiles from "../mc/launcher_profiles.json" with { type: "json" };
import { parseLibNameToPath, sha1Hex } from "./utils.ts";
import { ArtifactInfo, VersionInfo } from "./types.ts";
import { t } from "../translations/translate.ts";

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

export async function fetchAsset(verInfo: VersionInfo, path: string, _gameName?: string) {
    const { assetIndex } = verInfo;
    if (!assetIndex) return { tasks: [] as DownloadTask[], totalSize: 0 };
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
            const content: Uint8Array = new Uint8Array(fs.readFileSync(file));
            const sha1 = await sha1Hex(content);
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
    verInfo: VersionInfo,
    basepath: string,
    _gameName?: string,
) {
    const tasks = [];
    let totalSize = 0;
    createPathIfNotExists(`${basepath}/libraries`);
    for (const lib of (verInfo.libraries ?? [])) {
        let artifact: ArtifactInfo | undefined;
        if (lib.url && !lib.downloads) {
            const filePath = parseLibNameToPath(lib.name);
            artifact = { path: filePath, url: lib.url + filePath };
        } else {
            artifact = lib.downloads?.artifact;
        }
        if (artifact) {
            const { path: artPath, url: artUrl, size: artSize, sha1: artSha1 } = artifact;
            const filename = `${basepath}/libraries/${artPath ?? ""}`;
            let push = true;
            if (!artSha1 && fs.existsSync(filename)) {
                push = false;
            } else if (fs.existsSync(filename)) {
                const content: Uint8Array = new Uint8Array(fs.readFileSync(filename));
                const newsha1 = await sha1Hex(content);
                if (newsha1 == artSha1) {
                    push = false;
                } else {
                    console.log(chalk.yellow(t("asset_hash_mismatch_redownload", artPath)));
                }
            }
            if (push && artUrl) {
                tasks.push({
                    url: m(artUrl),
                    filename: filename,
                    extra: { size: artSize ?? 0 },
                });
                totalSize += artSize ?? 0;
                createPathIfNotExists(nodePath.dirname(filename));
            }
        }
        if (lib.downloads?.classifiers) {
            for (const [_key, val] of Object.entries(lib.downloads.classifiers)) {
                const cls = val as ArtifactInfo;
                const { path: clsPath, url: clsUrl, size: clsSize, sha1: clsSha1 } = cls;
                const filename = `${basepath}/libraries/${clsPath ?? ""}`;
                let push = true;
                if (fs.existsSync(filename)) {
                    const content: Uint8Array = new Uint8Array(fs.readFileSync(filename));
                    const newsha1 = await sha1Hex(content);
                    if (newsha1 == clsSha1) {
                        push = false;
                    } else {
                        console.log(chalk.yellow(t("asset_hash_mismatch_redownload", clsPath)));
                    }
                }
                if (push && clsUrl) {
                    tasks.push({
                        url: m(clsUrl),
                        filename: filename,
                        extra: { size: clsSize ?? 0 },
                    });
                    totalSize += clsSize ?? 0;
                    createPathIfNotExists(nodePath.dirname(filename));
                }
            }
        }
    }
    return {
        tasks,
        totalSize,
    };
}


export async function downloadVersionMetadata(
    verUrl: string,
    basepath: string,
    gameName: string,
): Promise<VersionInfo> {
    const versionPath = `${basepath}/versions/${gameName}`;
    createPathIfNotExists(versionPath);
    const verInfo = await (await fetch(verUrl)).json() as VersionInfo;
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
    return verInfo;
}

export async function downloadVersionArtifacts(
    verInfo: VersionInfo,
    basepath: string,
    gameName: string,
): Promise<void> {
    const versionPath = `${basepath}/versions/${gameName}`;
    const tasks: DownloadTask[] = [];
    const assets = await fetchAsset(verInfo, basepath, gameName);
    let totalSize = assets.totalSize;
    tasks.push(...assets.tasks);
    const libraries = await fetchLibraries(verInfo, basepath, gameName);
    totalSize += libraries.totalSize;
    tasks.push(...libraries.tasks);
    const client = verInfo.downloads?.client;
    if (!client || !client.url) {
        throw new Error(`Missing client download URL for version "${verInfo.qmcli_ver_id ?? verInfo.id}"`);
    }
    tasks.push({
        url: client.url,
        filename: `${versionPath}/${gameName}.jar`,
        extra: { size: client.size ?? 0 },
    });
    totalSize += client.size ?? 0;
    tasks.sort((a, b) => (b.extra as { size: number }).size - (a.extra as { size: number }).size);
    console.log(chalk.green(t("start_download")));
    const dl = new DownloadQueue(16, { totalSize });
    for (const task of tasks) {
        dl.addTask(task);
    }
    await dl.wait();
    console.log(chalk.green(t("download_completed")));
    console.log(chalk.cyan(t("creating_neccessary_files")));
    if (!fs.existsSync(`${basepath}/launcher_profiles.json`)) {
        fs.writeFileSync(
            `${basepath}/launcher_profiles.json`,
            JSON.stringify(McLauncherProfiles),
        );
    }
    console.log(chalk.green(t("done")));
}

export async function downloadVersion(
    verUrl: string,
    basepath: string,
    gameName: string,
): Promise<void> {
    const verInfo = await downloadVersionMetadata(verUrl, basepath, gameName);
    await downloadVersionArtifacts(verInfo, basepath, gameName);
}