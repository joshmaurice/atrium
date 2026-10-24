import json, time, urllib.request, ssl
from playwright.sync_api import sync_playwright

A = 'https://127.0.0.1:8443'
B = 'https://127.0.0.1:8444'
SHOTS = __import__('os').environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/shots'
_ctx = ssl.create_default_context(); _ctx.check_hostname = False; _ctx.verify_mode = ssl.CERT_NONE


def http(path, base=A):
    return urllib.request.urlopen(base + path, context=_ctx).read().decode()


def counts():
    return json.loads(http('/__counts'))


def ctl(**kw):
    q = '&'.join(f'{k}={v}' for k, v in kw.items())
    return http('/__ctl?' + q)


class Page:
    def __init__(self, browser, origin=A, path='/apps/client/local.html', ws_routes=None):
        self.ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
        self.page = self.ctx.new_page()
        self.errors = []
        self.console = []
        self.failed = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('console', lambda m: self.console.append(f'{m.type}: {m.text}'))
        self.page.on('requestfailed', lambda r: self.failed.append(f'{r.url} {r.failure}'))
        self.page.on('response', lambda r: self.failed.append(f'{r.status} {r.url}') if r.status >= 400 else None)
        if ws_routes:
            ws_routes(self.page)
        self.page.goto(origin + path)
        self.page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)

    def ev(self, js, arg=None):
        return self.page.evaluate(js, arg)

    def wait(self, js, timeout=30000, arg=None):
        return self.page.wait_for_function(js, arg=arg, timeout=timeout)

    def connect(self, ws):
        self.page.fill('#wsUrl', ws)
        self.page.click('#connectBtn')
        self.wait('window.atriumClient.connected && window.atriumClient.som')
        time.sleep(0.5)

    def edit_on(self):
        if not self.ev("document.getElementById('edit-panel') && getComputedStyle(document.getElementById('edit-panel')).display !== 'none'"):
            self.page.click('#edit-toggle-btn')
        self.wait("getComputedStyle(document.getElementById('edit-panel')).display !== 'none'", timeout=5000)

    def tex(self):
        return self.ev('stage._renderer ? stage._renderer.info.memory.textures : (stage.renderer.info.memory.textures)')

    def bg(self):
        return self.ev("""() => { const s = stage.scene; const b = s.background; return b ? { uuid: b.uuid, w: b.image?.width, h: b.image?.height, env: s.environment === b } : null }""")

    def close(self):
        self.ctx.close()
