# Diagnosis for check 3 on round 4: the visitor's click on the interpolation cube produced no select. Replicates
# c2.py check 3's setup (a parked onTick spinner at [-1.5, 0.5, -3], the slider at [-2, 0.5, -3]) and prints what the
# visitor's pick resolves, what the click sends, and what the host's runner logs — with and without the spinner.
import importlib.util
from common4d import *
spec = importlib.util.spec_from_file_location('c2g', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'c2.py'))
src = open(spec.origin).read(); G2 = G3 = None
exec(src.split('FRAMES = ')[0].split('from common4d import *')[1], globals())      # G2, G3, TARGET only

with sync_playwright() as pw:
    br = new_browser(pw); register(br)
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    vctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True); W = new_world(a, 'pc3'); a.connect(W)
    v = Tab(vctx, 'V'); v.connect(W); a.page.wait_for_timeout(800)
    for with_spinner in (False, True):
        a.edit_on()
        if with_spinner:
            x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
            import_graph(a, x, gltf_doc(G2, ['Spinner']), 'spin.gltf', {'Spinner (node)': x}); set_enabled(a, x, True)
            a.page.wait_for_timeout(3000); set_enabled(a, x, False)
        y = add_cube(a); a.ev(MOVE, {'name': y, 't': [-2, 0.5, -3] if with_spinner else [2, 0.5, -3]}); a.page.wait_for_timeout(300)
        import_graph(a, y, gltf_doc(G3, ['Slider']), 'slide.gltf', {'Slider (node)': y}); set_enabled(a, y, True)
        edit_off(a); v.page.wait_for_timeout(800)
        print(f'\n-- spinner {"present" if with_spinner else "absent"}: slider {y} at {tr(a, y)}')
        print('   visitor pick at the slider:', pick_at(v, y))
        if with_spinner: print('   spinner', x, 'at', tr(a, x), 'rotation', [round(c, 3) for c in rot(a, x)], '| visitor sees it at', tr(v, x))
        n0 = len(v.ws); click_node(v, y); v.page.wait_for_timeout(2500)
        up = [m.get('type') for (d, m) in v.ws[n0:] if d == '>' and isinstance(m, dict)]
        print('   visitor sent:', sorted(set(up)), '| host log:', rlog(a, 4), '| slider now', tr(a, y))
    br.close()
