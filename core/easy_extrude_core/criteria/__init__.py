"""判定基準の聞き取りレーン (ADR-165 D3 / D6) — 案・関心・差し出すもの。

線 (エンドユーザ全員の比重・期待値・重み) から、案 (候補セルと実態値)、
エンドユーザ × 大項目の関心、提案の差し出すものを出す。どれもアイデア
(CLAUDE.md §AI 向けガード 軸 1) なので core/ にだけ在り、フロントは描くだけ。

純粋な評価 (`assessment`) と、案を差し出す継ぎ目 (`cells.CellSource` — naive 既定は
名目セル表) と、wire との変換 (`lane.trial`) を分ける (ADR-075 の pure/副作用規律)。
"""

from __future__ import annotations

from .assessment import LineError
from .cells import Actual, Cell, CellSource, NominalCellCatalog
from .lane import line_of, trial

__all__ = ["Actual", "Cell", "CellSource", "LineError", "NominalCellCatalog", "line_of", "trial"]
