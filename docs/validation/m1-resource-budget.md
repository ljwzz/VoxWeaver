# M1 TXT 资源预算证据（UNAPPROVED / EXPLORATORY）

## 当前裁定

- `M1-D05` 保持 `open`。
- `results.status = complete` 仅表示一次合成样本探索运行完整结束；`mode = explore`、`approvalStatus = unapproved`、`eligibleForGateClosure = false`、`formalArtifactCreated = false`。
- profile 是探索安全包络，不是生产预算；九项测量建议均为 `candidate / unapproved`，不得视为已批准 default、范围或 global ceiling。
- 本次未使用真实样章，也不能替代获授权真实样章运行和独立负责人复核。

## Harness 边界

- `generateTxtResourceSamples.mjs` 只在系统临时目录生成固定 seed、固定 hash 的 1 MiB、10 MiB、50 MiB 合成 TXT；矩阵覆盖 UTF-8、GBK/GB18030、Big5、最长单行、密集短块和常规章节混合。
- `runTxtResourceBenchmark.mjs` 由主进程顺序启动独立 Node worker。worker 流式严格解码、通过 backpressure 写临时 UTF-8 输出，并记录进程启动 RSS、周期 RSS、`resourceUsage().maxRSS`、临时字节峰值、wall/CPU、吞吐、块数、最大块、取消延迟、进度和输出 hash。
- `verifyTxtResourceResults.mjs` 校验 profile、results、payload hash、每 case 至少五次独立原始测量、由 raw runs 重算的 maxima/建议值、输出稳定性、清理证据、`default`、项目 `maximum` ceiling、九项 `ceiling + 1`、九项 `globalCeiling + 1`、取消、timeout、临时空间不足，以及正式运行所需的负责人批准和真实样章授权引用；每个配置值同时受 `minimum`、`maximum` 和 `globalCeiling` 约束。
- 临时空间预检和建议值共用 `2 × source byte length` 公式；建议值还必须不低于实测临时峰值的 1.25 倍，两者取较大值。该公式只生成未批准候选。
- harness 不创建产品 Artifact revision，不读取或修改 `packages/novel-import/src/**`。

## 干净提交探索运行

| 项目 | 证据 |
| --- | --- |
| Git revision | `b9447c9eced60cce7efb9d9a824b16545ff88003` |
| Run ID | `495939f4-ba4a-49ea-97dc-16dde1752e5c` |
| 时间 | `2026-08-09T07:13:40.224Z` 至 `2026-08-09T07:13:49.642Z` |
| 运行时 | Node `v24.18.1`、pnpm `11.20.0`、ICU `78.3` |
| 环境 | Darwin `25.6.0`、arm64、Apple M5 Pro、`machineId = unapproved-exploration-host` |
| 样本生成器 | `m1-b05-samples-v1`、seed `1592635477` |
| 测量数量 | 9 cases × 5 个独立子进程 raw runs = 45；23 个 boundary checks 全部通过 |
| 清理 | `benchmarkTemporaryRootRemoved = true`；未持久化生成 TXT、真实文本、文件名或绝对临时路径 |

安装和运行仅发生在 detached clean worktree，运行前后 `git status --short` 为空。离线安装退出码为 0，下载数为 0：

```bash
fnm exec --using=24.18.1 pnpm install --offline --frozen-lockfile --store-dir .pnpm-store
```

探索命令退出码为 0，输出仅写系统临时文件：

```bash
fnm exec --using=24.18.1 node \
  packages/novel-import/benchmark/runTxtResourceBenchmark.mjs \
  --explore \
  --out <system-temp-result>
```

runner 原始输出的 payload SHA-256 为 `62246999faaed8abfedce4aebd141d4163a30d16001d89e39d77900d3abd11b4`，原始结果文件 SHA-256 为 `2cbe3d2fee2090343cd420caccb0db5584dde3c1e2cbd1620edba5f99dfcd10a`。归档时加入从该 revision 独立计算的 `sourceHashes` 并重算 payload；仓库 results 的 payload SHA-256 为 `c41c487018733ab00fb510f3e858f6c20ae35912bd6cf3c642d5a47d0e3ba716`，文件 SHA-256 为 `08d30952544bad3362a006da01711dcfdcbd8a4e7f00a67a5d915505bdf487ef`。profile 稳定 JSON SHA-256 为 `0416edadc21dd73f9da306360ac8a0f11dc02869167ea003f89d41226ea13522`，profile 文件 SHA-256 为 `9882b3e0980f9a4967e6183fe55e5a68b73a26426f613436ac38b863669376b5`。

## 固定源码哈希

以下 SHA-256 均从上述 detached revision 计算；随后对 evidence test 的最小断言更新不改变本次运行使用的源码身份。

| 文件 | SHA-256 |
| --- | --- |
| `packages/novel-import/benchmark/generateTxtResourceSamples.mjs` | `338c09794a7e6cf606d303b05a06b5fd66c2123707697fa1ef17d626845a7462` |
| `packages/novel-import/benchmark/runTxtResourceBenchmark.mjs` | `432e2eb6f8421ba5413b361bc787f58687a01a5af2229f4ae11c0a25ec82236e` |
| `packages/novel-import/benchmark/verifyTxtResourceResults.mjs` | `98411341d44a6ff32e05ab6f28f2c3e4888539a9c5e2b9e180174da83b24df56` |
| `packages/novel-import/test/txtResourceBenchmark.test.mjs` | `e710b28bd78f475d7bb59f4b964d816f62118bc4ff469742f270479bccf4488e` |
| `packages/novel-import/package.json` | `770b351f060721e24ece4d44440989ae6cebcceecdc97761101e332d4d949b2c` |

## 合成样本输入和输出

| Case | Encoding | 输入 bytes | 输入 SHA-256 | 输出 bytes | 输出 SHA-256 |
| --- | --- | ---: | --- | ---: | --- |
| `utf8-dense-1mib` | UTF-8 | 1048576 | `4aae024a4f77d4d8c5e5c28fef045cd103ac4f10516cf41a70b50ea0eb1354a1` | 1048576 | `4aae024a4f77d4d8c5e5c28fef045cd103ac4f10516cf41a70b50ea0eb1354a1` |
| `gbk-regular-1mib` | GBK | 1048576 | `8dcac13f89956b01f17120f6ec03e1428ff6296a79cba3ce9bfc7b8dea24abe9` | 1441954 | `71c1cefd40fa090630ace7c6db4ab7f176820dc7e37a6fc94e390c1c93f5d9a6` |
| `big5-long-line-1mib` | Big5 | 1048576 | `d6867bc4c89e7003e354aa48144671b9b013dfe8cbe2122255b6fc87a27192cd` | 1480290 | `faf7f7bd629b423c751a96c76013548e0ed43ec6d2d6ba592e2894c6e672ebe5` |
| `utf8-regular-10mib` | UTF-8 | 10485760 | `65b1323c9205424be267392de26b9b4a1058714f6ff794d5c4c6d735c61f80ea` | 10485760 | `65b1323c9205424be267392de26b9b4a1058714f6ff794d5c4c6d735c61f80ea` |
| `gb18030-long-line-10mib` | GB18030 | 10485760 | `860acc6717db146f09a0611ca94ee75965852d6ce89fc096b687d43d37bd6fcf` | 14979829 | `8895190ff0cef97a72c4eb41c24e16c5579a9d7fca4a84b739ea087539eb8a57` |
| `big5-dense-10mib` | Big5 | 10485760 | `1d2a4ee3fe59ba6ea200e0097c00df70c1a77e0b2e0f6c2271908478dc96f045` | 14155653 | `a72601e69a36cca5cd820d7a1713172ce6a2e75eb6a28d6cc3577a289375593a` |
| `utf8-long-line-50mib` | UTF-8 | 52428800 | `40dcc789d0fb4e6765b33986c1e005b962bd18b4910b76d6944349349a63378d` | 52428800 | `40dcc789d0fb4e6765b33986c1e005b962bd18b4910b76d6944349349a63378d` |
| `gbk-dense-50mib` | GBK | 52428800 | `58035db5133aeb6705a619720dbc1adde13e098e9caf4eeb205cb2c9d6130c92` | 72089580 | `e6a331a75dbf254fdc163b7c3b8d357f89ce7950b3466e97c8792d33a5cf0e92` |
| `big5-regular-50mib` | Big5 | 52428800 | `9cdd40c0aa29aae763f9ab1a4bf8b432363bebc9bb31f1c5d4677213ef173c35` | 70777992 | `6e1e77cc9ecae8693aef90724059fe971dcd4ded0bcf43807b8794ab4f552dff` |

各 case 的五次 raw runs、独立 process ID、CPU、吞吐、RSS 周期样本数、backpressure、进度和清理字段完整保存在 `m1-resource-budget.results.json`。五次测量的逐 case maxima 如下：

| Case | sampled peak RSS | resource max RSS | 临时峰值 bytes | wall ms | 块数 | 最大块 UTF-8 bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `utf8-dense-1mib` | 63225856 | 63389696 | 1048576 | 7.596666 | 85606 | 30 |
| `gbk-regular-1mib` | 65486848 | 65470464 | 1441954 | 12.551416 | 174334 | 27 |
| `big5-long-line-1mib` | 59506688 | 59490304 | 1480290 | 6.710542 | 1 | 1480290 |
| `utf8-regular-10mib` | 71352320 | 71352320 | 10485760 | 48.347458 | 856158 | 34 |
| `gb18030-long-line-10mib` | 66355200 | 66355200 | 14979829 | 54.900750 | 1 | 14979829 |
| `big5-dense-10mib` | 73973760 | 73957376 | 14155653 | 88.931625 | 2096927 | 22 |
| `utf8-long-line-50mib` | 78446592 | 78446592 | 52428800 | 120.846500 | 1 | 52428800 |
| `gbk-dense-50mib` | 96878592 | 96878592 | 72089580 | 425.286000 | 8736995 | 28 |
| `big5-regular-50mib` | 89178112 | 89784320 | 70777992 | 416.396084 | 10488300 | 21 |

## 45 次 raw run 汇总

| 指标 | 最小值 | 最大值 |
| --- | ---: | ---: |
| process start RSS bytes | 53362688 | 53575680 |
| sampled peak RSS bytes | 59359232 | 96878592 |
| `resourceUsage().maxRSS` bytes | 59342848 | 96878592 |
| 临时峰值 bytes | 1048576 | 72089580 |
| wall ms | 6.011958 | 425.286000 |
| CPU user μs | 6182 | 416601 |
| CPU system μs | 902 | 24967 |
| throughput bytes/s | 83542446.52555537 | 439565274.6652487 |
| 块数 | 1 | 10488300 |
| 最大块 UTF-8 bytes | 21 | 52428800 |
| backpressure wait count | 4 | 200 |
| progress event count | 1 | 50 |

## Boundary 结果

- `default` 和项目 `maximum` ceiling 成功，输出 SHA-256 稳定。
- 九项 `ceiling + 1` 与九项 `globalCeiling + 1` 均以 `NOVEL_IMPORT_BUDGET_INVALID` 拒绝。
- 非 chunk 对齐取消阈值为 131073 bytes；实际越界 131071 bytes，满足 `0 < overshoot <= min(cancelCheckBytes, readChunkBytes) = 262144`；取消延迟 0.488042 ms，错误码为 `NOVEL_IMPORT_CANCELLED`。
- timeout 以 `NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED / taskTimeoutMs` 拒绝。
- 临时空间不足以 `NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED / maxTemporaryBytes` 拒绝。

## 未批准候选值

| 字段 | 测量建议 | 状态 |
| --- | ---: | --- |
| `maxSourceBytes` | 52428800 | `candidate / unapproved` |
| `readChunkBytes` | 262144 | `candidate / unapproved` |
| `maxRssBytes` | 121098240 | `candidate / unapproved` |
| `maxTemporaryBytes` | 104857600 | `candidate / unapproved` |
| `maxBlockCount` | 13110375 | `candidate / unapproved` |
| `maxBlockUtf8Bytes` | 65536000 | `candidate / unapproved` |
| `taskTimeoutMs` | 851 | `candidate / unapproved` |
| `cancelCheckBytes` | 262144 | `candidate / unapproved` |
| `progressStepBytes` | 1048576 | `candidate / unapproved` |

`maxTemporaryBytes` 候选不低于最大样本的预检需求 `2 × 52428800 = 104857600`，并与 verifier 的共源公式一致。以上数值不能直接替换 profile 的 default、minimum、maximum 或 globalCeiling。

## D05 仍未满足的前置

1. 九项预算字段尚未获得独立负责人批准。
2. 未提供获授权真实样章的 opaque `sampleId`、SHA-256、byte length、encoding 和 `evidenceRef`。
3. 尚未在 approved profile 下执行固定正式命令。
4. 尚未完成非 M1-B05 实现代理的独立 D05 closing review。

固定正式命令保持不变：

```bash
fnm exec --using=24.18.1 pnpm --filter @voxweaver/novel-import run benchmark:txt -- \
  --profile docs/validation/m1-resource-budget.profile.json \
  --out docs/validation/m1-resource-budget.results.json
```

当前 unapproved exploration profile 会在正式模式测量启动前以 `NOVEL_IMPORT_BUDGET_INVALID` 拒绝；runner 只在 approved profile、真实样章证据、完整测量和验证均通过后原子替换正式 results。
