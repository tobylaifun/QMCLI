import yaml from "js-yaml";
import nodePath from "node:path";
import fs from "node:fs";
import { deepmerge } from "deepmerge-ts";

const defaultConfig=`# QMCLI launcher
isolated: false

ram:
  min: 1G
  max: 6G

size:
  width: 854
  height: 480

java: null
`;

export interface LauncherGameConfig{
    isolated?: boolean,
    ram?: {
        min?: string,
        max?: string,
    },
    size?: {
        width?: number,
        height?: number,
    },java?: string|null;
}
const defaults=yaml.load(defaultConfig) as LauncherGameConfig;

export function loadConfig(basepath:string,game:string):LauncherGameConfig{
    const configPath = nodePath.join(basepath,"versions",game,"qmcli.yml");
    if(fs.existsSync(configPath)){
        const conf=yaml.load(fs.readFileSync(configPath,"utf-8")) as LauncherGameConfig;
        // deep merge with defaults
        return deepmerge(defaults,conf);
    }else{
        fs.writeFileSync(configPath,defaultConfig,{encoding:"utf-8"});
        return yaml.load(defaultConfig) as LauncherGameConfig;
    }
}

export function saveConfig(basepath:string,game:string,config:LauncherGameConfig){
    const configPath = nodePath.join(basepath,"versions",game,"qmcli.yml");
    fs.writeFileSync(configPath,"# QMCLI launcher\n"+yaml.dump(config),{encoding:"utf-8"});
}