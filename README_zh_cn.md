# QMCLI
一个快速的Minecraft启动器命令行工具（正在开发中）

> [!WARNING]
> 这个启动器可能并不与官方启动器、HMCL、PCL等启动器相兼容！
> 另外请注意，这个项目使用了大语言模型来生成和重构一些代码，所以可能存在一些bug和安全问题。请谨慎使用。

## 安装
```bash
$ npm install -g @tobylai/qmcli
$ # 检查安装
$ qmcli
```

## Usage
```bash
$ qmcli --help
Usage: qmcli [options] [command]

一个快速的 Minecraft 命令行启动器

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  versions        管理 Minecraft 版本
  settings        管理设置
  users           添加/管理用户
  help [command]  display help for command
```
## 特性
许多特性仍在开发中

- 版本
    - [X] 下载minecraft版本
    - [X] 启动minecraft
    - [X] 编辑版本特定的minecraft启动设置
        - [X] 内存
        - [X] 版本隔离
        - [X] 窗口大小
        - [X] 设置java路径
- 用户
    - [X] 添加/移除用户
    - [X] 离线用户
    - [ ] mojang用户 (不再支持)
    - [ ] microsoft用户(申请api中)
- 设置
    - [X] 更改下载镜像
        - [X] 官方
        - [X] bmclapi
    - [X] 管理minecraft安装路径
    - [X] 更改默认java路径
- 本地化
    - [X] 支持en (English)
    - [X] 支持zh_cn (简体中文)
- 模组
    - [ ] forge
    - [ ] neoforge
    - [X] fabric
    - [X] quilt

## 常见问题
### 为什么叫这个名字？
QMCLI代表**Q**uick **M**ine**C**raft **L**auncher **CLI**

---
QMCLI 非 MINECRAFT 官方产品[产品／服务／活动／等]。未经 MOJANG 或 MICROSOFT 批准，也不与 MOJANG 或 MICROSOFT 关联