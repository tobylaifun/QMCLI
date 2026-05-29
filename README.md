# QMCLI
English | [简体中文](README_zh_cn.md)

A Quick Minecraft Launcher CLI (Work In Progress)

> [!WARNING]
> This launcher might not be compatible with the official launcher, HMCL, PCL,etc.
> And note that this project has used LLMs to generate and refactor some code, so there might be some bugs and security issues. Please use it with caution.

## Installation
```bash
$ npm install -g @tobylai/qmcli
$ # check the installation
$ qmcli
```

## Usage
```bash
$ qmcli --help
Usage: qmcli [options] [command]

A Quick Minecraft CLI Launcher

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  versions        manage minecraft versions
  settings        manage settings
  users           add/manage users
  help [command]  display help for command
```
## Features
many features are still working in progress

- versions
    - [X] download minecraft versions
    - [X] launch minecraft
    - [X] edit minecraft (version-specific) launch settings
        - [X] ram
        - [X] version isolation
        - [X] window size
        - [X] set java path
- users
    - [X] add/remove users
    - [X] offline users
    - [ ] mojang users (deprecated?)
    - [ ] microsoft users
- settings
    - [X] change download mirror
        - [X] official
        - [X] bmclapi
    - [X] manage minecraft installation paths
    - [X] change default java path
- localization
    - [X] support en(English)
    - [X] support zh_cn(简体中文)
- mods
    - [ ] forge
    - [ ] neoforge
    - [X] fabric
    - [X] quilt
    - maybe more

## FAQ
### Why the name?
QMCLI is for **Q**uick **M**ine**C**raft **L**auncher **CLI**

---
QMCLI is not an official product [product/service/activity/etc.] of MINECRAFT. It has not been approved by MOJANG or MICROSOFT and is not associated with MOJANG or MICROSOFT.