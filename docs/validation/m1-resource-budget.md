# M1 TXT 资源预算证据（UNAPPROVED）

## 当前裁定

- `M1-D05` 保持 `open`。
- 当前 profile 和 results 是未批准占位文件，不是正式预算或关闭证据。
- M1-B05 实现不得批准九项数值，也不得执行 D05 的独立关闭复核。

## Harness 边界

- `generateTxtResourceSamples.mjs` 只在系统临时目录生成固定 seed、固定 hash 的 1 MiB、10 MiB、50 MiB 合成 TXT；矩阵覆盖 UTF-8、GBK/GB18030、Big5、最长单行、密集短块和常规章节混合。
- `runTxtResourceBenchmark.mjs` 由主进程顺序启动独立 Node worker。worker 流式严格解码、通过 backpressure 写临时 UTF-8 输出，并记录进程启动 RSS、周期 RSS、`resourceUsage().maxRSS`、临时字节峰值、wall/CPU、吞吐、块数、最大块、取消延迟、进度和输出 hash。
- `verifyTxtResourceResults.mjs` 校验 profile、results、payload hash、每 case 至少五次独立原始测量、由 raw runs 重算的 maxima/建议值、输出稳定性、清理证据、`default`、项目 `maximum` ceiling、九项 `ceiling + 1`、九项 `globalCeiling + 1`、取消、timeout、临时空间不足，以及正式运行所需的负责人批准和真实样章授权引用；每个配置值同时受 `minimum`、`maximum` 和 `globalCeiling` 约束。
- 临时空间预检和建议值共用 `2 × source byte length` 公式；建议值还必须不低于实测临时峰值的 1.25 倍，两者取较大值。该公式只生成未批准候选，不代表负责人批准。
- harness 不创建产品 Artifact revision，不读取或修改 `packages/novel-import/src/**`。

## 探索运行

探索运行只允许把结果写入系统临时目录：

```bash
node packages/novel-import/benchmark/runTxtResourceBenchmark.mjs \
  --explore \
  --out "$TMPDIR/voxweaver-m1-b05-explore/results.json"
```

探索 profile 是代码内的未批准安全包络；其测量建议只用于负责人评估，不得复制为已批准默认值、配置范围或 global ceiling。探索结果不得替代获授权真实样章运行。

## 正式运行前置

负责人必须先完成以下输入：

1. 逐项批准九个预算字段的 `default`、`minimum`、`maximum`、`globalCeiling`。
2. 把 profile `approval.status` 改为 `approved`，并填写独立负责人和批准时间。
3. 填写真实样章的 opaque `sampleId`、SHA-256、byte length、encoding 和授权 `evidenceRef`；原文、书名、作者、文件名和持久化绝对路径不得进入仓库。
4. 通过 `--real-sample` 或 `VOXWEAVER_M1_REAL_SAMPLE_PATH` 只在运行时提供真实样章路径。
5. 在 Node `24.18.1` 下运行并由非 M1-B05 实现代理独立复核。

固定正式命令：

```bash
fnm exec --using=24.18.1 pnpm --filter @voxweaver/novel-import run benchmark:txt -- \
  --profile docs/validation/m1-resource-budget.profile.json \
  --out docs/validation/m1-resource-budget.results.json
```

占位 profile 会在测量启动前以 `NOVEL_IMPORT_BUDGET_INVALID` 拒绝；runner 只在完整测量和验证通过后原子替换 results，不会在失败时生成正式结果。
