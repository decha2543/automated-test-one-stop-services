# Automated Test One-Stop Service

A cross-platform, one-stop workspace for test automation — Playwright (web/API),
Robot Framework, and k6 (performance) — driven by a single `task` CLI and an
optional local web **Hub**. Projects are manifest-driven and portable; the Hub
wraps the same CLI recipes behind a browser UI (run tests, view reports, manage
environments) with no deploy required.

> Created and maintained by **Decha_L**. If this helps you, please keep the
> attribution and consider supporting the project (see **Support / Donate**).

## Quick start (1-click)

Download the installer for your OS and run it — it bootstraps git, clones the
workspace, installs the toolchain + dependencies, and starts the Hub:

- **Windows**: `scripts/setup/automated-test-one-stop-service_installer_windows.bat`
- **macOS / Linux**: `scripts/setup/automated-test-one-stop-service_installer_mac-and-linux.sh`

Then open the Hub at <http://localhost:5174>.

### "Is this safe?" — the security warning

The installer is **not code-signed yet**, so on a fresh machine your operating
system may warn that it doesn't recognize it. This is expected for a new tool —
it's a reputation check, not a virus report. Download it **only** from the
official repository, then allow it to run. The steps are the same shape on every
OS:

1. **Windows** — double-click the `.bat`. If you see **"Windows protected your
   PC"**, click **More info**, then **Run anyway**.
2. **macOS** — if double-clicking is blocked, **Control-click (right-click) →
   Open → Open**, or run `bash <installer>.sh` in Terminal.
3. **Linux** — make it executable, then run it:
   `chmod +x <installer>.sh && ./<installer>.sh` (or just `bash <installer>.sh`).

> The real warning is always a **system dialog**, never a web page. Ignore any
> browser pop-up that imitates it, and only run the file you downloaded from the
> official link.

### What happens next (so nothing looks "stuck")

A console window opens and shows progress — **keep it open**. The first run
installs tools and can take several minutes (it's working, not frozen). When it
finishes it **opens the Hub in your browser automatically** and adds a **"Test
Hub"** shortcut to your desktop so you can reopen it anytime.

## CLI (no Hub required)

```bash
task                      # interactive runner
task setup                # install everything (first time)
task pw:run-local  PROJECT=<name> TYPE=web TAG='@smoke'
task robot:run-local PROJECT=<name> TYPE=web
task k6:run-local  PROJECT=<name> SECTION=<name> PERFORMANCE_TYPE=LOAD
task hub                  # start the Hub (dev)
task hub-build            # build the Hub (production)
task hub-start            # serve the built Hub
task --list               # all tasks
```

## Documentation

- Hub: [`hub/README.md`](hub/README.md)
- Knowledge base (Obsidian vault): [`brain/README.md`](brain/README.md)

## License

Source-available under the **PolyForm Noncommercial License 1.0.0** — free to
use, modify, and share for **noncommercial** purposes. **Commercial use requires
a separate license** from the author. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

You may not remove attribution or represent this work as your own. In-house /
client project content (`tools/*/projects/*`, `brain/projects/*`) is **not**
covered by this license and is not distributed here.

### Commercial license

Noncommercial use is free. If you want to use this **commercially** — sell it,
offer it as a paid product or service, or use it inside a for-profit product —
that requires a separate commercial license. I'm happy to arrange one: open an
issue on the repository or email **<Decha.L2543@gmail.com>**.

## Support / Donate

This is built and maintained in personal time to help others do test automation
well. If it's useful to you and you'd like to support continued development,
any amount is genuinely appreciated 🙏

The easiest way: open the **Hub → Settings → Support** and scan the **PromptPay
QR** (Thailand).

<!-- To enable it: drop your PromptPay QR image at
     hub/client/public/promptpay-qr.png — it then shows in the Hub automatically. -->

Prefer other channels? (optional — fill in if you use them)

- PromptPay (Thailand): `0953481756`

## Author

**Decha_L** — creator & maintainer. Interested in commercial licensing,
collaboration, or just want to say thanks? Reach out via the repository.
