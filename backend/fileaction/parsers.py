from __future__ import annotations

import hashlib
import io
import zipfile
from pathlib import PurePath
from uuid import uuid4

from .schemas import Document, Segment

MAX_BYTES = 10 * 1024 * 1024
# 正式版允许较长材料：约 100 页普通文字 PDF；最终模型请求仍受上下文预算保护。
MAX_TEXT = 1000000
MAX_PDF_PAGES = 100
MAX_UNZIPPED = 10 * 1024 * 1024


class ParseError(ValueError):
    pass


def _finish(name: str, segments: list[Segment], digest: bytes, warnings: list[str] | None = None) -> Document:
    if not segments:
        raise ParseError("文件为空或没有可提取文本")
    text_len = sum(len(s.text) for s in segments)
    if text_len > MAX_TEXT:
        raise ParseError("提取文本超过 1,000,000 字符限制")
    return Document(id=str(uuid4()), name=PurePath(name).name or "文件", hash=hashlib.sha256(digest).hexdigest(), segments=segments, warnings=warnings or [])


def _text_segments(text: str) -> list[Segment]:
    if not text.strip():
        return []
    segments: list[Segment] = []
    total = 0
    for i, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        total += len(line)
        if total > MAX_TEXT:
            raise ParseError("提取文本超过 1,000,000 字符限制")
        segments.append(Segment(id=str(uuid4()), locator=f"第{i}行", text=line))
    return segments


def parse_document(filename: str, data: bytes) -> Document:
    if len(data) > MAX_BYTES:
        raise ParseError("文件超过 10 MiB 限制")
    suffix = PurePath(filename).suffix.lower()
    if suffix in (".txt", ".md", ".markdown"):
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ParseError("文本必须是 UTF-8 编码") from exc
        if "\x00" in text:
            raise ParseError("文本内容疑似二进制文件")
        if not text.strip():
            raise ParseError("空文件")
        return _finish(filename, _text_segments(text), data)
    if suffix == ".pdf":
        return _parse_pdf(filename, data)
    if suffix == ".docx":
        return _parse_docx(filename, data)
    raise ParseError("暂不支持该文件格式")


def _parse_pdf(filename: str, data: bytes) -> Document:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data), strict=False)
    except Exception as exc:
        raise ParseError("PDF 无法读取，可能是加密或内容损坏") from exc
    try:
        if reader.is_encrypted:
            raise ParseError("PDF 加密文件无法读取")
        if len(reader.pages) > MAX_PDF_PAGES:
            raise ParseError("PDF 超过 100 页限制")
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError("PDF 加密或内容损坏，无法读取") from exc
    segments: list[Segment] = []
    total_chars = 0
    warnings: list[str] = []
    for page_no, page in enumerate(reader.pages, 1):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        lines = _text_segments(text)
        if not lines:
            warnings.append(f"第{page_no}页没有可提取文本")
        for line in lines:
            total_chars += len(line.text)
            if total_chars > MAX_TEXT:
                raise ParseError("提取文本超过 1,000,000 字符限制")
            segments.append(line.model_copy(update={"locator": f"第{page_no}页 {line.locator}"}))
    return _finish(filename, segments, data, warnings)


def _parse_docx(filename: str, data: bytes) -> Document:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            total = sum(info.file_size for info in archive.infolist())
            if total > MAX_UNZIPPED:
                raise ParseError("DOCX 解压内容超过 10 MiB 限制")
            if "word/document.xml" not in archive.namelist():
                raise ParseError("DOCX 内容不完整")
        from docx import Document as DocxDocument
        source = DocxDocument(io.BytesIO(data))
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError("DOCX 无法读取或内容损坏") from exc
    segments: list[Segment] = []
    total_chars = 0
    for index, paragraph in enumerate(source.paragraphs, 1):
        text = paragraph.text.strip()
        if text:
            total_chars += len(text)
            if total_chars > MAX_TEXT:
                    raise ParseError("提取文本超过 300,000 字符限制")
            segments.append(Segment(id=str(uuid4()), locator=f"第{index}段", text=text))
    for table_no, table in enumerate(source.tables, 1):
        for row_no, row in enumerate(table.rows, 1):
            for col_no, cell in enumerate(row.cells, 1):
                text = cell.text.strip()
                if text:
                    total_chars += len(text)
                    if total_chars > MAX_TEXT:
                        raise ParseError("提取文本超过 1,000,000 字符限制")
                    segments.append(Segment(id=str(uuid4()), locator=f"第{table_no}个表格第{row_no}行第{col_no}列", text=text))
    return _finish(filename, segments, data)
