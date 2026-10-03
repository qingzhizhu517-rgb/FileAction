"""短生命周期解析子进程；stdin输入合成/授权文件，stdout只返回受限DTO。"""
import json
import sys
from fileaction.parsers import parse_document, MAX_BYTES


def main():
    try:
        name = sys.stdin.buffer.readline(4096).decode("utf-8").rstrip("\n")
        content = sys.stdin.buffer.read(MAX_BYTES + 1)
        result = parse_document(name, content)
        sys.stdout.buffer.write(result.model_dump_json().encode("utf-8"))
    except Exception:
        sys.stdout.buffer.write(json.dumps({"error": "DOCUMENT_PARSE_FAILED"}).encode("utf-8"))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
