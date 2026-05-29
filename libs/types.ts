export interface RuleOsInfo {
    name?: string;
    version?: string;
    arch?: string;
}

/** Minecraft rule (allow/disallow based on OS/features) */
export interface MinecraftRule {
    action?: string;
    os?: RuleOsInfo;
    features?: Record<string, boolean>;
    value?: string | string[];
}

/** Minecraft artifact download info */
export interface ArtifactInfo {
    path?: string;
    url?: string;
    size?: number;
    sha1?: string;
}

/** Minecraft library entry in version JSON */
export interface MinecraftLibrary {
    name: string;
    url?: string;
    downloads?: {
        artifact?: ArtifactInfo;
        classifiers?: Record<string, ArtifactInfo>;
    };
    rules?: MinecraftRule[];
}

export interface AssetIndex {
    url: string;
    id: string;
    totalSize?: number;
}

/** Version downloads (client, server, mappings) */
export interface VersionDownloads {
    client: ArtifactInfo;
    server?: ArtifactInfo;
    client_mappings?: ArtifactInfo;
    server_mappings?: ArtifactInfo;
}

/** A rule-gated argument value (used in arguments.jvm / arguments.game) */
export interface MinecraftRuleArg {
    rules?: MinecraftRule[];
    value?: string | string[];
}

/** Version arguments (new format) */
export interface VersionArguments {
    game: (string | MinecraftRuleArg)[];
    jvm: (string | MinecraftRuleArg)[];
}

export interface LoggingConfig {
    client: {
        argument: string;
        file: ArtifactInfo;
        type: string;
    };
}

/** A patch entry injected by QMCLI */
export interface PatchEntry {
    id: string;
    version?: string;
    mainClass?: string;
    arguments?: { game?: string[] };
    priority?: number;
    [key: string]: unknown;
}

/** Full Minecraft version info from version JSON (Mojang schema + QMCLI patches) */
export interface VersionInfo {
    id: string;
    type?: string;
    url?: string;
    time?: string;
    releaseTime?: string;
    mainClass?: string;
    minecraftArguments?: string;
    minimumLauncherVersion?: number;
    assets?: string;
    assetIndex?: AssetIndex;
    downloads?: VersionDownloads;
    libraries?: MinecraftLibrary[];
    arguments?: VersionArguments;
    logging?: LoggingConfig;
    javaVersion?: { component: string; majorVersion: number };
    // QMCLI injected fields
    qmcli_ver_id?: string;
    patches?: PatchEntry[];
    [key: string]: unknown;
}
