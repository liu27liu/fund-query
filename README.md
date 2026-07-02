# 基金净值通 - 实时估值查询平台

覆盖全市场公募基金 · 盘中实时估值 · 历史净值走势 · 自选基金管理 · 邮箱验证码登录

## 技术栈

- **后端**: Python Flask + Gunicorn
- **前端**: 原生 HTML/CSS/JS（无框架）
- **数据源**: 东方财富 / 天天基金 API（实时数据，无模拟）
- **部署**: Docker + Railway

## 本地运行

```bash
cd fund-query
pip install -r requirements.txt
python server.py
```

打开浏览器访问 `http://localhost:8080`

## 部署到 Railway（通过 GitHub）

### 第一步：上传代码到 GitHub

1. 在 GitHub 创建一个新仓库（如 `fund-query`）
2. 在项目目录执行以下命令：

```bash
git init
git add .
git commit -m "基金净值通 - 初始提交"
git branch -M main
git remote add origin https://github.com/你的用户名/fund-query.git
git push -u origin main
```

### 第二步：在 Railway 部署

1. 访问 [Railway](https://railway.com/new)
2. 选择 **Deploy from GitHub repo**
3. 授权并选择你的 `fund-query` 仓库
4. 点击 **Deploy** 开始构建

Railway 会自动检测 `Dockerfile` 并构建部署。

### 第三步：生成公开访问地址

1. 部署完成后，进入服务的 **Settings** 标签页
2. 找到 **Networking** 区域
3. 点击 **Generate Domain** 生成公开 URL
4. 访问生成的 URL 即可使用网站

### 第四步：配置邮箱登录（可选）

在 Railway 项目的 **Variables** 标签页中添加环境变量：

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `SMTP_HOST` | SMTP 服务器地址 | `smtp.qq.com` |
| `SMTP_PORT` | SMTP 端口 | `465` |
| `SMTP_USER` | 发件邮箱 | `your@qq.com` |
| `SMTP_PASS` | 邮箱授权码 | `你的授权码` |

不配置也能运行，验证码会打印到 Railway 的日志中。

## 项目结构

```
fund-query/
├── server.py          # Flask 后端（API代理 + 登录）
├── index.html         # 前端入口
├── css/style.css      # 样式表
├── js/
│   ├── api.js         # 数据API接口层
│   ├── store.js       # 本地数据存储
│   └── app.js         # 主应用逻辑
├── assets/logo.jpg    # LOGO
├── requirements.txt   # Python 依赖
├── Dockerfile         # Docker 构建文件
├── Procfile           # Railway 启动命令
├── railway.json       # Railway 配置
└── .gitignore
```

## 功能特性

- 基金搜索（代码/名称/拼音）
- 实时盘中估值（无缓存延迟）
- 历史净值走势图表
- 基金涨幅排行榜
- 自选基金管理
- 持仓盈亏计算（持有金额模式）
- 邮箱验证码登录
- 响应式设计（支持移动端）
