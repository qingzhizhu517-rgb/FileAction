"""内存上传解析测试，全部输入为合成数据。"""
import pytest
from fileaction.documents.multipart import read_upload, UploadError


async def body(data):
    for start in range(0, len(data), 7):
        yield data[start:start+7]


def payload(extra=b""):
    return (b'--synthetic\r\nContent-Disposition: form-data; name="retention"\r\n\r\ntemporary\r\n'
            b'--synthetic\r\nContent-Disposition: form-data; name="file"; filename="synthetic.txt"\r\n'
            b'Content-Type: text/plain\r\n\r\nsynthetic content\r\n' + extra + b'--synthetic--\r\n')


@pytest.mark.asyncio
async def test_streamed_multipart_handles_fragmented_headers_and_preserves_bytes():
    upload = await read_upload(body(payload()), "multipart/form-data; boundary=synthetic")
    assert upload.filename == "synthetic.txt"
    assert upload.content == b"synthetic content"
    assert upload.fields == {"retention": "temporary"}


@pytest.mark.asyncio
async def test_duplicate_or_unknown_fields_and_incomplete_payload_are_rejected():
    duplicate = b'--synthetic\r\nContent-Disposition: form-data; name="retention"\r\n\r\nretained\r\n'
    with pytest.raises(UploadError, match="UPLOAD_INVALID"):
        await read_upload(body(payload(duplicate)), "multipart/form-data; boundary=synthetic")
    with pytest.raises(UploadError, match="UPLOAD_INVALID"):
        await read_upload(body(payload()[:-20]), "multipart/form-data; boundary=synthetic")


@pytest.mark.asyncio
async def test_actual_stream_size_enforces_limit_without_trusting_content_length():
    with pytest.raises(UploadError, match="FILE_TOO_LARGE"):
        await read_upload(body(payload()), "multipart/form-data; boundary=synthetic", max_bytes=8)
