import asyncio
import json

import httpx
import pytest

from fileaction.model import ModelConfig, ModelError, OpenAICompatibleModel


def test_unconfigured_model_fails_without_network(monkeypatch):
    config = ModelConfig(base_url=None, api_key=None, model=None)
    with pytest.raises(ModelError, match="未配置"):
        OpenAICompatibleModel(config).interpret("文本", [], [])


@pytest.mark.asyncio
async def test_chat_completions_payload_and_structured_response():
    seen = {}

    async def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps({
                "items": [], "questions": [], "unknowns": ["合成未知事项"], "candidates": []
            })}}]},
        )

    transport = httpx.MockTransport(handler)
    config = ModelConfig(base_url="https://model.test/v1", api_key="secret", model="demo")
    result = await OpenAICompatibleModel(config, transport=transport).interpret_async("文本", [], [])
    assert result.items == []
    assert seen["url"] == "https://model.test/v1/chat/completions"
    assert seen["authorization"] == "Bearer secret"
    assert seen["body"]["model"] == "demo"


@pytest.mark.asyncio
async def test_invalid_model_json_is_explicit_error():
    async def handler(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": "not-json"}}]})

    config = ModelConfig(base_url="https://model.test", api_key="key", model="demo")
    with pytest.raises(ModelError, match="结构"):
        await OpenAICompatibleModel(config, transport=httpx.MockTransport(handler)).interpret_async("文本", [], [])


@pytest.mark.asyncio
async def test_model_payload_includes_schema_and_rejects_empty_objects():
    captured = {}
    async def handler(request):
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})
    model = OpenAICompatibleModel(ModelConfig("https://model.test", "key", "demo"), transport=httpx.MockTransport(handler))
    with pytest.raises(ModelError):
        await model.interpret_async("合成", [], [])
    assert captured["response_format"] == {"type": "json_object"}
    schema = json.loads(captured["messages"][1]["content"])["output_schema"]
    assert set(schema["required"]) == {"items", "questions", "unknowns", "candidates"}


@pytest.mark.asyncio
@pytest.mark.parametrize("goal", [None, "合成目标：核实资格"])
async def test_json_object_only_provider_supports_reading_and_artifact(goal):
    """HTTP替身复现真实供应商拒绝json_schema；不代表真实模型验收。"""
    calls = 0
    async def handler(request):
        nonlocal calls
        calls += 1
        payload = json.loads(request.content)
        if payload["response_format"] != {"type": "json_object"}:
            return httpx.Response(400, json={"error": {"message": "This response_format type is unavailable now"}})
        schema = json.loads(payload["messages"][1]["content"])["output_schema"]
        assert schema["additionalProperties"] is False
        if goal is None:
            assert set(schema["required"]) == {"items", "questions", "unknowns", "candidates"}
            output = {"items": [], "questions": [], "unknowns": ["合成资格待核实"], "candidates": []}
        else:
            assert set(schema["required"]) == {"text", "citations", "fact_ids"}
            output = {"text": "合成草稿：资格待核实，尚未报名。", "citations": [], "fact_ids": []}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(output)}, "finish_reason": "stop"}]})
    model = OpenAICompatibleModel(ModelConfig("https://model.test/v1", "synthetic-key", "synthetic-model"), transport=httpx.MockTransport(handler))
    result = await model.interpret_async("合成通知", [], [], goal=goal)
    assert calls == 1
    if goal is None:
        assert result.unknowns == ["合成资格待核实"]
    else:
        assert result.text == "合成草稿：资格待核实，尚未报名。"


@pytest.mark.asyncio
async def test_model_refusal_and_timeout_are_explicit_and_no_retry():
    calls = 0
    async def handler(request):
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("secret input", request=request)
    model = OpenAICompatibleModel(ModelConfig("https://model.test", "key", "demo"), transport=httpx.MockTransport(handler))
    with pytest.raises(ModelError, match="超时"):
        await model.interpret_async("敏感原文", [], [])
    assert calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("message,finish_reason", [
    ({"content": '{"items":[],"questions":[],"unknowns":[],"candidates":[]}'}, "stop"),
    ({"content": None, "refusal": "refuse"}, "stop"),
    ({"content": '{"items":[],"questions":[],"unknowns":["unknown"],"candidates":[]}'}, "length"),
    ({"content": '{"items":[],"questions":[],"unknowns":["unknown"],"candidates":[],"fake":true}'}, "stop"),
])
async def test_rejects_empty_refused_truncated_and_extra_model_output(message, finish_reason):
    async def handler(request):
        return httpx.Response(200, json={"choices": [{"message": message, "finish_reason": finish_reason}]})
    model = OpenAICompatibleModel(ModelConfig("https://model.test", "key", "demo"), transport=httpx.MockTransport(handler))
    with pytest.raises(ModelError):
        await model.interpret_async("合成", [], [])


@pytest.mark.asyncio
async def test_blank_artifact_is_rejected():
    async def handler(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text":"   ","citations":[],"fact_ids":[]}'}}]})
    model = OpenAICompatibleModel(ModelConfig("https://model.test", "key", "demo"), transport=httpx.MockTransport(handler))
    with pytest.raises(ModelError):
        await model.interpret_async("合成", [], [], goal="准备清单")


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [
    {"choices": [None]},
    {"choices": [{"message": []}]},
    {"choices": [{"message": {"content": [None]}}]},
    {"choices": [{"message": {"content": '{"items":[],"questions":[],"unknowns":["   "],"candidates":[]}'}}]},
    {"choices": [{"message": {"content": '{"items":[],"questions":[],"unknowns":["unknown"],"candidates":[]}'}, "finish_reason": "content_filter"}]},
])
async def test_malformed_and_filtered_model_output_always_becomes_safe_error(body):
    async def handler(request):
        return httpx.Response(200, json=body)
    model = OpenAICompatibleModel(ModelConfig("https://model.test", "key", "demo"), transport=httpx.MockTransport(handler))
    with pytest.raises(ModelError):
        await model.interpret_async("合成", [], [])


def test_strict_model_schemas_require_every_declared_field():
    from fileaction.schemas import Reading, Artifact
    for model in (Reading, Artifact):
        schema = model.model_json_schema()
        for node in [schema, *schema.get("$defs", {}).values()]:
            assert node["additionalProperties"] is False
            assert set(node["required"]) == set(node["properties"])


