# Probe: what RTTs does the clock window hold, and how far is serverNow() from the truth?
from anim import *
W = 'wss://127.0.0.1:8443/w/s4aclk'
SAMPLES = "() => { const c = atriumClient._connectionRecord.clock; return { samples: c.samples.map(s => [+s.rtt.toFixed(1), +s.offset.toFixed(1)]), errMs: +(atriumClient.serverNow() - (performance.timeOrigin + performance.now())).toFixed(1) } }"
with sync_playwright() as pw:
    br = new_browser(pw)
    a = SPage(br); a.connect(W); a.edit_on()
    print('A empty world', a.ev(SAMPLES))
    fox = add_model(a, FOX, scale=0.01); cm = add_model(a, CESIUM)
    play(a, fox, 'Run', True)
    print('A after adds', a.ev(SAMPLES))
    d = SPage(br, origin=B); d.page.fill('#wsUrl', W + '?visitor'); d.page.click('#connectBtn')
    d.wait('atriumClient.connected && atriumClient.som'); d.page.wait_for_timeout(3000)
    print('D joined with 2 models', d.ev(SAMPLES))
    # frame cost on each page
    for p, n in ((a, 'A'), (d, 'D')):
        print(n, 'frame ms', p.ev("() => new Promise(r => { const t = []; let last = performance.now(); let k = 0; function f(now) { t.push(now - last); last = now; if (++k < 20) requestAnimationFrame(f); else r(t.slice(2).map(x => +x.toFixed(1))) } requestAnimationFrame(f) })"))
    # a fresh burst on an idle page: force a discontinuity-free rebuild by reconnecting
    d.page.click('#connectBtn'); d.wait('!atriumClient.connected'); d.page.wait_for_timeout(500)
    d.page.click('#connectBtn'); d.wait('atriumClient.connected && atriumClient.som'); d.page.wait_for_timeout(3000)
    print('D reconnected (template cached?)', d.ev(SAMPLES))
    br.close()
