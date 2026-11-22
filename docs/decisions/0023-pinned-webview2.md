# 0023 — The embedded WebView2 installer is pinned by its SHA-256

**Context.** Every Windows setup embeds Microsoft's WebView2 Runtime offline installer,
run only on PCs without the runtime (ADR 0003, ADR 0022). `get-webview2.ps1` fetched it
from Microsoft's permanent link, which always serves the newest file. The same commit
therefore built different setups on different days: the installer was 205.2 MB on
2026-11-19 and 280.5 MB on 2026-11-22, and the combined setup, which carries it twice
(its own copy and the one inside Studio for per-facility setups), grew from 530 MB to
689 MB with no change of ours. A release signed by Evactis and handed to clients must be
rebuildable from its commit.

**Options.**
| Option | For | Against |
| --- | --- | --- |
| Keep the newest file | Always Microsoft's latest | Builds not reproducible; size and contents change unseen |
| Pin by SHA-256, keep the file (CI cache, the signing station's own copy) | Same file every build; a change is a reviewed commit | Microsoft serves only its newest file at the permanent link: when the pinned one is no longer available and no copy is kept, the build stops until the pin is moved |
| Commit the installer to the repository | Always available | 280 MB binary in Git history on every update |

**Decision.** Pin. `packaging/windows/webview2-pin.json` names the file's SHA-256, size,
version of Microsoft's setup stub, the address Microsoft delivered it from and the date.
`get-webview2.ps1` uses only that file: a copy in `target\webview2` is checked; a missing
one is downloaded from the pin's address, else the permanent link, and checked; anything
else stops the build with both hashes and the way forward. The Microsoft signature check
stays. CI keeps the file in an Actions cache keyed by the pin. `-UpdatePin` (connected
machine) downloads the newest file, checks its signature and rewrites the pin; the new
pin is built, tested and committed like any change.

**Consequences.** Setups change size only when the pin changes. When Microsoft stops
serving the pinned file and the CI cache has expired, Windows CI fails with a message
naming `-UpdatePin`: a one-file commit. Moving the pin is a release-procedure step
(security fixes in WebView2 reach users through Windows Update either way: the embedded
installer only matters on PCs that have no runtime at all).
