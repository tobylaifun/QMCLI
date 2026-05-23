import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";

function getConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  const configDir = path.join(homeDir, ".config", "qmcli");
  fs.mkdirSync(configDir, { recursive: true });
  return path.join(configDir, "config.json");
}

class SimpleConfig {
  private data: Record<string, unknown>;
  private filePath: string;

  constructor(defaults: Record<string, unknown>) {
    this.filePath = getConfigPath();
    try {
      this.data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
    } catch {
      this.data = { ...defaults };
      this.save();
    }
  }

  get<T = unknown>(key: string): T {
    return this.data[key] as T;
  }

  set<T>(key: string, value: T): void {
    this.data[key] = value;
    this.save();
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

export const config = new SimpleConfig({
    users: [],
    mirror: "official",
    paths: ["~/.minecraft"],
    lang: "en",
    java: "java"
});