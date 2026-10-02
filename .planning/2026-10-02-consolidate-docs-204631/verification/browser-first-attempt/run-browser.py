from pathlib import Path
import functools
import http.server
import json
import os
import subprocess
import threading
import urllib.request

root = Path.cwd()
out = Path(__file__).resolve().parent

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
demo = subprocess.Popen(['python3', 'docs/05-交互Demo/serve.py', '--port', '0', '--no-browser'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    line = demo.stdout.readline()
    demo_url = line[line.index('http://'):].strip()
    with urllib.request.urlopen(demo_url, timeout=10) as response:
        result = {'status': response.status, 'url': response.url}
    (out / 'demo-entry-after.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    assert result['status'] == 200
    env = dict(os.environ, PLAYWRIGHT_MODULE='/private/var/folders/l8/myn9yrh57x1cynsh8bsd0kq00000gn/T/opencode/fileaction-browser/node_modules/playwright', CHECK_BASE='http://127.0.0.1:' + str(server.server_port), CHECK_DEMO=demo_url)
    result = subprocess.run(['node', str(out / 'browser-check.cjs')], env=env, capture_output=True, text=True, timeout=120)
    (out / 'browser.txt').write_text(result.stdout + result.stderr)
    print(result.stdout + result.stderr)
    raise SystemExit(result.returncode)
finally:
    demo.terminate()
    demo.communicate(timeout=10)
    server.shutdown()
    server.server_close()
