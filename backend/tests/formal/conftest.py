import asyncio
import sys


def pytest_asyncio_loop_factories():
    if sys.platform == "win32":
        return {"selector": asyncio.SelectorEventLoop}
    return {"default": asyncio.new_event_loop}
