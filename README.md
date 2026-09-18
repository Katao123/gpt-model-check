# gpt-model-check

[简体中文](README.md) | [English](README.en.md)

**在 Codex 里输入 `$gpt-model-check`，检测当前所选 GPT 的行为指纹是否与参考库相符。**

沿用当前任务的模型、渠道和推理档位，自动采样、判分并展示结果。无需手动复制探针答案，也无需额外配置检测服务的 API Key。

这是一个实验性的**模型指纹检测工具**。它提供是否疑似换模的线索，不测智商、不评估代码质量，也不能认证后台模型身份。

## 使用效果

安装后，在目标 Codex 任务中选择模型，发送 `$gpt-model-check`，就会得到下面五种结果之一。

**以下五张均为模拟效果图，使用演示数据，不是真实检测结果。** 它们复用正式版的状态图片、结果文案和判定规则，完整展示模型、匹配权重、有效样本、Token 和操作入口。

### 1. 指纹匹配

<p>
  <img src="assets/examples/match.png" width="800" alt="模拟效果 1/5：指纹匹配，所选 GPT-6 Astra 与参考指纹相符，展示有效样本和 Token 用量">
</p>

所选模型与最接近的指纹一致，且样本、权重和分差满足当前规则。这种状态表示本次未发现换模迹象。

**下一步：**继续使用，或点击「查看检测记录」在右侧栏核对采样和判分。

### 2. 指纹明显不符

<p>
  <img src="assets/examples/mismatch.png" width="800" alt="模拟效果 2/5：指纹明显不符，选择的是 GPT-6 Astra，结果更接近 GPT-5.6 Luna">
</p>

示例中选的是 `gpt-6-astra`，结果却更接近 `gpt-5.6-luna`，并达到当前「指纹不符」门槛。这是需要核对的异常线索，不能单次就认定服务商换模。

**下一步：**检查所选模型和渠道，再发送 `$gpt-model-check` 复测；必要时保留记录进行对比。

### 3. 证据不足

<p>
  <img src="assets/examples/inconclusive.png" width="800" alt="模拟效果 3/5：证据不足，第一名只领先 0.170 分，低于 0.500 门槛，展示重新检测入口">
</p>

示例中 `gpt-5.6-sol` 排名第一，但只领先第二名 **0.170 分**，没有达到要求的 **0.500 分**。这时暂不判定匹配或异常；样本不完整也会出现这种状态。

**下一步：**点击带循环箭头的「重新检测」，给当前任务发送新的检测消息，重新采样。客户端可能要求确认，重测会消耗新的 Token。

### 4. 模型不支持

<p>
  <img src="assets/examples/unsupported.png" width="800" alt="模拟效果 4/5：DeepSeek V4 Pro 不在支持范围内，没有发送探针，样本和 Token 均为零">
</p>

所选型号不在本工具当前支持的 GPT 列表中，因此不发送探针。`0/3` 和 Token 为 `0` 表示没有采样，不代表该模型有问题。

**下一步：**选择支持列表内的 GPT，再运行检测。同一不支持的型号反复重测不会增加识别能力。

### 5. 执行失败

<p>
  <img src="assets/examples/error.png" width="800" alt="模拟效果 5/5：探针请求超时导致执行失败，没有可用样本，Token 用量显示未返回">
</p>

示例中探针请求超时，没能取得可用样本。连接、授权或协议错误也可能导致执行失败；这类问题不能用来判断是否换模。用量未知时显示「未返回」，不会填成 `0`。

**下一步：**根据显示的失败原因检查连接或客户端，再运行检测。

图中的操作入口仅用于展示。实际使用时，「查看检测记录」打开本地 JSON，「重新检测」发起新的检测。库内匹配权重始终只是参考候选间的相对权重，不是模型身份的准确概率。

## 安装

需要 **Node.js 18+** 和已登录、能正常调用模型的 **Codex Desktop 或 Codex CLI**。建议使用仍受维护的 Node.js LTS。工具没有需要 `npm install` 的第三方运行依赖。

### 让 Codex 帮你装

把下面这句话发给 Codex：

```text
请使用 $skill-installer，从 https://github.com/Katao123/gpt-model-check 安装仓库根目录的 skill，名称为 gpt-model-check。
```

安装后，在下一轮对话输入 `$gpt-model-check`。如果未出现，重新打开 Codex。若客户端没有 skill-installer，使用下面的安装方式。

### 下载后安装（Mac / Windows 通用）

从 [Releases](https://github.com/Katao123/gpt-model-check/releases/latest) 下载 ZIP 并解压，在解压后的 `gpt-model-check` 目录打开终端，运行：

```sh
node install.mjs
```

有 Git 的用户也可以：

```sh
git clone https://github.com/Katao123/gpt-model-check.git
cd gpt-model-check
node install.mjs
```

默认安装到用户主目录的 `.codex/skills/gpt-model-check`；设置了 `CODEX_HOME` 时使用其 `skills` 目录。安装脚本不修改 Codex 的模型、认证或全局配置。

### 开始检测

1. 在 Codex 任务中选好要检测的 GPT。
2. 发送 `$gpt-model-check`。
3. 查看结果；证据不足时可点击「重新检测」。

普通终端无法自动知道你正在看的 Codex 任务，请在目标任务中调用。已有长对话也可以直接调用：默认通过三个新的临时会话采样，不复制当前对话历史。

### 更新与卸载

下载新版并解压（Git 用户先 `git pull`），在新版目录执行：

```sh
node install.mjs --update
```

更新会先把旧 skill 备份到 `.codex/gpt-model-check/backups/`，保留检测记录和使用次数。卸载时删除 `.codex/skills/gpt-model-check` 文件夹即可；如需清理记录，再删除 `.codex/gpt-model-check`。自定义 `CODEX_HOME` 时使用对应目录。

## 支持范围与运行成本

当前固定参考库有 **13 个候选**，可检测其中 6 个 GPT 型号：

`gpt-6-astra` · `gpt-5.6-sol` · `gpt-5.6-luna` · `gpt-5.6-terra` · `gpt-5.5` · `gpt-5.4`

其他候选只参与比较。所选模型不在这六个型号内时，显示「模型不支持」，不发送探针。模型名称以当前 Codex 运行时返回的 ID 为准；不会把第三方模型别名强行映射成 GPT。

每次检测最多启动三组探针，会消耗原渠道的 Token / 账号额度。新会话仍包含运行时提供的系统与工具上下文，**不代表低 Token 消耗**；实际用量随客户端、模型及档位变化，以结果为准。部分请求超时且未返回用量时，仅显示已知用量。

| 环境 | 当前验证范围 |
| --- | --- |
| macOS + Codex Desktop | 已进行实际采样及结果展示验证 |
| Codex CLI | 提供运行时发现与同协议适配；不同版本需实际确认兼容性 |
| Windows / Linux | 提供跨平台脚本及 CI 测试；尚未完成真实客户端端到端验证 |

检测依赖 Codex 原生 `app-server` 的当前任务读取、模型配置和临时会话能力。部分旧版或第三方客户端不具备这些接口；这时会报出连接/兼容性错误，不据此判定模型异常。Desktop 并不保证在所有平台都安装了可从终端调用的 Codex CLI。

## 检测原理与五种结果

```text
读取当前任务的模型与渠道
    → 创建三个无历史的临时会话
    → 模型直接输出数字数组（禁止工具代答）
    → 本地提取统计特征，与固定指纹库比较
    → 输出结论和检测记录
```

数字生成习惯在不同模型之间存在统计差异。本项目复用 ModelTrace 的指纹库和评分器，再增加采样有效性检查、Codex 接入和结果展示。

| 状态 | 当前规则 |
| --- | --- |
| ✅ 指纹匹配 | 三组有效；第一名是所选模型；库内权重至少 80%；与第二名的原始分差至少 0.5 |
| ⚠️ 指纹明显不符 | 三组有效；另一模型满足上述强度要求；所选模型权重不高于 20%，且与第一名原始分差至少 0.5 |
| 🔎 证据不足 | 样本不全、候选权重不足、分差不足，或检测过程中配置改变 |
| 🧩 模型不支持 | 所选型号尚未纳入本工具检测范围，不发送探针 |
| 🔧 执行失败 | 连接、协议、模型请求等执行失败，不代表模型被替换 |

**库内匹配权重不是“真模型概率”。** 未收录的模型也可能接近某个已知指纹。80% / 0.5 等是本工具的实验性保守门槛，尚未用独立真实样本标定；中英文探针与当前 Codex 上下文也没有完成同条件校准。测试通过仅说明程序行为符合规则，不是检测准确率证明。

因此，接近 100% 也可能因为缺少样本或分差不足而无法判定。界面会解释具体原因，并在这种情况下隐藏容易误解的高百分比。一次匹配不能证明历史请求没有换模，也不代表代码质量没有波动。

## 本地记录与 Star 邀请

检测记录位于 `.codex/gpt-model-check/reports/`，包含模型配置、原始探针答案、判分、用量和上游版本。它们可能含本机路径和任务 ID，分享前请检查。

Star 邀请只用本机 `.codex/gpt-model-check/usage.json` 中的次数和上次提示时间：

- 发起过真实探针的一次检测计 1 次，重新检测也计入；三组探针合计仍是 1 次。
- 前 3 次不提示；第 4 次起，返回可展示判分结果时有 25% 的机会显示邀请。
- 两次邀请至少相隔 3 次检测和 24 小时；执行失败时不显示。
- 历史回放、doctor、不支持模型和没有启动探针的运行不计数。
- 不上传这些计数，不采集账号或设备标识，不检查是否已 Star，不自动打开或点击 GitHub。

设置环境变量 `GPT_MODEL_CHECK_STAR_PROMPT=0` 并重新启动 Codex 可关闭邀请。删除 `usage.json` 会重置本机次数。项目升级不会扫描以前的检测记录来补算次数。

## 排查问题与开发

在 Codex 目标任务中，可以请它执行：

```text
node "<skill-dir>/scripts/check.mjs" doctor
```

`<skill-dir>` 是安装目录的绝对路径。`doctor` 检查连接和覆盖范围，不调用模型。找不到运行时可以用 `--codex "<可执行文件绝对路径>"` 或设置 `GPT_MODEL_CHECK_CODEX_PATH`；Windows 请指向 `codex.exe` 或 `@openai/codex/bin/codex.js`，不要指向 `.cmd` 包装器。

其他命令：

```text
node scripts/check.mjs models
node scripts/check.mjs render --receipt "<记录绝对路径>"
node scripts/check.mjs --json
npm test
```

`render` 是离线回放，会明确标注历史结果，不发起新探针。默认超时 180 秒，`--timeout` 支持 5–600 秒。`--context current` 会复制已完成轮次的上下文到三个分支，成本可能显著增加，仅用于明确需要的对照实验。

遇到问题请 [提交 Issue](https://github.com/Katao123/gpt-model-check/issues)，附上系统、Node/Codex 版本、所选模型和脱敏后的错误信息。请勿提交凭据、完整聊天记录或未检查的本地检测文件。

## 上游来源与许可

感谢两个上游项目；本项目的指纹方法并非原创：

| 项目 | 在本项目中的作用 | 固定版本 |
| --- | --- | --- |
| [ModelTrace](https://github.com/xqy2006/ModelTrace) | 参考指纹库、统计评分器及数值探针方法 | [`3f0dd2f`](https://github.com/xqy2006/ModelTrace/commit/3f0dd2f4b451ad424f3b165a108a468efe4d4d81) |
| [is-gpt-nerfed](https://github.com/kiyoakii/is-gpt-nerfed) | Codex 原生临时分支接入与探针执行流程参考 | [`3849867`](https://github.com/kiyoakii/is-gpt-nerfed/commit/38498671b32015b97901717207d38b4508b57301) |

上游代码和指纹数据随包固定，不在运行时自动拉取；使用时不必另行安装这两个项目。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、[版本与 SHA-256 记录](assets/provenance.json) 和随包保留的两份 MIT 许可。

本项目采用 [MIT License](LICENSE)，独立于 OpenAI 及上游项目。欢迎贡献客户端兼容性修复、独立校准样本和展示改进。
