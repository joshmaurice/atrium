# signin-sync r2 — I4 step 3 (re-enabled by J3): a CONNECTED same-origin tab
# whose sign-in expires disconnects when it next checks (visibility), with no
# SIGNED_OUT from the server. Run after c.py, with authserver.mjs up.
import sys, time, sqlite3
sys.path.insert(0, '/tmp/ah/ss')
import importlib.util
from playwright.sync_api import sync_playwright
A='https://127.0.0.1:8443'; PAGE='/apps/client/local.html'; PW='correct-horse-battery-9'
with sync_playwright() as p:
    br = p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = br.new_context(ignore_https_errors=True).new_page()
    pg.goto(A+PAGE); pg.wait_for_function('window.atriumClient'); time.sleep(1)
    pg.fill('#auth-username','alice'); pg.fill('#auth-password',PW); pg.click('#auth-submit-btn')
    pg.wait_for_function("window.atriumClient.connected && window.atriumClient._wsUrl.includes('/worlds/alice/home')", timeout=12000)
    with sqlite3.connect('/tmp/ah/auth.db') as c: c.execute("UPDATE auth_sessions SET expires_at = '2000-01-01T00:00:00.000Z'")
    time.sleep(0.5)
    print('still connected before the check:', pg.evaluate('window.atriumClient.connected'))
    pg.evaluate("""() => { for (const v of ['hidden','visible']) { Object.defineProperty(document,'visibilityState',{value:v,configurable:true}); document.dispatchEvent(new Event('visibilitychange')) } }""")
    ok = True
    try: pg.wait_for_function('!window.atriumClient.connected', timeout=6000)
    except Exception: ok = False
    s = pg.evaluate("() => [window.atriumClient.connected, document.getElementById('auth-notice').textContent, document.getElementById('connectBtn').textContent]")
    print(('PASS' if ok and s[1].startswith('Your sign-in expired') else 'FAIL') + '  4b connected tab disconnects on an expired sign-in found by visibility', s)
    br.close()
