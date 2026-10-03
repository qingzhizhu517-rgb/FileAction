"""严格模型合同与确定性来源校验。"""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, model_validator

Text = Annotated[str, StringConstraints(min_length=1, max_length=4000, pattern=r'\S')]
Identifier = Annotated[str, StringConstraints(min_length=1, max_length=160)]
Version = Annotated[str | int, Field()]

class AgentError(ValueError):
    pass

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)

class DocumentEvidence(Strict):
    type: Literal['document']
    document_id: Identifier
    version: Version
    segment_id: Identifier
    quote: Text

class FactEvidence(Strict):
    type: Literal['fact']
    fact_id: Identifier
    version: int = Field(ge=1)

EvidenceRef = Annotated[DocumentEvidence | FactEvidence, Field(discriminator='type')]

class Claim(Strict):
    id: Identifier
    text: Text
    kind: Literal['document_fact', 'user_fact', 'inference', 'unknown']
    evidence: list[EvidenceRef] = Field(max_length=20)

class Candidate(Strict):
    id: Identifier
    text: Text
    evidence: list[EvidenceRef] = Field(min_length=1, max_length=20)

class Artifact(Strict):
    title: Text
    kind: Literal['markdown', 'checklist', 'evidence_summary']
    body: Annotated[str, StringConstraints(min_length=1, max_length=30000, pattern=r'\S')]

class AnswerEnvelope(Strict):
    summary: Text
    claims: list[Claim] = Field(max_length=100)
    questions: list[Text] = Field(max_length=20)
    memory_candidates: list[Candidate] = Field(max_length=20)
    action_candidates: list[Candidate] = Field(max_length=20)
    unknowns: list[Text] = Field(max_length=20)
    coverage: Literal['full_selected_text', 'selected_excerpts']
    artifact: Artifact | None

class SearchArgs(Strict):
    query: Annotated[str, StringConstraints(min_length=1,max_length=200,pattern=r'\S')]
    document_ids: list[Identifier] = Field(max_length=20)
    limit: int = Field(ge=1,le=12)
class SearchRequest(Strict):
    tool: Literal['search_evidence']
    arguments: SearchArgs
class SegmentId(Strict):
    document_id: Identifier
    version: Version
    segment_id: Identifier
class ReadArgs(Strict):
    segments: list[SegmentId] = Field(max_length=12)
class ReadRequest(Strict):
    tool: Literal['read_segments']
    arguments: ReadArgs
class FactsArgs(Strict):
    fact_ids: list[Identifier] = Field(max_length=20)
class FactsRequest(Strict):
    tool: Literal['inspect_confirmed_facts']
    arguments: FactsArgs
class ArtifactArgs(Strict):
    artifact_id: Identifier
    version: int = Field(ge=1)
class ArtifactRequest(Strict):
    tool: Literal['read_artifact_version']
    arguments: ArtifactArgs
class RatioArgs(Strict):
    numerator: float
    denominator: float
    evidence: list[EvidenceRef] = Field(min_length=1,max_length=20)
    @model_validator(mode='after')
    def nonzero(self):
        if self.denominator == 0: raise ValueError('zero denominator')
        return self
class RatioRequest(Strict):
    tool: Literal['calculate_ratio']
    arguments: RatioArgs
ToolRequest = Annotated[SearchRequest | ReadRequest | FactsRequest | ArtifactRequest | RatioRequest,Field(discriminator='tool')]
class Plan(Strict):
    intent: Literal['explain_relevance','answer_question','compare_requirements','clarify','propose_actions','revise_draft']
    evidence_requests: list[ToolRequest] = Field(max_length=6)
    needs_user_input: bool
    question: Text | None
    @model_validator(mode='after')
    def question_consistent(self):
        if self.needs_user_input != (self.question is not None): raise ValueError('question inconsistent')
        return self

def validate_evidence(evidence, manifest):
    result=[]
    for ref in evidence:
        value=ref.model_dump() if isinstance(ref,BaseModel) else dict(ref)
        if value['type']=='document':
            doc=next((d for d in manifest['documents'] if d['document_id']==value['document_id'] and d.get('document_version_id')==value['version']),None)
            # Multiple authorized ranges of one segment are legal.
            segment=next((s for s in (doc or {}).get('segments',[]) if s['segment_id']==value['segment_id'] and value['quote'] in s['text']),None)
            if not segment: raise AgentError('EVIDENCE_INVALID')
            start=segment.get('char_start',0)+segment['text'].index(value['quote'])
            value.update(char_start=start,char_end=start+len(value['quote']),location=segment.get('location'))
        else:
            fact=next((f for f in manifest['facts'] if f['id']==value['fact_id'] and f['version']==value['version'] and f.get('confirmed')),None)
            if not fact: raise AgentError('EVIDENCE_INVALID')
        result.append(value)
    return result

def validate_answer(raw, manifest):
    try: answer=AnswerEnvelope.model_validate(raw).model_dump()
    except ValidationError: raise AgentError('MODEL_SCHEMA_INVALID') from None
    if len({c['id'] for c in answer['claims']}) != len(answer['claims']): raise AgentError('MODEL_SCHEMA_INVALID')
    if (manifest['kind']=='generate_artifact') != (answer['artifact'] is not None): raise AgentError('ARTIFACT_SCOPE_INVALID')
    for claim in answer['claims']:
        claim['evidence']=validate_evidence(claim['evidence'],manifest)
        kinds={e['type'] for e in claim['evidence']}
        if ((claim['kind']=='document_fact' and 'document' not in kinds) or (claim['kind']=='user_fact' and 'fact' not in kinds) or (claim['kind']=='inference' and not kinds)):
            raise AgentError('EVIDENCE_INVALID')
    for candidate in [*answer['memory_candidates'],*answer['action_candidates']]:
        candidate['evidence']=validate_evidence(candidate['evidence'],manifest)
    answer['coverage']=manifest['coverage']
    return answer
