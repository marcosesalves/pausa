# Pausa

A small desktop companion for mindful pauses: gentle reminders, short tips, breathing exercises, water and
posture nudges, and a sprout named Pip that grows with every pause you take. It lives in the macOS menu bar
and Dock, and in a normal window on Windows 11. Light, dark or system theme.

Built with Tauri 2 (Rust), React 19, TypeScript and plain CSS.

## Install

**Windows 11 (x64)**

```powershell
winget install MarcosAlves.Pausa
```

or download `Pausa_<version>_x64-setup.exe` from [Releases](../../releases). The installer is not code signed
yet, so Windows SmartScreen may say "Windows protected your PC": choose **More info**, then **Run anyway**.
Compare the SHA-256 in the release notes with `Get-FileHash <file>` if you want to be sure.

**macOS**: build it yourself for now (below).

## Build and run

You need Node 20+, a stable Rust toolchain and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # run the app
npm run tauri build    # make an installer for this machine
```

Checks that CI runs: `npm run validate:tips` and `npx tsc --noEmit`. Rust tests: `cargo test` in `src-tauri`.

## Feedback

The app has a form to send feedback or a bug report. It goes to a Supabase edge function
(`supabase/functions/submit-feedback`). The app holds no key or access code; the function limits what it
accepts. To enable it in your own build, set `PAUSA_FEEDBACK_URL` to your project URL when building. Without
it the form says feedback is off. See `supabase/.env.example` for the server-side limits.

## Releases

Pushing a tag such as `v0.2.0-beta.2` builds the Windows installer in GitHub Actions and attaches it, with its
SHA-256, to a GitHub release. The winget manifests are in `packaging/winget`.

## License

[MIT](LICENSE)
