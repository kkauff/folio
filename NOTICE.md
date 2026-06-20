# Third-Party Notices

Folio is licensed under the MIT License (see [`LICENSE`](./LICENSE)). It bundles
and depends on third-party software and assets that carry their own licenses,
acknowledged below.

## Bundled fonts

### Monoton

Folio ships the **Monoton** typeface (`public/fonts/Monoton-Regular.ttf`), used
for the app's brand logo and icon.

- Copyright (c) 2011 by vernon adams (vern@newtypography.co.uk), with Reserved
  Font Name "Monoton".
- Licensed under the **SIL Open Font License, Version 1.1**.
- Full license text: [`public/fonts/Monoton-OFL.txt`](./public/fonts/Monoton-OFL.txt)

The OFL requires this copyright notice and license to be distributed with the
font; both the `.ttf` and `Monoton-OFL.txt` are included in the source tree and
in built application bundles.

> All other typefaces offered in Folio (Serif, Sans, Humanist, Rounded,
> Monospace) are **system font stacks** — they reference fonts already installed
> on the user's operating system and are not bundled or redistributed by Folio.

## Key dependencies

These are the principal libraries Folio is built on. Each is distributed under
its own license; the full text for every transitive dependency is reproduced in
its respective package within `node_modules/` (JavaScript) and is available via
`cargo` metadata (Rust).

| Component | Role | License |
| --- | --- | --- |
| [Tauri](https://tauri.app) | Native desktop shell | MIT / Apache-2.0 |
| [React](https://react.dev) / React DOM | UI framework | MIT |
| [Vite](https://vite.dev) | Frontend build tool | MIT |
| [CodeMirror 6](https://codemirror.net) (`@codemirror/*`, `@lezer/*`) | Markdown editor | MIT |
| [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) | Markdown rendering | MIT |
| [lucide-react](https://lucide.dev) | Icon set | ISC |
| [`argon2`](https://crates.io/crates/argon2) | Password key derivation (Argon2id) | MIT / Apache-2.0 |
| [`aes-gcm`](https://crates.io/crates/aes-gcm) | Authenticated encryption (AES-256-GCM) | MIT / Apache-2.0 |
| [`zeroize`](https://crates.io/crates/zeroize) | Wipes keys from memory | MIT / Apache-2.0 |
| [`rand`](https://crates.io/crates/rand) | Cryptographic RNG | MIT / Apache-2.0 |
| [`uuid`](https://crates.io/crates/uuid), [`serde`](https://crates.io/crates/serde), [`base64`](https://crates.io/crates/base64) | IDs, serialization, encoding | MIT / Apache-2.0 |

To regenerate a complete dependency license inventory:

```bash
# Rust crates
cargo install cargo-about && (cd src-tauri && cargo about generate about.hbs)

# npm packages
npx license-checker --summary
```
