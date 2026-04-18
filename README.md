# awto-pi-lot [![NPM Version](https://img.shields.io/npm/v/awto-pi-lot)](https://www.npmjs.com/package/awto-pi-lot)

awto-pi-lot is an extension for [pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) that adds support for [PPQ.ai](https://ppq.ai/) & its [AutoClaw](https://ppq.ai/blog/using-autoclaw-with-payperq) model.


## Info

To see the potential benefits of using PPQ/AutoClaw, see https://github.com/badlogic/pi-mono/discussions/2483


## Install/use

Install it with:

```
pi install npm:awto-pi-lot
```

Or from git directly:

```
pi install git:github.com/nblockchain/awto-pi-lot
```

Or if you want to use it without installing, use the `-e` flag (alias for `--extension`):

```
pi -e npm:awto-pi-lot
```

Or from git directly:

```
pi --extension git:github.com/nblockchain/awto-pi-lot
```


## Setup/auth

You can authenticate with an [auth.json](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#auth-file) file to hook your key, e.g.:

```
{ "ppq": { "type": "api_key", "key": "sk-..." } }
```

Which you can extract from your [PPQ.ai account page](https://ppq.ai/account-activity), and place in `~/.pi/agent/auth.json`.

Using env var PPQ_API_KEY is also supported but not recommended, because sandboxing tools like [pi-less-yolo](https://github.com/cjermain/pi-less-yolo) would not work OOTB.

---

## License

MIT
