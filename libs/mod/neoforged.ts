import { m } from "../mirrors.ts";
import { InstallerEntry } from "./base.ts";
import { ForgeInstaller } from "./forge.ts";

export class NeoForgedInstaller extends ForgeInstaller {
  static override loader = "neoforged";
  static override apiRoot = "https://bmclapi2.bangbang93.com/neoforge/list";
  static override mavenRoot = "https://maven.neoforged.net/releases";
  static override mavenBackupRoot = "https://maven.neoforged.net/releases";

  static override getInstallerCandidates(
    mcversion: string,
    neoforgeVersion: string,
    branch?: string,
  ) {
    const classifier = neoforgeVersion;
    const installerName = `neoforge-${classifier}-installer.jar`;
    return [
      m(`${this.mavenRoot}/net/neoforged/neoforge/${classifier}/${installerName}`),
      m(`${this.mavenBackupRoot}/net/neoforged/neoforge/${classifier}/${installerName}`),
    ];
  }

  static override async getInstallersFromMcVersion(
    mcVersion: string,
  ): Promise<InstallerEntry[] | null> {
    const apiUrl = m(`${this.apiRoot}/${mcVersion}`);
    const res = await fetch(apiUrl, { headers: this.headers });
    if (!res.ok) return null;
    const versions = (await res.json()) as {
      rawVersion: string;
      version: string;
      mcversion: string;
    }[];
    if (!Array.isArray(versions) || versions.length === 0) return null;
    return versions.map((v) => ({
      version: v.version,
      mcversion: v.mcversion || mcVersion,
    }));
  }
}
