"""Bounded multipart parsing without Starlette's spooled temporary disk files."""
from dataclasses import dataclass
from typing import AsyncIterable
from python_multipart import MultipartParser
from python_multipart.multipart import parse_options_header


class UploadError(ValueError):
    pass


@dataclass(frozen=True)
class Upload:
    filename: str
    content: bytes
    fields: dict[str, str]


async def read_upload(stream: AsyncIterable[bytes], content_type: str, *, max_bytes: int = 10 * 1024 * 1024) -> Upload:
    media, options = parse_options_header(content_type)
    boundary = options.get(b"boundary", b"")
    if media != b"multipart/form-data" or not 1 <= len(boundary) <= 200:
        raise UploadError("UPLOAD_INVALID")
    fields: dict[str, str] = {}
    file = bytearray()
    part = bytearray()
    header_name = bytearray()
    header_value = bytearray()
    headers: dict[bytes, bytes] = {}
    name = ""
    filename: str | None = None
    finished = False
    header_bytes = 0
    seen: set[str] = set()

    def part_begin():
        nonlocal header_bytes
        part.clear(); headers.clear(); header_name.clear(); header_value.clear()
        header_bytes = 0

    def header_field(data, start, end):
        nonlocal header_bytes
        header_bytes += end - start
        if header_bytes > 8192: raise UploadError("UPLOAD_INVALID")
        header_name.extend(data[start:end])

    def header_val(data, start, end):
        nonlocal header_bytes
        header_bytes += end - start
        if header_bytes > 8192: raise UploadError("UPLOAD_INVALID")
        header_value.extend(data[start:end])

    def header_end():
        key = bytes(header_name).lower()
        if key in headers: raise UploadError("UPLOAD_INVALID")
        headers[key] = bytes(header_value)
        header_name.clear(); header_value.clear()

    def headers_done():
        nonlocal name, filename
        disposition, params = parse_options_header(headers.get(b"content-disposition", b""))
        try:
            name = params.get(b"name", b"").decode("ascii")
            if disposition != b"form-data" or name not in {"file", "retention", "consent_to_store", "storage_notice_version", "expected_revision"} or name in seen:
                raise UploadError("UPLOAD_INVALID")
            seen.add(name)
            if name == "file":
                filename = params[b"filename"].decode("utf-8")
                if not filename or len(filename) > 255 or any(ord(c) < 32 for c in filename):
                    raise UploadError("UPLOAD_INVALID")
                filename = filename.replace("\\", "/").rsplit("/", 1)[-1]
            elif b"filename" in params:
                raise UploadError("UPLOAD_INVALID")
        except (KeyError, UnicodeError):
            raise UploadError("UPLOAD_INVALID") from None

    def part_data(data, start, end):
        target = file if name == "file" else part
        if len(target) + end - start > (max_bytes if name == "file" else 1024):
            raise UploadError("FILE_TOO_LARGE" if name == "file" else "UPLOAD_INVALID")
        target.extend(data[start:end])

    def part_end():
        if name != "file":
            try: fields[name] = part.decode("utf-8")
            except UnicodeError: raise UploadError("UPLOAD_INVALID") from None

    def end():
        nonlocal finished
        finished = True

    parser = MultipartParser(boundary, {"on_part_begin": part_begin, "on_header_field": header_field, "on_header_value": header_val, "on_header_end": header_end, "on_headers_finished": headers_done, "on_part_data": part_data, "on_part_end": part_end, "on_end": end})
    count = 0
    try:
        async for chunk in stream:
            count += len(chunk)
            if count > max_bytes + 16384:
                raise UploadError("FILE_TOO_LARGE")
            parser.write(chunk)
        parser.finalize()
    except UploadError:
        raise
    except Exception:
        raise UploadError("UPLOAD_INVALID") from None
    if not finished or filename is None or not file:
        raise UploadError("UPLOAD_INVALID")
    return Upload(filename, bytes(file), fields)
