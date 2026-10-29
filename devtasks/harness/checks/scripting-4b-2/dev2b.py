# DEV acceptance step 2 as the operator did it: "Every N seconds: play" on a model, in a world with several models,
# one of them WITHOUT clips (a library model), the other the Fox. What does the form show, and what does Save do?
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'f1.py')).read().split('\nwith sync_playwright() as pw:')[0])
SHOT = __import__('os').environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/shots/4b-2-r6/'
__import__('os').makedirs(SHOT, exist_ok=True)
STATE = "() => { const s = __beh().behaviorForm.state; return { template: s.template, targetId: s.targetId, params: s.params, error: s.error, status: s.status } }"
ROWS = """() => [...document.querySelectorAll('#ep-behavior-params > *')].map(r => ({ label: r.childNodes[0]?.textContent?.trim(), field: r.querySelector('[data-field]')?.dataset.field, tag: r.querySelector('[data-field]')?.tagName, value: r.querySelector('[data-field]')?.value, opts: r.querySelector('select') ? [...r.querySelector('select').options].map(o => o.textContent) : null }))"""
with sync_playwright() as pw:
    br = new_browser(pw)
    ctl(catalog='small')
    W = 'wss://127.0.0.1:8443/w/dev2' + T
    a = Page(br); a.connect(W); a.edit_on()
    fox = add_model(a, FOX, scale=0.01); a.page.wait_for_timeout(2000); a.ev(MOVE, {'name': fox, 't': [3, 0, -6]})
    # a library model (no clips)
    a.page.click('#ep-library'); a.page.wait_for_timeout(500)
    before = set(a.ev("atriumClient.som.nodes.map(n => n.name)"))
    a.page.locator('.lg-tile').first.click(); a.page.wait_for_timeout(2500)
    lib = [n for n in a.ev("atriumClient.som.nodes.map(n => n.name)") if n not in before][0]
    a.ev(MOVE, {'name': lib, 't': [-2, 0, -5]})
    print('D models', fox, lib, '| clips', {n: a.ev("(n) => __anim().modelAnimations.status(n)", n) for n in (fox, lib)})
    for model in (lib,):
        a.ev(SEL, model); a.page.wait_for_timeout(400); choose(a, 'interval-animation'); a.page.wait_for_timeout(300)
        print(f'D [{model}] rows', a.ev(ROWS)); print(f'D [{model}] state', a.ev(STATE), '| save', a.ev(FORM)['save'])
        a.page.click('#ep-library-cancel') if a.ev("!!document.getElementById('ep-library-cancel') && getComputedStyle(document.getElementById('ep-library-cancel')).display !== 'none'") else None
        a.ev("() => document.getElementById('ep-behavior-row').scrollIntoView({ block: 'start' })"); a.page.wait_for_timeout(200)
        box = a.ev("() => { const t = document.getElementById('ep-behavior-row').getBoundingClientRect(); const b = document.getElementById('ep-behavior-actions').getBoundingClientRect(); return { x: t.left - 8, y: t.top - 8, width: t.width + 16, height: b.bottom - t.top + 40 } }")
        a.page.screenshot(path=SHOT + f'dev2-{model.replace(" ", "_")}.png', clip=box)
        n0 = len(a.errors); a.page.click('#ep-behavior-save'); a.page.wait_for_timeout(1500)
        print(f'D [{model}] after Save: leaf', a.ev(LEAFV, model), '| status', repr(a.ev(FORM)['status']), '| state', a.ev(STATE), '| rows', [(r['field'], r['value']) for r in a.ev(ROWS)], '| errors', a.errors[n0:])
    print('errors', a.errors[:5])
    br.close()
