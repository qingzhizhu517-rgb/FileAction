from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ErrorInfo:
    code: str
    message: str


class ConfigurationError(RuntimeError):
    """配置缺失或不符合正式服务合同。"""


class DependencyUnavailable(RuntimeError):
    """外部服务未就绪；消息不包含连接凭据。"""
