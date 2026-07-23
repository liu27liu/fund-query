# 基金股票查询平台 - Windows 桌面版构建指南

## 项目结构

本项目已配置为 Electron + Flask 桌面应用：

- `main.js` - Electron 主进程，负责创建窗口和启动 Flask 后端
- `preload.js` - 安全桥接脚本
- `package.json` - Electron 和构建配置
- `server.py` - Flask 后端服务
- `.github/workflows/build.yml` - GitHub Actions 自动构建配置

## 自动构建（推荐）

推送代码到 GitHub 后，GitHub Actions 会自动构建 Windows 安装包。

### 触发方式

1. **推送标签自动构建**：
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   推送后会自动创建 Release 并上传安装包。

2. **手动触发**：
   在 GitHub 仓库页面 -> Actions -> Build Windows Desktop App -> Run workflow

3. **推送代码自动构建**：
   每次推送到 main 分支都会触发构建，构建产物可在 Actions 页面下载。

## 本地构建（Windows）

### 前置要求

- Windows 10/11
- Node.js 20+
- Python 3.11+

### 构建步骤

```bash
# 1. 克隆项目
git clone <仓库地址>
cd fund-query

# 2. 安装 Python 依赖
pip install pyinstaller flask requests

# 3. 用 PyInstaller 打包后端
pyinstaller --onefile --name backend --distpath python-dist server.py

# 4. 安装 Node 依赖
npm install

# 5. 构建 Windows 安装包
npm run dist
```

构建完成后，`dist/` 目录下会生成 `.exe` 安装包。

## 安装使用

1. 双击运行安装包
2. 选择安装目录
3. 安装完成后桌面会生成快捷方式
4. 双击快捷方式启动应用

应用启动后会自动启动后端服务，然后加载前端页面。
