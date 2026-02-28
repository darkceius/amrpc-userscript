# AM Rich Presence via UserScript + Proxy

## Requirements

- rust
- any extension that supports userscripts (preferably tampermonkey)

## Installation

- install the [userscript](./userscript.js) file
- building the server: `cd server-rs && cargo build --release`
- running the server `./target/release/amrpc-proxy`

## Notice

- the RPC will only work when the proxy server is online (due to localhost websocket browser limitations)
- add the `amrpc-proxy` executable to your startups
