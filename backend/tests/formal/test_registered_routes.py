"""正式工厂挂载合同；不连接外部服务，也不手动补挂路由。"""
from fileaction.api.application import create_app
from fileaction.core.config import Settings


def test_formal_factory_registers_indexing_actions_and_artifacts():
    app = create_app(Settings())
    paths = app.openapi()["paths"]
    expected = {
        "/api/v1/documents/{document_id}/index-preview": "post",
        "/api/v1/documents/{document_id}/indexes": "post",
        "/api/v1/index-jobs/{job_id}": "get",
        "/api/v1/actions": "post",
        "/api/v1/artifacts": "get",
        "/api/v1/artifacts/{identifier}/export": "post",
        "/api/v1/workspaces/{identifier}/export": "post",
    }
    for path, method in expected.items():
        assert path in paths, f"正式工厂未挂载 {path}"
        assert method in paths[path]
