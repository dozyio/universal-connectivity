# js-libp2p bootstrapper for universal connectivity

## Building

```sh
npm run build
```

## Example - Running on a non-natted Server

```sh
IP4_TCP_PORT=6160 IP6_TCP_PORT=6161 IP4_WS_PORT=6162 IP6_WS_PORT=6163 IP4_ANNOUNCE=<PUBLIC IP> DIRECT_PEERS_MA=<comma separated list of multiaddrs> TOPICS=<comma separated list of topics> npm run dev
```
