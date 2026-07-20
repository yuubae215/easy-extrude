"""BFF <-> コアAPI 契約 (ADR-074)。型 + contractVersion ガードのみ。判定の実装は含まない。"""

from .models import (
    GraspSearchDeclaration,
    GraspSearchRequest,
    GraspSearchResponse,
    PoseCandidate,
    ScoreBreakdown,
    SearchDiagnostics,
)
from .recommendation_models import (
    EquivalenceProposalWire,
    ProposalEvidenceWire,
    RecommendationRequest,
    RecommendationResponse,
    ReferenceCandidateWire,
    RequirementQueryWire,
    StructuralDiffWire,
)
from .scene_models import (
    CameraWire,
    GraspSettingsWire,
    GripperWire,
    PickSequenceRequest,
    PickSequenceResponse,
    PickStepWire,
    RobotWire,
    SceneEntityWire,
    SceneWire,
    SphereWire,
    SurfaceSampleWire,
)
from .version import (
    CONTRACT_VERSION,
    ContractVersionMismatch,
    check_contract_version,
)

__all__ = [
    "CONTRACT_VERSION",
    "ContractVersionMismatch",
    "check_contract_version",
    "GraspSearchDeclaration",
    "GraspSearchRequest",
    "GraspSearchResponse",
    "PoseCandidate",
    "ScoreBreakdown",
    "SearchDiagnostics",
    # 推薦/類似レーン (ADR-077)
    "RecommendationRequest",
    "RecommendationResponse",
    "RequirementQueryWire",
    "ReferenceCandidateWire",
    "StructuralDiffWire",
    "EquivalenceProposalWire",
    "ProposalEvidenceWire",
    # bin-picking シーン層 (ADR-078)
    "PickSequenceRequest",
    "PickSequenceResponse",
    "SceneWire",
    "SceneEntityWire",
    "SphereWire",
    "SurfaceSampleWire",
    "GraspSettingsWire",
    "RobotWire",
    "CameraWire",
    "GripperWire",
    "PickStepWire",
]
