import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";
import { MinecraftLibrary, MinecraftRule, RuleOsInfo } from "./types.ts";

export function isValidFileName(filename: string): boolean {
    if (!filename || filename.length === 0 || filename.length > 255) {
        return false;
    }
    if (filename === "." || filename === "..") return false;
    if (filename.includes("/") || filename.includes("\\")) return false;
    // deno-lint-ignore no-control-regex
    const illegalChars = /[<>:"|?*\u0000-\u001F]/gu;
    if (illegalChars.test(filename)) return false;
    if (/\.\./gu.test(filename)) return false;
    if (/[\s.]$/u.test(filename)) return false;
    const unicodeControlChars = /[\p{C}]/gu;
    if (unicodeControlChars.test(filename)) return false;
    return /^[^\s.]/u.test(filename) && filename.trim() === filename;
}

export function arch(): string {
    const a = process.arch;
    if (a === "ia32") return "x86";
    return a;
}

export function expandTilde(filePath: string) {
    if (filePath.startsWith("~/")) {
        return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
}

export function getOs(): string {
    if (os.platform() === "win32") {
        return "windows";
    }
    if (os.platform() === "darwin") {
        return "osx";
    }
    return "linux";
}

export function getArchSuffix(): string {
    const res = arch();
    if (res === "x64") {
        return "";
    }
    return "-" + res;
}

export function checkRules(rules: MinecraftRule[], features: { os?: RuleOsInfo; has_custom_resolution?: boolean; [key: string]: unknown } = {}): boolean {
    for (const rule of rules) {
        let isRuleMatched = true;

        if (rule.os) {
            const osRule = rule.os;
            const currentOS = features.os || {};
            if (osRule.name && currentOS.name !== osRule.name) {
                isRuleMatched = false;
            }
            if (osRule.version) {
                const versionRegex = new RegExp(osRule.version);
                if (!versionRegex.test(currentOS.version || "")) {
                    isRuleMatched = false;
                }
            }
            if (osRule.arch && currentOS.arch !== osRule.arch) {
                isRuleMatched = false;
            }
        }

        if (rule.features) {
            const featureConditions = rule.features;
            for (const [key, value] of Object.entries(featureConditions)) {
                if (features[key] !== value) {
                    isRuleMatched = false;
                    break;
                }
            }
        }

        if (isRuleMatched) {
            return rule.action === "allow";
        }
    }

    return false;
}

export function rmDupLibs(libraries: MinecraftLibrary[]) {
    const libs: MinecraftLibrary[] = [];
    const lib_names: string[] = [];
    libraries.forEach((x) => {
        const libname = x.name.split(":").slice(0, 2).join(":");
        if (x.name.includes("natives")) {
            libs.push(x);
        } else if (!lib_names.includes(libname)) {
            libs.push(x);
            lib_names.push(libname);
        } else {
            console.log("disabled duplicated library: " + x.name);
        }
    });
    return libs;
}

export function parseLibNameToPath(name: string) {
    const splitted = name.split(":");
    const path = splitted[0].replaceAll(".", "/") + "/" + splitted[1] +
        "/" + splitted[2] + "/" +
        splitted.slice(1, splitted.length).join("-") + ".jar";
    return path;
}

export async function sha1Hex(data: Uint8Array): Promise<string> {
    // Copy to avoid SharedArrayBuffer type issues with crypto.subtle
    const buf = new Uint8Array(data.byteLength);
    buf.set(data);
    const hash = await crypto.subtle.digest("SHA-1", buf);
    const hashArray = new Uint8Array(hash);
    return Array.from(hashArray, (b) => b.toString(16).padStart(2, "0")).join("");
}
