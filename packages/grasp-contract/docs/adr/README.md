# Architecture Decision Records

- [ADR-0004](0004-single-shared-contract-version.md) — 全エンドポイントで単一の contractVersion を共有し、不一致は封筒で 400 (Accepted)
- [ADR-0005](0005-pose-kind-discriminated-union.md) — grasp-search の pose を kind 判別 union 化する (Accepted)
- [ADR-0006](0006-tri-repo-responsibility-split.md) — 責務を private / public / contract の三リポジトリに分割する (Accepted)
- [ADR-0007](0007-grasp-search-diagnostics-rejection-funnel.md) — grasp-search レスポンスに diagnostics (棄却ファネル + reach near-miss) を載せる (Accepted)
- [ADR-0008](0008-domain-staged-funnel-v4.md) — grasp-search をドメイン段階 (見える/届く/掴める) へ拡張し contractVersion 4 (Accepted)
