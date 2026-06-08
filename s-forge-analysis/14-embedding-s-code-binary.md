# S-Forge 内嵌 S-Code 二进制方案

## 参考：Pandoc 的内嵌模式

s-forge 目前通过以下方式内嵌 pandoc：

```
WorkingDir/
├── pandoc/
│   ├── pandoc-windows-amd64.zip   (~25MB)
│   ├── pandoc-darwin-amd64.zip    (~20MB)
│   ├── pandoc-darwin-arm64.zip    (~18MB)
│   ├── pandoc-linux-amd64.zip     (~22MB)
│   └── pandoc-linux-arm64.zip     (~20MB)
│
初始化时:
  InitPandoc()
  → 检测 WorkingDir/pandoc/pandoc-{os}-{arch}.zip
  → 解压到 TempDir/pandoc/bin/pandoc
  → exec.Command(PandocBinPath, args...)
```

## S-Code 二进制大小预估

| 编译方式 | 平台 | 预估大小 | 压缩后 |
|---------|------|---------|--------|
| `bun build --compile --target=bun-windows-x64` | Windows x64 | ~70MB | ~35MB |
| `bun build --compile --target=bun-darwin-x64` | macOS Intel | ~65MB | ~30MB |
| `bun build --compile --target=bun-darwin-arm64` | macOS Apple | ~60MB | ~28MB |
| `bun build --compile --target=bun-linux-x64` | Linux x64 | ~75MB | ~32MB |

**问题**: 单个文件约 60-75MB，压缩后约 30-35MB。GitHub 单文件限制 **100MB**，压缩后的 zip 在限制内。但如果未来更大可能超限。

## 方案 A：Pandoc 模式（zip 存储，推荐）

### 存储结构

```
s-forge 仓库/
├── scode-bin/
│   ├── scode-windows-x64.zip      (~35MB, 不提交 git)
│   ├── scode-darwin-x64.zip       (~30MB, 不提交 git)
│   ├── scode-darwin-arm64.zip     (~28MB, 不提交 git)
│   ├── scode-linux-x64.zip        (~32MB, 不提交 git)
│   └── scode-linux-arm64.zip      (~30MB, 不提交 git)
├── scripts/
│   └── download-scode.ts          (下载脚本)
└── .gitignore                     (排除 scode-bin/)
```

### 运行时初始化

```go
// scode/binary.go
package scode

import (
    "os/exec"
    "path/filepath"
    "runtime"
    "github.com/siyuan-note/siyuan/kernel/util"
)

type SCodeManager struct {
    binaryPath string  // s-code 二进制路径
}

func (m *SCodeManager) Init() {
    // 1. 确定平台二进制
    platform := runtime.GOOS + "-" + runtime.GOARCH
    zipName := "scode-" + platform + ".zip"  // scode-windows-amd64.zip
    
    // 2. 查找路径
    scodeDir := filepath.Join(util.WorkingDir, "scode-bin")
    zipPath := filepath.Join(scodeDir, zipName)
    
    // 3. 如果 zip 不存在，尝试下载
    if !gulu.File.IsExist(zipPath) {
        downloadSCode(scodeDir, platform)
    }
    
    // 4. 解压到临时目录
    tempDir := filepath.Join(util.TempDir, "scode")
    unzip(zipPath, tempDir)
    
    // 5. 设置二进制路径
    if runtime.GOOS == "windows" {
        m.binaryPath = filepath.Join(tempDir, "scode.exe")
    } else {
        m.binaryPath = filepath.Join(tempDir, "scode")
        exec.Command("chmod", "+x", m.binaryPath).CombinedOutput()
    }
}
```

### 下载脚本

```typescript
// scripts/download-scode.ts
// 在构建 s-forge 前运行，下载对应平台的 s-code 二进制

const platform = {
  "win32-x64": "windows-x64",
  "darwin-x64": "darwin-x64", 
  "darwin-arm64": "darwin-arm64",
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
}[process.platform + "-" + process.arch]

const url = `https://github.com/your-org/s-code/releases/latest/download/scode-${platform}.zip`
const outDir = path.join(__dirname, "..", "scode-bin")
const outPath = path.join(outDir, `scode-${platform}.zip`)

// 下载 zip
const resp = await fetch(url)
const buf = await resp.arrayBuffer()
await Bun.write(outPath, new Uint8Array(buf))
```

## 方案 B：安装时下载（更轻量，推荐）

不在仓库中存储任何二进制，改为**安装/构建时下载**：

```go
func (m *SCodeManager) ensureBinary() error {
    binPath := m.binaryPath()
    
    // 如果已经存在且是最新版本，直接返回
    if isValidBinary(binPath) {
        return nil
    }
    
    // 下载对应平台的二进制
    platform := runtime.GOOS + "-" + runtime.GOARCH
    url := fmt.Sprintf(
        "https://github.com/your-org/s-code/releases/latest/download/scode-%s.zip",
        platform,
    )
    
    // 下载到临时文件
    zipPath := filepath.Join(os.TempDir(), "scode-download.zip")
    downloadFile(url, zipPath)
    
    // 解压到目标目录
    targetDir := filepath.Join(util.WorkingDir, "scode-bin")
    unzip(zipPath, targetDir)
    
    // 设置可执行权限
    if runtime.GOOS != "windows" {
        exec.Command("chmod", "+x", binPath).CombinedOutput()
    }
    
    return nil
}
```

## GitHub 文件大小约束

| 约束 | 值 | 影响 |
|------|----|------|
| 单文件限制 (GitHub) | **100 MB** | 单平台 zip (~30-35MB) ✅ 安全 |
| 单文件限制 (Git LFS) | **2 GB** | 可用 LFS 管理 |
| 建议最大仓库大小 | **1-5 GB** | 所有平台 zip (~150MB) ✅ 安全 |
| 推送拒绝 | >100MB 单文件 | 注意避免误提交未压缩 binary |

**关键规则**: 
- 压缩后的 zip（~30MB）在 GitHub 限制内 ✅
- 未压缩的 binary（~70MB）在限制内但较大 ⚠️
- **务必使用 `.gitignore` 排除 scode-bin/ 目录**，避免构建产物被提交
- 推荐使用 `.gitignore` + 安装时下载（方案 B）

## .gitignore 配置

```gitignore
# S-Code 内嵌二进制
/scode-bin/
*.zip
```

## 推荐实现路径

### 1. 下载脚本 (`scripts/download-scode.ts`)
- 从 GitHub Releases 下载对应平台的 s-code binary
- 打成 zip 包

### 2. 初始化 (`scode/binary.go`)
- 启动时检查 binary 是否存在
- 不存在则从配置的 URL 下载
- 验证 binary 有效性 (`scode --version`)
- 设置可执行权限

### 3. SCodeWorker (`scode/worker.go`)
- 使用 `exec.Command(scodeBinary, "--mode", "worker")` 启动
- 通过 stdin/stdout 通信

## 与 Pandoc 管理方式的统一

| 方面 | Pandoc | S-Code |
|------|--------|--------|
| 存储位置 | `kernel/pandoc/*.zip` | `scode-bin/*.zip` |
| 是否提交 git | ✅ 是 (~20MB) | ❌ 否 (通过 CI 下载) |
| 初始化时机 | 内核启动时 `InitPandoc()` | 内核启动时 `InitSCode()` |
| 解压目录 | `TempDir/pandoc/` | `TempDir/scode/` |
| 执行方式 | `exec.Command(PandocBinPath)` | `exec.Command(SCodeBinaryPath)` |
| 下载方式 | Git 检出自带 | 从 GitHub Releases 按需下载 |
