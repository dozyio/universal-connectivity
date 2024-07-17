import {
  createDelegatedRoutingV1HttpApiClient,
  DelegatedRoutingV1HttpApiClient,
} from '@helia/delegated-routing-v1-http-api-client'
import { createLibp2p } from 'libp2p'
import { Identify, identify } from '@libp2p/identify'
import { peerIdFromString } from '@libp2p/peer-id'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { Multiaddr } from '@multiformats/multiaddr'
import { sha256 } from 'multiformats/hashes/sha2'
import type { Connection, Message, SignedMessage, PeerId, Libp2p } from '@libp2p/interface'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { webTransport } from '@libp2p/webtransport'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { BOOTSTRAP_PEER_IDS, CHAT_FILE_TOPIC, CHAT_TOPIC, PUBSUB_PEER_DISCOVERY } from './constants'
import first from 'it-first'
import { forComponent } from './logger'
import { PubSub } from '@libp2p/interface-pubsub'

const log = forComponent('libp2p')

export async function startLibp2p(): Promise<Libp2p<{ pubsub: PubSub; identify: Identify }>> {
  // enable verbose logging in browser console to view debug logs
  localStorage.debug = 'ui*,libp2p*,-libp2p:connection-manager*,-*:trace'

  const delegatedClient = createDelegatedRoutingV1HttpApiClient('https://delegated-ipfs.dev')

  const { bootstrapAddrs, relayListenAddrs } = await getBootstrapMultiaddrs(delegatedClient)
  log('starting libp2p with bootstrapAddrs %o and relayListenAddrs: %o', bootstrapAddrs, relayListenAddrs)

  let libp2p: Libp2p<{ pubsub: PubSub; identify: Identify }>

  try {
    libp2p = await createLibp2p({
      addresses: {
        listen: [
          // 👇 Listen for webRTC connection
          '/webrtc',
          // Use the app's bootstrap nodes as circuit relays
          ...relayListenAddrs,
        ],
      },
      transports: [
        webTransport(),
        webSockets(),
        webRTC({
          rtcConfiguration: {
            iceServers: [
              {
                // STUN servers help the browser discover its own public IPs
                urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'],
              },
            ],
          },
        }),
        // 👇 Required to estalbish connections with peers supporting WebRTC-direct, e.g. the Rust-peer
        webRTCDirect(),
        // 👇 Required to create circuit relay reservations in order to hole punch browser-to-browser WebRTC connections
        circuitRelayTransport({
          // When set to >0, this will look up the magic CID in order to discover circuit relay peers it can create a reservation with
          discoverRelays: 0,
        }),
      ],
      connectionManager: {
        maxConnections: 30,
        minConnections: 5,
      },
      connectionEncryption: [noise()],
      streamMuxers: [yamux()],
      connectionGater: {
        denyDialMultiaddr: async () => false,
      },
      peerDiscovery: [
        pubsubPeerDiscovery({
          interval: 10_000,
          topics: [PUBSUB_PEER_DISCOVERY],
          listenOnly: false,
        }),
        bootstrap({
          // The app-specific go and rust bootstrappers use WebTransport and WebRTC-direct which have ephemeral multiadrrs
          // that are resolved above using the delegated routing API
          list: bootstrapAddrs,
        }),
      ],
      services: {
        pubsub: gossipsub({
          allowPublishToZeroTopicPeers: true,
          msgIdFn: msgIdFnStrictNoSign,
          ignoreDuplicatePublishError: true,
        }),
        // Delegated routing helps us discover the ephemeral multiaddrs of the dedicated go and rust bootstrap peers
        // This relies on the public delegated routing endpoint https://docs.ipfs.tech/concepts/public-utilities/#delegated-routing
        delegatedRouting: () => delegatedClient,
        identify: identify(),
      },
    })

    if (!libp2p) {
      throw new Error('Failed to create libp2p node')
    }
  } catch (e) {
    console.log(e)
    throw e
  }

  libp2p.services.pubsub.subscribe(CHAT_TOPIC)
  libp2p.services.pubsub.subscribe(CHAT_FILE_TOPIC)

  libp2p.addEventListener('self:peer:update', ({ detail: { peer } }) => {
    const multiaddrs = peer.addresses.map(({ multiaddr }) => multiaddr)
    log(`changed multiaddrs: peer ${peer.id.toString()} multiaddrs: ${multiaddrs}`)
  })

  // 👇 explicitly dialling peers discovered via pubsub is only necessary
  //  when minConnections is set to 0 and the connection manager doesn't autodial
  // libp2p.addEventListener('peer:discovery', (event) => {
  //   const { multiaddrs, id } = event.detail

  //   if (libp2p.getConnections(id)?.length > 0) {
  //     log(`Already connected to peer %s. Will not try dialling`, id)
  //     return
  //   }

  //   dialWebRTCMaddrs(libp2p, multiaddrs)
  // })

  return libp2p as Libp2p<{ pubsub: PubSub; identify: Identify }>
}

// message IDs are used to dedupe inbound messages
// every agent in network should use the same message id function
// messages could be perceived as duplicate if this isnt added (as opposed to rust peer which has unique message ids)
export async function msgIdFnStrictNoSign(msg: Message): Promise<Uint8Array> {
  var enc = new TextEncoder()

  const signedMessage = msg as SignedMessage
  const encodedSeqNum = enc.encode(signedMessage.sequenceNumber.toString())
  return await sha256.encode(encodedSeqNum)
}

// Function which dials one maddr at a time to avoid establishing multiple connections to the same peer
async function dialWebRTCMaddrs(libp2p: Libp2p, multiaddrs: Multiaddr[]): Promise<void> {
  // Filter webrtc (browser-to-browser) multiaddrs
  const webRTCMadrs = multiaddrs.filter((maddr) => maddr.protoNames().includes('webrtc'))
  log(`dialling WebRTC multiaddrs: %o`, webRTCMadrs)

  for (const addr of webRTCMadrs) {
    try {
      log(`attempting to dial webrtc multiaddr: %o`, addr)
      await libp2p.dial(addr)
      return // if we succeed dialing the peer, no need to try another address
    } catch (error) {
      log.error(`failed to dial webrtc multiaddr: %o`, addr)
    }
  }
}

export const connectToMultiaddr = (libp2p: Libp2p) => async (multiaddr: Multiaddr) => {
  log(`dialling: %a`, multiaddr)
  try {
    const conn = await libp2p.dial(multiaddr)
    log('connected to %p on %a', conn.remotePeer, conn.remoteAddr)
    return conn
  } catch (e) {
    console.error(e)
    throw e
  }
}

// Function which resolves PeerIDs of rust/go bootstrap nodes to multiaddrs dialable from the browser
// Returns both the dialable multiaddrs in addition to the relay
async function getBootstrapMultiaddrs(
  client: DelegatedRoutingV1HttpApiClient,
): Promise<BootstrapsMultiaddrs> {
  const peers = await Promise.all(
    BOOTSTRAP_PEER_IDS.map((peerId) => first(client.getPeers(peerIdFromString(peerId)))),
  )

  const bootstrapAddrs = []
  const relayListenAddrs = []
  for (const p of peers) {
    if (p && p.Addrs.length > 0) {
      for (const maddr of p.Addrs) {
        const protos = maddr.protoNames()
        if (
          (protos.includes('webtransport') || protos.includes('webrtc-direct')) &&
          protos.includes('certhash')
        ) {
          if (maddr.nodeAddress().address === '127.0.0.1') continue // skip loopback
          bootstrapAddrs.push(maddr.toString())
          relayListenAddrs.push(getRelayListenAddr(maddr, p.ID))
        }
      }
    }
  }
  return { bootstrapAddrs, relayListenAddrs }
}

interface BootstrapsMultiaddrs {
  // Multiaddrs that are dialable from the browser
  bootstrapAddrs: string[]

  // multiaddr string representing the circuit relay v2 listen addr
  relayListenAddrs: string[]
}

// Constructs a multiaddr string representing the circuit relay v2 listen address for a relayed connection to the given peer.
const getRelayListenAddr = (maddr: Multiaddr, peer: PeerId): string =>
  `${maddr.toString()}/p2p/${peer.toString()}/p2p-circuit`

export const getFormattedConnections = (connections: Connection[]) =>
  connections.map((conn) => ({
    peerId: conn.remotePeer,
    protocols: [...new Set(conn.remoteAddr.protoNames())],
  }))
