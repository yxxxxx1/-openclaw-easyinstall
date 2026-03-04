# OpenClaw Easy Install

一个面向中国市场小白用户的 OpenClaw Windows 原生安装与首启引导桌面应用。

## 项目目标

- 提供一键安装体验，全程图形界面，无需命令行。
- 安装后快速可用：首次启动必须完成 AI 设置，随后可直接进入聊天。
- 提供可感知的稳定性能力：安装/卸载进度、错误码、取消任务、诊断提示。
- 支持安全卸载：默认保留本地数据，可选彻底清理。

## 当前实现范围

### 安装器流程

- 开始 -> 安装位置 -> 安装中 -> 完成
- 支持安装路径修改（系统目录选择器）
- 条件触发管理员授权提示
- 安装任务由 Tauri 后端执行并实时回传进度事件

### 首启与控制台

- 启动检查 -> AI 设置（必做）-> 初始化完成 -> 控制台
- 控制台左侧菜单：开始聊天、连接渠道、AI 设置、设置
- 切换菜单即切换对应内容，默认进入聊天页

### AI 设置

- 支持平台：Kimi、DeepSeek、Moonshot、Qwen、GLM、MiniMax、OpenAI、Anthropic、自定义
- 支持模型选择与 API Key 输入
- 测试连接为真实后端请求（部分平台）
- AI 配置本地持久化（重启保留）

### 卸载能力

- 从设置页发起卸载
- 默认仅卸载程序，保留本地数据
- 可选删除本地数据（不可恢复）
- 卸载前展示删除清单
- 检测占用进程并阻止误卸载

## 技术栈

- Desktop Shell: Tauri v2
- Frontend: React + TypeScript + Vite
- UI: Ant Design 5 + Framer Motion
- Backend: Rust（Tauri commands + 本地状态管理）

## 本地开发

### 1) 安装依赖

```bash
npm install
```

### 2) 启动桌面开发模式

```bash
npm run tauri:dev
```

### 3) 前端单独调试

```bash
npm run dev
```

## 构建与打包

### 前端构建

```bash
npm run build
```

### 桌面安装包构建

```bash
npm run tauri:build
```

打包产物（Windows）：

- EXE: `src-tauri/target/release/bundle/nsis/OpenClaw Installer_0.1.0_x64-setup.exe`
- MSI: `src-tauri/target/release/bundle/msi/OpenClaw Installer_0.1.0_x64_en-US.msi`

## 界面预览

将截图放到 `docs/screenshots/` 目录后，README 会自动显示。建议文件名：

- `installer-start.png`（安装首页）
- `ai-setup.png`（AI 设置）
- `console-chat.png`（控制台聊天页）

示例（添加图片后生效）：

```md
![安装首页](docs/screenshots/installer-start.png)
![AI 设置](docs/screenshots/ai-setup.png)
![控制台聊天页](docs/screenshots/console-chat.png)
```

## 常用命令

```bash
npm run lint
npm run build
npm run tauri:dev
npm run tauri:build
```

## 项目结构

```text
src/                 # React 前端页面与交互
src-tauri/src/       # Rust 后端命令与任务调度
src-tauri/icons/     # 应用图标资源
SPEC.md              # 需求规格说明
docs/screenshots/    # README 截图目录
```

## Roadmap

- [ ] 安装任务细化为真实下载/校验/写入子步骤
- [ ] AI 连接测试补齐更多 provider 及错误翻译
- [ ] 卸载占用进程一键关闭并继续
- [ ] 日志导出为压缩包，便于客服排障
- [ ] 增加自动更新与版本回滚能力

## Contributing

欢迎贡献代码与建议，推荐流程：

1. Fork 本仓库并创建功能分支
2. 提交改动并保证本地检查通过
3. 发起 Pull Request 并说明变更目的

提交前建议执行：

```bash
npm run lint
npm run build
```

如涉及 Rust 后端改动，请额外执行：

```bash
cd src-tauri
cargo check
```

## 说明与限制

- 当前为 MVP 阶段，安装任务中部分步骤为“真实任务框架 + 渐进模拟进度”。
- AI 测试连接对不同平台的细节兼容仍可继续增强。
- 生产发布前建议补充：代码签名、完善隐私/协议文本、异常日志导出策略。

## 许可证

待补充。
