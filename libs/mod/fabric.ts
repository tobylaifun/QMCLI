import { m } from "../mirrors.ts";
import fs from "node:fs";
import { deepmerge } from "deepmerge-ts";
import { fetchLibraries } from "../versions.ts";
import { DownloadQueue } from "../downloader.ts";
import { parseLibNameToPath } from "../utils.ts";
import { VersionInfo } from "../types.ts";
import { addPatch, BaseInstaller, InstallerEntry } from "./base.ts";

export class FabricInstaller extends BaseInstaller {
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
    const supportedMcVersions = (await (await fetch(apiSupportedMcVersions, {
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
