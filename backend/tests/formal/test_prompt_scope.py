from fileaction.agent.prompts import policy

def test_generation_prompt_explains_artifact_scope():
    prompt = policy("generating")
    assert "context.kind" in prompt
    assert "generate_artifact" in prompt
    assert "artifact 必须为 null" in prompt
