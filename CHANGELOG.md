# Changelog

All notable changes to Ally Report Runner are documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-25

### Added

- Add `A11Y_BROWSER_CHANNEL` with `bundled` as the backward-compatible default, plus supported installed-browser channels `chrome` and `msedge`.
- Add `A11Y_CHROMIUM_SANDBOX`, `A11Y_NAVIGATION_TIMEOUT_MS`, and `A11Y_MAX_CONFIGURATIONS` to make sandbox selection explicit and provide navigation and scan-matrix safeguards.

### Changed

- Require Node.js `>=24.22.1 <25` and pin the repository runtime to Node.js 24.22.1.
- Update Playwright from 1.63.0 to 1.64.1 and `@axe-core/playwright`/axe-core from 4.13.0 to 4.14.0. Playwright's bundled browser is Chromium 156.0.8078.4 (revision 1248).
- Keep the established 90-rule axe selection: explicitly disable axe 4.14's newly enabled-by-default `label-content-name-mismatch` rule while retaining the existing `target-size` rule. The rule-selection count stays the same, though engine and rule updates can change individual findings.
- Preserve the existing JSON and HTML report schema.

### Security

- Redact URL user information and common credential-bearing query and fragment values in scan logs and generated report URLs. This is best-effort redaction; arbitrary secret parameter names, URL paths, page content, and axe snippets can still contain sensitive values.
- Create report directories and files with restrictive `0700` and `0600` modes on POSIX systems. On Windows, the inherited filesystem ACL applies.
- Document that scan targets and configuration are trusted input. The runner intentionally supports localhost and internal targets and does not provide SSRF protection for arbitrary untrusted URLs, redirects, DNS resolution, or IPv4/IPv6 access.
- Refresh the Playwright and axe dependencies and the bundled Chromium revision as security maintenance. Selecting Chrome or Edge does not guarantee a fully patched browser; browser security depends on the installed vendor build, update state, and configuration.

### Known Limitations

- Local browser-channel verification ran on Windows 11 Pro build 26200 with Node.js 24.22.1: Chrome 155.0.8059.85 and Edge 156.0.4314.42 both passed loopback fixture scans with Chromium sandboxing on and off. Edge matched the latest published Stable version checked; installed Chrome was behind Google's then-current Stable rollout, so its result verifies compatibility only.
- The bundled default was verified on Windows with Chromium 156.0.8078.4 (revision 1248), and the bundled browser had also been tested on Linux/WSL. Linux branded-browser channels, macOS, and other Linux configurations remain unverified.
- Linux sandbox startup depends on host permissions and kernel/container policy; it worked in the development host environment and was denied inside the restricted execution sandbox. Windows sandbox startup passed for the tested Chrome and Edge installations. These results do not establish behavior on every consumer host.
- Automated scans do not establish accessibility conformance. Manual accessibility review remains necessary.

## [1.0.0] - 2026-10-09

### Added

- Initial public release of the standalone Playwright and axe-core accessibility reporting CLI, with configurable route, viewport, and color-scheme scans and JSON and static HTML reports.

[1.1.0]: https://github.com/monicaaikorice/a11y-report-runner/releases/tag/v1.1.0
[1.0.0]: https://github.com/monicaaikorice/a11y-report-runner/releases/tag/v1.0.0
