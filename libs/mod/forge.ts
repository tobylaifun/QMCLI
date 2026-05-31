import { m } from "../mirrors.ts";
import nodePath from "node:path";
import fs from "node:fs";
import { fetchLibraries } from "../versions.ts";
import { DownloadQueue } from "../downloader.ts";
import { parseLibNameToPath, sha1Hex } from "../utils.ts";
import { MinecraftLibrary, VersionInfo } from "../types.ts";
import AdmZip from "adm-zip";
import { spawnSync } from "node:child_process";
import { config } from "../config.ts";
import process from "node:process";
import { addPatch, BaseInstaller, InstallerEntry } from "./base.ts";
import chalk from "chalk";
import { t } from "../../translations/translate.ts";

type ForgeProcessorProfile = {
  jar?: string;
  classpath?: string[];
  sides?: string[];
  outputs?: Record<string, string>;
  args?: string[];
};

type ForgeInstallProfile = Record<string, unknown> & {
  mcversion?: string;
  data?: Record<string, unknown>;
  install?: {
    filePath?: string;
    path?: {
      group: string;
      name: string;
      version: string;
      classifier?: string;
    };
  };
  processors?: ForgeProcessorProfile[];
  libraries?: MinecraftLibrary[];
  spec?: string;
  json?: string;
  versionInfo?: VersionInfo;
};

export class ForgeInstaller extends BaseInstaller {
  static loader = "forge";
  static apiRoot = "https://bmclapi2.bangbang93.com/forge/minecraft";
  static mavenRoot = "https://files.minecraftforge.net/maven";
  static mavenBackupRoot = "https://maven.minecraftforge.net";
  static headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  static getInstallerCandidates(
    mcversion: string,
    forgeVersion: string,
    branch?: string,
  ) {
    // Handle 1.7.10-pre4 special case
    const lookupVersion = mcversion === "1.7.10-pre4" ? "1.7.10_pre4" : mcversion;
    const effectiveBranch = mcversion === "1.7.10-pre4" ? "prerelease" : (branch ?? "");
    const branchSuffix = effectiveBranch ? `-${effectiveBranch}` : "";
    const classifier = `${lookupVersion}-${forgeVersion}${branchSuffix}`;
    const installerName = `forge-${classifier}-installer.jar`;
    const bmclUrl = new URL("https://bmclapi2.bangbang93.com/forge/download");
    bmclUrl.searchParams.set("mcversion", mcversion);
    bmclUrl.searchParams.set("version", forgeVersion);
    bmclUrl.searchParams.set("branch", effectiveBranch);
    bmclUrl.searchParams.set("category", "installer");
    bmclUrl.searchParams.set("format", "jar");
    return [
      m(`${this.mavenRoot}/net/minecraftforge/forge/${classifier}/${installerName}`),
      m(`${this.mavenBackupRoot}/net/minecraftforge/forge/${classifier}/${installerName}`),
      m(bmclUrl.toString()),
    ];
  }

  static async getInstallersFromMcVersion(
    mcVersion: string,
  ): Promise<InstallerEntry[] | null> {
    const apiUrl = m(`${this.apiRoot}/${mcVersion}`);
    const res = await fetch(apiUrl, { headers: this.headers });
    if (!res.ok) return null;
    const versions = (await res.json()) as {
      mcversion: string;
      version: string;
      branch?: string;
      files: { category: string; format: string }[];
    }[];
    return versions
      .filter((v) =>
        v.files?.some(
          (f) => f.category === "installer" && f.format === "jar",
        )
      )
      .map((v) => ({
        version: v.version,
        mcversion: v.mcversion || mcVersion,
        branch: v.branch ?? undefined,
      }));
  }

  static async downloadInstaller(
    entry: InstallerEntry,
    installerPath: string,
  ): Promise<void> {
    const candidates = entry.url
      ? [
        entry.url,
        ...this.getInstallerCandidates(entry.mcversion, entry.version, entry.branch),
      ]
      : this.getInstallerCandidates(entry.mcversion, entry.version, entry.branch);
    let lastError: Error | null = null;
    for (const candidate of candidates) {
      try {
        const resp = await fetch(candidate, { headers: this.headers });
        if (!resp.ok) {
          throw new Error(`${resp.status} ${resp.statusText}`);
        }
        const bytes = new Uint8Array(await resp.arrayBuffer());
        if (bytes.length === 0) {
          throw new Error("Downloaded Forge installer is empty");
        }
        fs.writeFileSync(installerPath, bytes);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw new Error(
      `Failed to download Forge installer for ${entry.mcversion}-${entry.version}: ${
        lastError?.message ?? "unknown"
      }`,
    );
  }

  static readZipText(zip: AdmZip, entryName: string) {
    const normalized = entryName.replace(/^\//, "");
    const entry = zip.getEntry(entryName) ?? zip.getEntry(normalized);
    if (!entry) return "";
    return entry.getData().toString("utf-8");
  }

  static extractZipEntry(
    zip: AdmZip,
    relativePath: string,
    cacheDir: string,
  ) {
    const normalized = relativePath.replace(/^\//, "");
    const entry = zip.getEntry(relativePath) ?? zip.getEntry(normalized);
    if (!entry) {
      return "";
    }
    const outDir = nodePath.join(cacheDir, "data");
    const outPath = nodePath.join(outDir, normalized);
    fs.mkdirSync(nodePath.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, entry.getData());
    return outPath;
  }

  static parseArtifactPath(coord: string) {
    let main = coord;
    let ext = "jar";
    if (coord.includes("@")) {
      const parts = coord.split("@");
      main = parts[0];
      ext = parts[1] || "jar";
    }
    const parts = main.split(":");
    const group = parts[0];
    const artifact = parts[1];
    const version = parts[2];
    const classifier = parts[3];
    const fileName = classifier
      ? `${artifact}-${version}-${classifier}.${ext}`
      : `${artifact}-${version}.${ext}`;
    const relPath = group.replaceAll(".", "/") + "/" + artifact + "/" +
      version + "/" + fileName;
    return relPath;
  }

  static resolveDataValue(
    value: string,
    installProfile: ForgeInstallProfile,
    zip: AdmZip,
    cacheDir: string,
    installerPath: string,
    basepath: string,
    game: string,
    side: "client" | "server",
    depth = 0,
  ): string {
    if (depth > 10) return value;
    if (value.startsWith("'") && value.endsWith("'")) {
      return value.slice(1, -1);
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      const coord = value.slice(1, -1);
      return nodePath.join(
        basepath,
        "libraries",
        this.parseArtifactPath(coord),
      );
    }

    // Character-level token replacement with \\ escape support
    const resolveToken = (key: string): string => {
      if (key === "SIDE") return side;
      if (key === "MINECRAFT_JAR" || key === "MINECRAFT_VERSION") {
        return nodePath.join(basepath, "versions", game, `${game}.jar`);
      }
      if (key === "ROOT") return basepath;
      if (key === "INSTALLER") return installerPath;
      if (key === "LIBRARY_DIR") {
        return nodePath.join(basepath, "libraries");
      }
      const dataVal = installProfile.data?.[key];
      if (typeof dataVal === "string") {
        return this.resolveDataValue(
          dataVal,
          installProfile,
          zip,
          cacheDir,
          installerPath,
          basepath,
          game,
          side,
          depth + 1,
        );
      }
      if (dataVal && typeof dataVal === "object") {
        const dataObject = dataVal as Record<string, unknown>;
        const picked = dataObject[side] ?? dataObject.client ??
          dataObject.server;
        if (typeof picked === "string") {
          return this.resolveDataValue(
            picked,
            installProfile,
            zip,
            cacheDir,
            installerPath,
            basepath,
            game,
            side,
            depth + 1,
          );
        }
      }
      return `{${key}}`;
    };

    let replaced = "";
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === "\\") {
        // Escape: output next character literally
        if (i + 1 < value.length) {
          replaced += value[++i];
        }
      } else if (c === "{") {
        // Find matching closing brace
        let j = i + 1;
        while (j < value.length && value[j] !== "}") {
          j++;
        }
        if (j >= value.length) {
          // Unclosed brace, output as-is
          replaced += c;
        } else {
          const key = value.substring(i + 1, j);
          i = j; // skip past closing brace
          replaced += resolveToken(key);
        }
      } else if (c === "'") {
        // Inline literal string: '...' → output content
        let j = i + 1;
        while (j < value.length && value[j] !== "'") {
          j++;
        }
        if (j >= value.length) {
          replaced += c;
        } else {
          replaced += value.substring(i + 1, j);
          i = j; // skip past closing quote
        }
      } else {
        replaced += c;
      }
    }

    const normalized = replaced.replace(/^\//, "");
    const entry = zip.getEntry(replaced) ?? zip.getEntry(normalized);
    if (entry) {
      return this.extractZipEntry(zip, normalized, cacheDir);
    }
    if (replaced !== value && /[{\[']/.test(replaced)) {
      return this.resolveDataValue(
        replaced,
        installProfile,
        zip,
        cacheDir,
        installerPath,
        basepath,
        game,
        side,
        depth + 1,
      );
    }
    return replaced;
  }

  static async downloadLibraries(
    libs: MinecraftLibrary[] | undefined,
    basepath: string,
    game: string,
  ) {
    if (!libs) return;
    const mavenUrl = m(`${this.mavenRoot}/`);
    for (const lib of libs) {
      if (!lib.downloads?.artifact) {
        const libPath = parseLibNameToPath(lib.name);
        lib.downloads = {
          artifact: {
            path: libPath,
            url: (lib.url || mavenUrl) + libPath,
          },
        };
      }
    }
    const { tasks, totalSize } = await fetchLibraries(
      { libraries: libs } as VersionInfo,
      basepath,
      game,
    );
    if (tasks.length > 0) {
      const dl = new DownloadQueue(16, { totalSize });
      for (const task of tasks) dl.addTask(task);
      await dl.wait();
    }
  }

  static installOldFormat(
    installProfile: ForgeInstallProfile,
    zip: AdmZip,
    basepath: string,
  ) {
    const profileJson = installProfile.versionInfo as VersionInfo;
    const install = installProfile.install;
    if (!install?.filePath) {
      throw new Error("Invalid Forge old installer: missing install.filePath");
    }
    const jarEntryName = install.filePath;
    const jarEntry = zip.getEntry(jarEntryName);
    if (!jarEntry) {
      throw new Error(
        `Forge installer missing expected jar entry: ${jarEntryName}`,
      );
    }
    const art = install.path;
    if (!art) {
      throw new Error("Invalid Forge old installer: missing install.path");
    }
    const mavenName =
      `${art.group}:${art.name}:${art.version}:${art.classifier ?? ""}`;
    const libPath = parseLibNameToPath(mavenName);
    const dest = nodePath.join(basepath, "libraries", libPath);
    fs.mkdirSync(nodePath.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, jarEntry.getData());
    }
    return profileJson;
  }

  static async installNewFormat(
    installProfile: ForgeInstallProfile,
    zip: AdmZip,
    basepath: string,
    game: string,
    cacheDir: string,
    installerPath: string,
  ) {
    const versionJsonPath = installProfile.json;
    if (!versionJsonPath) {
      throw new Error("Invalid Forge installer: missing json path");
    }
    const versionJsonRaw = this.readZipText(zip, versionJsonPath);
    if (!versionJsonRaw) {
      throw new Error(`Invalid Forge installer: missing ${versionJsonPath}`);
    }
    const profileJson = JSON.parse(versionJsonRaw) as VersionInfo;

    for (const entry of zip.getEntries()) {
      if (entry.entryName.startsWith("maven/") && !entry.isDirectory) {
        const relPath = entry.entryName.slice("maven/".length);
        const dest = nodePath.join(basepath, "libraries", relPath);
        fs.mkdirSync(nodePath.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest)) {
          fs.writeFileSync(dest, entry.getData());
        }
      }
    }

    const mavenBase = m(`${this.mavenRoot}/`);
    const processorCoords = new Set<string>();
    for (const proc of installProfile.processors ?? []) {
      if (proc.jar) processorCoords.add(proc.jar);
      for (const dep of proc.classpath ?? []) {
        if (dep) processorCoords.add(dep);
      }
    }
    const existingLibs = new Set<string>(
      (installProfile.libraries ?? [])
        .map((l) => l.name)
        .filter((name): name is string => Boolean(name)),
    );
    const extraLibs = Array.from(processorCoords)
      .filter((name) => !existingLibs.has(name))
      .map((name) => ({
        name,
        downloads: {
          artifact: {
            path: this.parseArtifactPath(name),
            url: mavenBase + this.parseArtifactPath(name),
          },
        },
      }));
    const processorLibs = [
      ...(installProfile.libraries ?? []),
      ...extraLibs,
    ];
    console.log(chalk.green(t("forge_downloading_libraries")));
    await this.downloadLibraries(processorLibs, basepath, game);

    const baseGamePath = nodePath.join(
      basepath,
      "versions",
      game,
      `${game}.json`,
    );
    const baseGameVerJson = JSON.parse(
      fs.readFileSync(baseGamePath, "utf-8"),
    ) as VersionInfo;
    const baseGamePatch = baseGameVerJson.patches?.find((p) => p.id === "game");
    const baseGameJson = (baseGamePatch ?? baseGameVerJson) as VersionInfo;
    await this.downloadLibraries(baseGameJson.libraries, basepath, game);

    const javaExe = config.get<string>("java") || "java";
    const logPath = nodePath.join(cacheDir, "forge-install.log");
    const side: "client" | "server" = "client";
    const cpSep = process.platform === "win32" ? ";" : ":";

    const getJarMainClass = (jarPath: string) => {
      const jarZip = new AdmZip(jarPath);
      const manifest = jarZip.getEntry("META-INF/MANIFEST.MF");
      if (!manifest) return "";
      const text = manifest.getData().toString("utf-8");
      const match = text.match(/\nMain-Class:\s*(.+)\s*/);
      return match ? match[1].trim() : "";
    };

    const activeProcessors = (installProfile.processors ?? []).filter(
      (proc) => !proc.sides || proc.sides.includes(side),
    );
    const totalProcessors = activeProcessors.length;
    let processorIndex = 0;

    for (const proc of activeProcessors) {
      processorIndex++;
      if (proc.sides && !proc.sides.includes(side)) continue;
      const outputs = proc.outputs ?? {};
      let upToDate = true;
      for (const [outKey, shaKey] of Object.entries(outputs)) {
        const outPath = this.resolveDataValue(
          String(outKey),
          installProfile,
          zip,
          cacheDir,
          installerPath,
          basepath,
          game,
          side,
        );
        const shaValue = this.resolveDataValue(
          String(shaKey),
          installProfile,
          zip,
          cacheDir,
          installerPath,
          basepath,
          game,
          side,
        );
        if (!fs.existsSync(outPath)) {
          upToDate = false;
          break;
        }
        if (shaValue) {
          const content: Uint8Array = new Uint8Array(fs.readFileSync(outPath));
          const fileSha = await sha1Hex(content);
          if (fileSha !== shaValue) {
            upToDate = false;
            break;
          }
        }
      }
      if (upToDate && Object.keys(outputs).length > 0) continue;

      const jarCoord = proc.jar;
      if (!jarCoord) {
        throw new Error("Forge processor missing jar coordinate");
      }
      console.log(chalk.green(t("forge_running_processors", processorIndex, totalProcessors)));
      console.log(chalk.gray(t("forge_processor_running", jarCoord)));
      const jarPath = nodePath.join(
        basepath,
        "libraries",
        this.parseArtifactPath(jarCoord),
      );
      const mainClass = getJarMainClass(jarPath);
      if (!mainClass) {
        throw new Error(`Missing Main-Class in ${jarCoord}`);
      }
      const procClasspath = [
        ...(proc.classpath ?? []).map((c: string) =>
          nodePath.join(basepath, "libraries", this.parseArtifactPath(c))
        ),
        jarPath,
      ].filter((p) => fs.existsSync(p));
      const args = (proc.args ?? []).map((arg: string) =>
        this.resolveDataValue(
          arg,
          installProfile,
          zip,
          cacheDir,
          installerPath,
          basepath,
          game,
          side,
        )
      );
      const classpath = procClasspath.join(cpSep);
      const logHeader = `\n[${new Date().toISOString()}] ${jarCoord}\n` +
        `java: ${javaExe}\n` +
        `main: ${mainClass}\n` +
        `cp: ${classpath}\n` +
        `args: ${args.join(" ")}\n`;
      fs.appendFileSync(logPath, logHeader);
      const outFd = fs.openSync(logPath, "a");
      const errFd = fs.openSync(logPath, "a");
      const res = spawnSync(javaExe, [
        "-cp",
        classpath,
        mainClass,
        ...args,
      ], { stdio: ["ignore", outFd, errFd] });
      fs.closeSync(outFd);
      fs.closeSync(errFd);
      if (res.status !== 0) {
        console.log(chalk.red(`Forge processor failed: ${jarCoord}`));
        console.log(chalk.red(`Details logged to: ${logPath}`));
        throw new Error(`Forge processor failed: ${jarCoord}`);
      }
      console.log(chalk.green(t("forge_processor_done", jarCoord)));
      for (const [outKey, shaKey] of Object.entries(outputs)) {
        const outPath = this.resolveDataValue(
          String(outKey),
          installProfile,
          zip,
          cacheDir,
          installerPath,
          basepath,
          game,
          side,
        );
        const shaValue = this.resolveDataValue(
          String(shaKey),
          installProfile,
          zip,
          cacheDir,
          installerPath,
          basepath,
          game,
          side,
        );
        if (shaValue && fs.existsSync(outPath)) {
          const content: Uint8Array = new Uint8Array(fs.readFileSync(outPath));
          const fileSha = await sha1Hex(content);
          if (fileSha !== shaValue) {
            throw new Error(`Forge processor checksum mismatch: ${outPath}`);
          }
        }
      }
    }

    return profileJson;
  }

  static async install(
    entry: InstallerEntry,
    basepath: string,
    game: string,
  ): Promise<void> {
    console.log(chalk.green(t("forge_installing")));
    const lookupVersion = entry.mcversion === "1.7.10-pre4" ? "1.7.10_pre4" : entry.mcversion;
    const effectiveBranch = entry.mcversion === "1.7.10-pre4" ? "prerelease" : (entry.branch ?? "");
    const branchSuffix = effectiveBranch ? `-${effectiveBranch}` : "";
    const classifier = `${lookupVersion}-${entry.version}${branchSuffix}`;
    const installerName = `forge-${classifier}-installer.jar`;
    const cacheDir = nodePath.join(basepath, "cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    const installerPath = nodePath.join(cacheDir, installerName);
    if (
      !fs.existsSync(installerPath) || fs.statSync(installerPath).size === 0
    ) {
      await this.downloadInstaller(entry, installerPath);
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(installerPath);
    } catch (_err) {
      fs.unlinkSync(installerPath);
      await this.downloadInstaller(entry, installerPath);
      zip = new AdmZip(installerPath);
    }

    const installProfileRaw = this.readZipText(zip, "install_profile.json");
    if (!installProfileRaw) {
      throw new Error("Invalid Forge installer: missing install_profile.json");
    }
    const installProfile = JSON.parse(installProfileRaw) as ForgeInstallProfile;
    let profileJson: VersionInfo;
    if (installProfile.install && installProfile.versionInfo) {
      profileJson = this.installOldFormat(
        installProfile,
        zip,
        basepath,
      );
    } else if (installProfile.spec != null) {
      profileJson = await this.installNewFormat(
        installProfile,
        zip,
        basepath,
        game,
        cacheDir,
        installerPath,
      );
    } else {
      throw new Error("Unrecognized Forge installer format");
    }

    if (profileJson.libraries) {
      const mavenUrl = m(`${this.mavenRoot}/`);
      for (const lib of profileJson.libraries) {
        if (!lib.downloads?.artifact) {
          const libPath = parseLibNameToPath(lib.name);
          lib.downloads = {
            artifact: {
              path: libPath,
              url: (lib.url || mavenUrl) + libPath,
            },
          };
        }
      }
    }

    const verFile = nodePath.join(basepath, "versions", game, `${game}.json`);
    const originalVerJson = JSON.parse(
      fs.readFileSync(verFile, "utf-8"),
    ) as VersionInfo;
    const patched = addPatch(
      originalVerJson,
      profileJson as Record<string, unknown>,
      {
        id: this.loader,
        priority: 30000,
        version: entry.version,
      },
    );
    fs.writeFileSync(verFile, JSON.stringify(patched, null, 4), "utf-8");
    console.log(chalk.green(t("forge_install_complete")));
  }
}
