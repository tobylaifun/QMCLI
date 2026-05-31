import { Command } from "commander";
import { editor, confirm, input, search, select } from "@inquirer/prompts";
import yaml from "js-yaml"
import { config } from "./libs/config.ts";
import * as versionsMod from "./libs/versions.ts";
import { launchGame, listGames, deleteGame, getVersionFromVerJson } from "./libs/launcher.ts";
import packageJson from "./package.json" with { type: "json" };
import chalk from "chalk";
import * as fs from "node:fs";
import { expandTilde, isValidFileName } from "./libs/utils.ts";
import path from "node:path";
import {
    addUser,
    checkIsValid32UnsignedUUID,
    generateOfflineUUID,
    getUsers,
    removeUser,
    User,
} from "./libs/users.ts";
import { t, TransType,installTrans,languages } from "./translations/translate.ts";
import { m } from "./libs/mirrors.ts";
import { LauncherGameConfig, loadConfig, saveConfig } from "./libs/version_config.ts";
import { autoInstallPrompt, detectModLoader } from "./libs/mod_loader.ts";

const activedTrans: TransType = languages[config.get<string>("lang")];
installTrans(activedTrans);

const program = new Command();
program.name("qmcli").description(t("app_desc")).version(
    packageJson.version,
);

type Choice<Value> = {
    value: Value;
    name?: string;
    description?: string;
    short?: string;
    disabled?: boolean | string;
};

async function selectMcPath(): Promise<string> {
    return await select({
        message: t("select_mc_path_prompt"),
        choices: (config.get("paths") as string[]).map((p) => ({
            value: p,
            name: p,
            description: t("select_mc_path_desc"),
            short: p,
        })),
    });
}

const versionsCommand = new Command();
versionsCommand.name("versions");
versionsCommand.description(t("cmd_versions_desc"));
versionsCommand.command("add")
    .description(t("cmd_versions_add_desc"))
    .action(async () => {
        const showSnapshots = await confirm({
            message: t("cmd_versions_add_confirm_show_snapshots"),
        });
        console.log(chalk.green(t("cmd_versions_fetching_versions")));
        const versions = await versionsMod.getVersions();
        const choices: Choice<versionsMod.MCVersion>[] = versions.filter(
            (v) => {
                if (showSnapshots) {
                    return true;
                } else if (
                    v.type === "snapshot" || v.type === "old_beta" ||
                    v.type === "old_alpha"
                ) {
                    return false;
                } else {
                    return true;
                }
            },
        ).map((v) => {
            return {
                value: v,
                name: `${v.id} (${t("mctype." + v.type)})`,
                description: t("cmd_versions_list_version_desc", v.id, t("mctype." + v.type), v.releaseTime, v.time),
                short: v.id,
            };
        });
        const ver = await search({
            message: t("cmd_versions_add_select_version_prompt"),
            source(term: string | undefined) {
                if (!term) return choices;
                return choices.filter((c) => {
                    return c.name?.toLowerCase().includes(term.toLowerCase());
                });
            },
        });
        const pathSel = await selectMcPath();
        const gameName = await input({
            message: t("cmd_versions_enter_game_name_prompt"),
            default: ver.id,
            validate(value) {
                if (!value) {
                    return t("error_game_name_required");
                }
                if (!isValidFileName(value)) {
                    return t("error_game_name_invalid");
                }
                if (
                    fs.existsSync(
                        path.join(expandTilde(pathSel), "versions", value),
                    )
                ) {
                    return t("error_game_name_exists", value);
                }
                return true;
            },
        });
        console.log(chalk.green(t("summary_info")));
        console.log(chalk.green(t("summary_game_name", gameName)));
        console.log(chalk.green(t("summary_version", ver.id)));
        try {
            const verResp = await fetch(m(ver.url));
            const verJson = await verResp.json() as { javaVersion?: { majorVersion: number } };
            if (verJson.javaVersion?.majorVersion) {
                console.log(chalk.green(t("summary_java_version", verJson.javaVersion.majorVersion)));
            }
        } catch { /* ignore fetch errors */ }
        console.log(chalk.green(t("summary_minecraft_path", pathSel)));
        console.log(chalk.green(t("cmd_versions_add_tips_autoinstall")))
        const yes = await confirm({
            message: t("confirm_continue"),
        });
        if (!yes) {
            console.log(chalk.red(t("operation_canceled")));
            return;
        }
        console.log(chalk.green(t("operation_starting")));
        await versionsMod.downloadVersion(ver.url, expandTilde(pathSel), gameName);
        console.log(chalk.green(t("operation_completed")));
    });
versionsCommand.command("list")
    .description(t("cmd_versions_list_desc"))
    .action(async () => {
        const pathSel = await selectMcPath();
        const games = await listGames(expandTilde(pathSel));
        if (games.length === 0) {
            console.log(chalk.red(t("error_no_game_installed")));
            return;
        }
        const game = await select({
            message: t("cmd_versions_list_select_game_prompt"),
            choices: games.map((g) => {
                const verjson = JSON.parse(
                    fs.readFileSync(
                        `${expandTilde(pathSel)}/versions/${g}/${g}.json`,
                        "utf-8",
                    ),
                );
                const detected=detectModLoader(verjson);
                const javaVer = verjson.javaVersion?.majorVersion;
                const javaHint = javaVer ? ` | ${t("summary_java_version", javaVer)}` : "";
                return {
                    value: g,
                    name: g+(detected?` | (✅ ${detected})`:"")+javaHint,
                    description: t("cmd_versions_list_game_desc", g, getVersionFromVerJson(verjson))+(detected?` (✅ ${detected})`:"")+javaHint,
                    short: g,
                };
            }),
        });
        const action = await select({
            message: t("cmd_versions_list_select_action_prompt"),
            choices: [
                {
                    value: "launch",
                    name: t("cmd_versions_action_launch"),
                    description: t("cmd_versions_action_launch_desc"),
                },
                {
                    value: "edit",
                    name: t("cmd_versions_action_edit"),
                    description: t("cmd_versions_action_edit_desc"),
                },{
                    value: "autoinstall",
                    name: t("cmd_versions_action_autoinstall"),
                    description: t("cmd_versions_action_autoinstall_desc"),
                },
                {
                    value: "delete",
                    name: t("cmd_versions_action_delete"),
                    description: t("cmd_versions_action_delete_desc"),
                },
            ],
        });
        if (action === "launch") {
            console.log(chalk.green(t("operation_starting")));
            await launchGame(expandTilde(pathSel), game);
        } else if (action === "edit") {
            const config=loadConfig(expandTilde(pathSel),game);
            const yamlConfig=yaml.dump(config);
            const res=await editor({
                message: t("cmd_versions_action_edit_prompt"),
                default: yamlConfig,
                postfix: ".yml",
            });
            saveConfig(expandTilde(pathSel),game,yaml.load(res) as LauncherGameConfig);
            console.log(chalk.green(t("cmd_versions_action_edit_saved")));
        } else if(action==="autoinstall"){
            const verJson=JSON.parse(
                fs.readFileSync(
                    `${expandTilde(pathSel)}/versions/${game}/${game}.json`,
                    "utf-8",
                ),
            );
            await autoInstallPrompt(expandTilde(pathSel),game,getVersionFromVerJson(verJson) ?? game);
        }else if (action === "delete") {
            const confirm_ = await confirm({
                message: t("cmd_versions_action_delete_confirm", game),
                default: false,
            });
            if (confirm_) {
                console.log(chalk.green(t("operation_starting")));
                deleteGame(expandTilde(pathSel), game);
                console.log(chalk.green(t("operation_completed")));
            } else {
                console.log(chalk.red(t("operation_canceled")));
            }
        }
    });

program.addCommand(versionsCommand);

const settingsCommand = new Command();
settingsCommand.name("settings").description(t("cmd_settings_desc"));
settingsCommand.command("mirror")
    .description(t("cmd_settings_mirror_desc"))
    .action(async () => {
        const mirror = await select({
            message: t("cmd_settings_mirror_select_prompt", config.get("mirror")),
            default: config.get("mirror"),
            choices: [
                {
                    value: "official",
                    name: t("cmd_settings_mirror_option_official"),
                    description: t("cmd_settings_mirror_option_official_desc"),
                },
                {
                    value: "bmclapi",
                    name: t("cmd_settings_mirror_option_bmclapi"),
                    description: t("cmd_settings_mirror_option_bmclapi_desc"),
                },
            ],
        });
        config.set("mirror", mirror);
        console.log(chalk.green(t("cmd_settings_mirror_set_success", mirror)));
    });

const pathsCommand = settingsCommand.command("paths").description(
    t("cmd_settings_paths_desc"),
);
pathsCommand.command("add")
    .description(t("cmd_settings_paths_add_desc"))
    .action(async () => {
        const paths: string[] = config.get("paths");
        const pathSel = await input({
            message: t("cmd_settings_paths_add_prompt"),
            validate(value) {
                if (!value) {
                    return t("error_path_required");
                }
                if (!fs.existsSync(expandTilde(value))) {
                    return t("error_path_not_exist");
                }
                if (!fs.statSync(expandTilde(value)).isDirectory()) {
                    return t("error_path_not_directory");
                }
                if (
                    paths.includes(value) || paths.includes(expandTilde(value))
                ) {
                    return t("error_path_already_added");
                }
                return true;
            },
        });
        const addedPath = path.resolve(expandTilde(pathSel));
        paths.push(addedPath);
        config.set("paths", paths);
        console.log(chalk.green(t("cmd_settings_paths_add_success", addedPath)));
    });

pathsCommand.command("list")
    .description(t("cmd_settings_paths_list_desc"))
    .action(async () => {
        const paths: string[] = config.get("paths");
        if (paths.length === 0) {
            console.log(chalk.red(t("error_no_path_added")));
            return;
        }
        const pathSel = await select({
            message: t("cmd_settings_paths_list_select_prompt"),
            choices: paths.map((p) => {
                return {
                    value: p,
                    name: p,
                    description: t("cmd_settings_paths_list_select_desc"),
                    short: p,
                };
            }),
        });
        const action = await select({
            message: t("cmd_settings_paths_list_select_action_prompt"),
            choices: [
                {
                    value: "info",
                    name: t("cmd_settings_paths_list_action_info"),
                    description: t("cmd_settings_paths_list_action_info_desc"),
                },
                {
                    value: "remove",
                    name: t("cmd_settings_paths_list_action_remove"),
                    description: t("cmd_settings_paths_list_action_remove_desc"),
                },
            ],
        });
        if (action === "info") {
            console.log(chalk.blue(t("cmd_settings_paths_list_info_path", pathSel)));
            const games = await listGames(expandTilde(pathSel));
            if (games.length === 0) {
                console.log(chalk.red(t("error_no_game_installed")));
                return;
            }
            console.log(chalk.blue(t("cmd_settings_paths_list_info_games")));
            for (const g of games) {
                const verjson = JSON.parse(
                    fs.readFileSync(
                        `${expandTilde(pathSel)}/versions/${g}/${g}.json`,
                        "utf-8",
                    ),
                );
                console.log(
                    chalk.blue(t("cmd_settings_paths_list_info_game_entry", g, getVersionFromVerJson(verjson))),
                );
            }
        } else if (action === "remove") {
            const confirm_ = await confirm({
                message: t("cmd_settings_paths_list_action_remove_confirm", pathSel),
                default: false,
            });
            if (confirm_) {
                console.log(chalk.green(t("operation_starting")));
                config.set("paths", paths.filter((p) => p !== pathSel));
                console.log(chalk.green(t("operation_completed")));
            } else {
                console.log(chalk.red(t("operation_canceled")));
            }
        }
    });

settingsCommand.command("lang").description(t("cmd_settings_lang_desc"))
    .action(async () => {
        const lang = await select({
            message: t("cmd_settings_lang_select_prompt", config.get("lang")),
            default: config.get("lang"),
            choices: Object.keys(languages).map((l)=>{
                return {
                    value: l,
                    name: `${languages[l].lang_name} (${l})`,
                    short: l,
                }
            })
        });
        config.set("lang", lang);
        console.log(chalk.green(t("cmd_settings_lang_set_success", lang)))
    });

settingsCommand.command("java").description(t("cmd_settings_java_desc"))
    .action(async()=>{
        const javaexe=await input({
            message: t("cmd_settings_java_prompt",config.get("java")),
            default: config.get("java"),
            validate(value){
                if(!value){
                    return t("error_java_required");
                }
                return true;
            }
        });
        config.set("java",javaexe);
        console.log(chalk.green(t("cmd_settings_java_set_success", javaexe)))
    })

program.addCommand(settingsCommand);

const usersCommand = new Command();
usersCommand.name("users").description(t("cmd_users_desc"));
usersCommand.command("add")
    .description(t("cmd_users_add_desc"))
    .action(async () => {
        const type = await select({
            message: t("cmd_users_add_select_type_prompt"),
            choices: [
                {
                    value: "offline",
                    name: t("cmd_users_add_type_offline"),
                    description: t("cmd_users_add_type_offline_desc"),
                },
                {
                    value: "microsoft",
                    name: t("cmd_users_add_type_microsoft"),
                    description: t("cmd_users_add_type_microsoft_desc"),
                },
            ],
        });
        if (type === "offline") {
            const name = await input({
                message: t("cmd_users_add_name_prompt"),
                validate(value) {
                    if (!value) {
                        return t("error_name_required");
                    }
                    if (!/^[a-zA-Z0-9_]{3,16}$/.test(value)) {
                        return t("error_name_invalid");
                    }
                    return true;
                },
            });
            const uuid = await input({
                message: t("cmd_users_add_uuid_prompt"),
                default: generateOfflineUUID(name),
                validate(value) {
                    if (!checkIsValid32UnsignedUUID(value)) {
                        return t("error_uuid_invalid");
                    }
                    return true;
                },
            });
            const user: User = {
                name: name,
                uuid: uuid,
                type: "offline",
            };
            addUser(user);
            console.log(chalk.green(t("cmd_users_add_success", name)));
        }
    });
usersCommand.command("list")
    .description(t("cmd_users_list_desc"))
    .action(async () => {
        const users = getUsers();
        if (users.length === 0) {
            console.log(chalk.red(t("error_no_users")));
            return;
        }
        const user = await select({
            message: t("cmd_users_list_select_user_prompt"),
            choices: users.map((u) => {
                return {
                    value: u,
                    name: `${u.name} (${u.type})`,
                    description: t("cmd_users_list_user_desc", u.name, u.uuid, u.type),
                    short: u.name,
                };
            }),
        });
        const action = await select({
            message: t("cmd_users_list_select_action_prompt"),
            choices: [
                {
                    value: "info",
                    name: t("cmd_users_list_action_info"),
                    description: t("cmd_users_list_action_info_desc"),
                },
                {
                    value: "delete",
                    name: t("cmd_users_list_action_delete"),
                    description: t("cmd_users_list_action_delete_desc"),
                },
            ],
        });
        if (action === "info") {
            console.log(chalk.green(t("cmd_users_list_info_name", user.name)));
            console.log(chalk.green(t("cmd_users_list_info_uuid", user.uuid)));
            console.log(chalk.green(t("cmd_users_list_info_type", user.type)));
        } else if (action === "delete") {
            const confirm_ = await confirm({
                message: t("cmd_users_list_action_delete_confirm", user.name),
                default: false,
            });
            if (confirm_) {
                removeUser(user);
                console.log(chalk.green(t("cmd_users_list_action_delete_success")));
            } else {
                console.log(chalk.red(t("cmd_users_list_action_delete_cancel")));
            }
        }
    });

program.addCommand(usersCommand);

if (program.args.length === 0 && program.commands.length === 0) {
    program.help();
}
program.parse();