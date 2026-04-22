# GitHub Releases 更新发布流程

当前应用已接入 Tauri v2 官方 updater，更新清单地址为：

```text
https://github.com/fenggeg/maven-packager/releases/latest/download/latest.json
```

## 首次准备

签名私钥已生成到本机用户目录：

```text
C:\Users\gyfwo\.tauri\maven-packager-desktop.key
```

发布更新包时需要设置环境变量：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\maven-packager-desktop.key" -Raw
$env:CI = "true"
```

这个私钥不要提交到 Git 仓库。如果私钥丢失，旧版本应用将无法验证后续更新包。

如果使用 GitHub Actions 发布，需要在仓库 Secrets 中配置：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

当前生成的私钥没有密码，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 可以先留空。

## 发布版本

1. 修改 `src-tauri/tauri.conf.json` 中的 `version`。
2. 建议同步修改 `package.json` 中的 `version`。
3. 构建安装包：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\maven-packager-desktop.key" -Raw
$env:CI = "true"
npm run tauri build -- --ci --bundles nsis
```

4. 在 GitHub Releases 创建新版本，上传构建产物和 updater 产物。
5. 在同一个 Release 上传 `latest.json`。

也可以推送 `v*` 标签触发 GitHub Actions 正式发布：

```powershell
git tag v0.1.1
git push origin v0.1.1
```

更新日志统一维护在仓库根目录的 `CHANGELOG.md`。GitHub Actions 会读取当前发布版本对应的小节，并同时写入：

- GitHub Release 页面正文。
- `latest.json` 的 `notes` 字段，供应用内“检查更新”弹窗展示。

例如发布 `v0.1.1` 前，需要在 `CHANGELOG.md` 中添加：

```markdown
## [0.1.1] - 2026-04-22

### 新增

- 新增某项功能。

### 修复

- 修复某个问题。
```

正式 `v*` 标签发布时，如果 `CHANGELOG.md` 中找不到对应版本小节，workflow 会失败，避免发布没有更新日志的安装包。

应用当前检查的地址是 `/releases/latest/download/latest.json`，因此只有正式发布的非草稿、非预发布 Release 会被客户端拉取到。`main` 分支自动构建会生成草稿预发布版本，不会影响正式更新通道。

正式 `v*` 标签发布完成后，workflow 会校验两件事：

- 当前标签 Release 下的 `latest.json` 包含 `version`、`notes`、Windows 更新包 URL 和签名。
- 应用实际配置的 `/releases/latest/download/latest.json` 可以被拉取，并包含完整 Windows 更新信息。

## latest.json 示例

`signature` 必须填写 `.sig` 文件的文本内容，不是 `.sig` 文件 URL。

```json
{
  "version": "0.1.1",
  "notes": "## 更新内容\n\n- 修复已知问题，优化打包体验。",
  "pub_date": "2026-04-21T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "粘贴 .sig 文件内容",
      "url": "https://github.com/fenggeg/maven-packager/releases/download/v0.1.1/更新包文件名"
    }
  }
}
```
