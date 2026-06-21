# llm-for-zotero custom build

This fork is derived from
[yilewang/llm-for-zotero](https://github.com/yilewang/llm-for-zotero).

## Scope of this fork

- Only Codex App Server and Claude Code workflows are supported.
- WebChat has been removed.
- MinerU parsing, cache sync, and related UI have been removed.
- PDF access is path-based: use `@/absolute/path/to/file.pdf` or the local
  Zotero attachment path supplied by the plugin.
- The frontend no longer separates PDF handling into full-PDF, extracted-text,
  or MinerU modes.

## Build

```bash
npm install
npm run build
```

The generated Zotero add-on is:

```text
.scaffold/build/llm-for-zotero.xpi
```

## Install

In Zotero, open `Tools` -> `Add-ons` -> gear icon -> `Install Add-on From File`,
then select `.scaffold/build/llm-for-zotero.xpi`.
