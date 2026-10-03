import time

import pytest

from fileaction.sessions import SessionStore


def test_ttl_and_maximum_sessions_are_enforced():
    store = SessionStore(ttl=3600, max_sessions=1)
    one = store.create()
    assert len(one.value.id) >= 32
    with pytest.raises(ValueError, match="上限"):
        store.create()
    one.last_seen = time.monotonic() - 3601
    store.cleanup()
    assert store.get(one.value.id) is None
    assert store.create().value.id != one.value.id

