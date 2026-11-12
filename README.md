# dsh-incognito

An incognito session plugin for DeepSeek Harness (DSH). It opens an
**independent temporary agent** in a floating window beside the composer:

Repository: <https://github.com/Raikouzen/dsh-incognito>

![Incognito window](docs/incognito-window.png)

- one-click glasses button next to the composer plus
- the composer input bar switches to a dedicated incognito input bar
- the agent has its own agent preset, own prompt, own tool composition, and a
  fresh temporary working directory
- no context, memory, messages, or prompts are inherited from the resident session
- full DSH toolset: shell, file read/write/search, background jobs, skills,
  goals, subagent, workflow, Ralph, web search/fetch
- closing the window fades it out over **5 seconds**; cleanup runs only after
  that fade. Clicking anywhere in the window during the fade cancels the close
  and restores full visibility, so the session and its contents remain usable.
- when the fade completes, the agent is disposed and its session log, temp
  working directory, and workspace/cache references are removed
- page refresh and host restart sweep orphaned incognito directories

## Install

From GitHub, point the Web plugin manager at
`https://github.com/Raikouzen/dsh-incognito`, or install the package spec:

```sh
dsh plugin --profile web add github:Raikouzen/dsh-incognito
```

Then select it as a profile bundle in the Web plugin manager and restart DSH.

From a local checkout, install it as a profile bundle:

```sh
dsh plugin --profile web add file:/absolute/path/to/dsh-incognito
```

Then restart DSH. The plugin's bundle patch declares both the host module and
the `incognito` agent preset. The host module must be selected as a profile
bundle (the Web plugin manager does this automatically for bundles).

For a development install in the Web profile:

```sh
cd ~/.dsh/profiles/web
pnpm add file:/absolute/path/to/dsh-incognito
```

and make sure `dsh-incognito` is present in `package.json`'s
`dsh.profile.bundles` (the Web plugin manager's install action does this).
Restart DSH after changing host code.

## Usage

1. Click the glasses icon next to the plus button in the composer.
2. A floating incognito window opens and the input bar switches to the
   incognito bar. Type there and press Enter.
3. Click the × to close. The window fades for five seconds. Click anywhere in
   the window before the fade ends to keep the session.
4. After the fade, the temporary agent and its disk artifacts are destroyed.

## Privacy model

- The resident session never receives a message, tool call, or transcript row
  from the incognito agent. The browser talks to the plugin's own `/api/dsh-incognito/*`
  routes; the host creates the agent directly with `ctx.agents.create`.
- The incognito session uses `origin: "subagent"`, no `parentSession`, no seed,
  and a private preset, so it starts with an empty transcript and its own
  persona. Global memory plugins that only observe root sessions do not attach to it.
- The working directory is `%TEMP%/dsh-incognito/session-incognito-<uuid>` (or
  the platform temp equivalent), outside every registered DSH workspace. The
  session's sandbox `workspace-write` boundary is that directory.
- DSH's projection cache is patched to skip incognito ids, so titles, token
  counts, and last-user-prompt checkpoints are not written to
  `~/.dsh/storages/session_projcache/`.
- On close/boot/refresh, the host deletes:
  - the temp working directory
  - `~/.dsh/sessions/<project-key>/` for that cwd (this includes any child
    subagent logs created from the incognito session)
  - workspace accounting/archived/pinned references for the id if any listener
    attached the session
- The model provider still sees the conversation as a normal API request.
  Tool-written files outside the temp directory, provider-side logs, and
  aggregate billing meters are outside the plugin's control.

## Layout

```
cordis.patch.yml     preset + host bundle patch
lib/index.js         host: agent lifecycle, RPC routes, cleanup
lib/client.js        client: entry button, shadow composer, floating window
lib/core.js          pure path/format/stream helpers
test/core.test.mjs   pure helper tests
```

## License

MIT. See [LICENSE](LICENSE).
