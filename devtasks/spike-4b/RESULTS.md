# D2 spike results (2026-10-23, Claude; the probes are in this folder, see README.md)
Engine @khronosgroup/gltf-interactivity-engine 1.1.0 (353,583 B, one ESM file, imports `gl-matrix` 3.4.4 ESM 186,002 B). Node 22.
Test assets KhronosGroup/glTF-Test-Assets-Interactivity @ 926bec45 (160 test files, 187 invalid cases).
- Host: own IEventBus on EventTarget (DOMEventBus needs `document`); ADecorator subclass; engine.processNodeStarted must be set on the ENGINE (bridgeEngineHooks doesn't carry it).
- t0: pointer/set writes go through registered setters. OK.
- t1 bounded: step budget via processNodeStarted throws -> caught at our executeEventQueueTick wrapper; next tick runs. while(true)+body, for 0..1e9+body, onTick heavy: stopped at 10,001 steps in 8-13 ms. Flow cycle: RangeError (stack) at ~4k depth, caught.
- t1b: while(true) WITHOUT body never calls the hook -> hung until killed (10 s timeout). Same for for 0..1e9 without body.
- t1c: subclass the registry's flow/while and flow/for, counting each evaluateRequiredValues/evaluateAllValues as a step (Class.init kept): both stopped at 10,001 steps in 6-7 ms; a normal for 0..5 still completes.
- t2 cleanup: dispose() cancels setDelay timers (1 -> 0) and nothing fires. loadBehaveGraph in place leaves the old timer live. pointer/interpolate keeps writing after dispose() AND after reload (callbacks live on the event bus; dispose doesn't clear them). One tick can schedule 5,000 delays (all cleared by dispose).
- t3 authority: setter refusal works for literal, {n}-template and interpolate (refused every frame); refused pointer/set continues on `out` (not `err`). Index beyond the registered bound and unregistered pointers take `err`. A throwing setter aborts the whole tick.
- t4 invalid: 187/187 rejected (46 rejectExtension at validateInteractivityExtension, 141 rejectGraph at loadBehaveGraph).
- t5 conformance with the minimal adapter (4 node pointers, stub animations): 141/156 pass (core 26/40, math 115/116). Fails: animation/* (6, stub), pointer/* (6, unregistered pointers), ref/eq, Extras/Matrix_Updates, math/matDecomp-Shear.
