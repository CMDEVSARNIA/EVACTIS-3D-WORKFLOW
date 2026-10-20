# 0016 — Hardening Object.prototype without breaking printing

**Context.** Both desktop apps had Tauri's `freezePrototype` on, which runs
`Object.freeze(Object.prototype)` before any page script. That stops prototype
pollution, but it also turns the common pattern `Foo.prototype.toString = …` into a
TypeError (the "override mistake"): the assignment finds the frozen inherited property
and refuses. pdf-lib (`PDFObject.prototype.toString`) and fontkit
(`….prototype.valueOf`) do this when they load. Printing (evacuation plans, registers,
certificates) only ever ran in browser tests, which do not freeze, so this went
unnoticed until Phase 8: the SCORM export pulled the print package into Studio's
startup bundle and the installed Studio rendered a blank window (real-app smoke test on
Linux and Windows).

**Decision.**
- **Our own hardening script replaces `freezePrototype`** (`crates/evx-desktop/src/
  harden.js`, added as a window initialization script, so it still runs before any page
  script). Each data property of `Object.prototype` becomes a getter/setter pair: reads
  are unchanged; assigning on `Object.prototype` itself throws; assigning on any other
  object defines an own property, as it would without a freeze. Then
  `Object.prototype` is frozen, so nothing can be added, removed or redefined on it.
  This is the property-override technique SES uses for frozen intrinsics.
- **The e2e tests inject the same file** into every page (`e2e/offline.ts`), so library
  code that would break in the apps breaks in the browser tests first. A unit test
  prints a certificate with pdf-lib and fontkit under the hardening and shows that a
  plain freeze breaks the same pattern.
- **The packaging package imports the ZIP writer from `@evactis-3dworkflow/print/zip`**,
  so Studio's startup bundle no longer contains pdf-lib (printing stays a lazy chunk).

**Consequences.** Protection against prototype pollution is unchanged. Inherited
methods are now read through an accessor (negligible cost). `freezePrototype` is off
in both `tauri.conf.json` files and must stay off while `harden.js` is in place (the
two together would bring the TypeError back).
