# awto-pi-lot [![NPM Version](https://img.shields.io/npm/v/awto-pi-lot)](https://www.npmjs.com/package/awto-pi-lot)

awto-pi-lot is an extension for [pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and [opencode](https://opencode.ai) that adds support for [PPQ.ai](https://ppq.ai/) & [NanoGPT](https://nano-gpt.com/) providers.


## Info

To see the potential benefits of using accountless AI providers, see https://github.com/earendil-works/pi/discussions/2483


## Install/use

### pi-coding-agent

Install it with:

```
pi install npm:awto-pi-lot
```

Or from git directly:

```
pi install git:github.com/tarsgate/awto-pi-lot
```

Or if you want to use it without installing, use the `-e` flag (alias for `--extension`):

```
pi -e npm:awto-pi-lot
```

Or from git directly:

```
pi --extension git:github.com/tarsgate/awto-pi-lot
```

### OpenCode

See https://opencode.ai/docs/plugins/#use-a-plugin.

## Setup/auth

### pi-coding-agent

You can authenticate with an [auth.json](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#auth-file) file to hook your key, e.g.:

```
{
  "ppq": { "type": "api_key", "key": "sk-..." },
  "nanogpt": { "type": "api_key", "key": "sk-nano-..." }
}
```

And place in `~/.pi/agent/auth.json`.

Using env vars (PPQ_API_KEY, NANOGPT_API_KEY) is also supported but not recommended, because security tools like [skynot](https://github.com/tarsgate/skynot) or [pi-less-yolo](https://github.com/cjermain/pi-less-yolo) don't work with env vars OOTB.

### OpenCode

Use (PPQ_API_KEY, NANOGPT_API_KEY) environment variables. This only has to be specified one time, as OpenCode will remember the key.

---

## History

This repo used to be a fork of 'pi-mono' before becoming just a custom-provider extension. For retreiving the history of that old effort, check out tag `v0.60.0` (commit b0026866bf3459e06afb244f8b4334bc3782f7b0) and apply the patches in folder `patches/old/` on top of it.


## License

MIT
