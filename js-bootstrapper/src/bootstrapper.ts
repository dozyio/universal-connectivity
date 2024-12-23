/* eslint-disable no-console */
import { autoTLS } from '@libp2p/auto-tls'
import { GossipsubEvents, GossipsubOpts, gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { Identify, identify, identifyPush } from '@libp2p/identify'
import { tcp } from '@libp2p/tcp'
import { Libp2pOptions, createLibp2p } from 'libp2p'
import { PingService, ping } from '@libp2p/ping'
import { Multiaddr, multiaddr } from '@multiformats/multiaddr'
import { peerIdFromString } from '@libp2p/peer-id'
import { createPeerScoreParams, createTopicScoreParams } from '@chainsafe/libp2p-gossipsub/score'
import { LevelDatastore } from 'datastore-level'
import { loadOrCreateSelfKey } from '@libp2p/config'
import { AddrInfo } from '@chainsafe/libp2p-gossipsub/types';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webSockets } from '@libp2p/websockets'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import type { Message, SignedMessage, Libp2p } from '@libp2p/interface'
import { PubSub } from '@libp2p/interface-pubsub';
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { keychain } from '@libp2p/keychain'
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'
import { autoNAT } from '@libp2p/autonat'
import { uPnPNAT } from '@libp2p/upnp-nat'
import { WebSocketsSecure } from '@multiformats/multiaddr-matcher'
import { bootstrap } from '@libp2p/bootstrap'
import { sha256 } from 'multiformats/hashes/sha2'
import { tls } from '@libp2p/tls'

const topicScoreCap = 50
const topicWeight = 1

// P1
const timeInMeshQuantum = 1 * 1000 //  10 second
const timeInMeshCap = 3
const timeInMeshWeight = 0.1

// P2
const firstMessageDeliveriesDecay = 0.90
const firstMessageDeliveriesCap = 5
const firstMessageDeliveriesWeight = 1

const gossipScoreThreshold = -500
const publishScoreThreshold = -1000
const graylistScoreThreshold = -2500
const acceptPXScoreThreshold = 1000
const opportunisticGraftScoreThreshold = 3.5

type Libp2pType = Libp2p<{
  identify: Identify
  ping: PingService
  pubsub: PubSub<GossipsubEvents>
}>

let directPeersPeerIds: string[] = []

function applicationScore(p: string) {
  if (directPeersPeerIds.includes(p)) {
    return 1200
  }

  return 0
}

async function msgIdFnStrictNoSign(msg: Message): Promise<Uint8Array> {
  var enc = new TextEncoder()

  const signedMessage = msg as SignedMessage
  const encodedSeqNum = enc.encode(signedMessage.sequenceNumber.toString())
  return await sha256.encode(encodedSeqNum)
}

(async () => {
  try {
    const datastore = new LevelDatastore('./db')
    await datastore.open()
    const privateKey = await loadOrCreateSelfKey(datastore)

    let directPeers: AddrInfo[] = []
    // DIRECT_PEERS_MA should be comma seperated list of multiaddrs which will 
    // be used for gossipsub direct peers
    if (process.env.DIRECT_PEERS_MA !== undefined) {
      const peers = process.env.DIRECT_PEERS_MA.split(",")
      peers.forEach((p) => {
        const id = multiaddr(p).getPeerId()

        if (id === null) {
          return
        }

        const addrInfo: AddrInfo = {
          id: peerIdFromString(id),
          addrs: [multiaddr(p)]
        }

        directPeers.push(addrInfo)
        directPeersPeerIds.push(id)
      })
    }

    let topics: string[] = []
    if (process.env.TOPICS !== undefined) {
      topics = process.env.TOPICS.split(",")
    } else {
      console.log("TOPICS env not set")
      process.exit(1)
    }

    let ip4tcpPort = '0'
    if (process.env.IP4_TCP_PORT !== undefined) {
      ip4tcpPort = process.env.IP4_TCP_PORT
    }

    let ip6tcpPort = '0'
    if (process.env.IP6_TCP_PORT !== undefined) {
      ip6tcpPort = process.env.IP6_TCP_PORT
    }

    let ip4wsPort = '0'
    if (process.env.IP4_WS_PORT !== undefined) {
      ip4wsPort = process.env.IP4_WS_PORT
    }

    let ip6wsPort = '0'
    if (process.env.IP6_WS_PORT !== undefined) {
      ip6wsPort = process.env.IP6_WS_PORT
    }

    let ip4Announce: string | undefined = undefined
    if (process.env.IP4_ANNOUNCE !== undefined) {
      ip4Announce = process.env.IP4_ANNOUNCE
    }

    // Recommend setting D settings to 0 for bootstrapper
    // https://github.com/libp2p/specs/blob/master/pubsub/gossipsub/gossipsub-v1.1.md#recommendations-for-network-operators
    const D = 0
    const DLO = 0
    const DHI = 0
    const DOUT = 0

    // Configure Gossipsub
    const gossipsubConfig: Partial<GossipsubOpts> = {
      enabled: true,
      D: D,
      Dlo: DLO,
      Dhi: DHI,
      Dout: DOUT,
      doPX: true,
      emitSelf: false,
      msgIdFn: msgIdFnStrictNoSign,
      allowPublishToZeroTopicPeers: true, // don't throw if no peers
      scoreParams: createPeerScoreParams({
        // P5
        appSpecificScore: applicationScore,

        // P6
        IPColocationFactorWeight: 0,
        IPColocationFactorThreshold: 0,
        IPColocationFactorWhitelist: new Set<string>(),

        // P7
        behaviourPenaltyWeight: 0,
        behaviourPenaltyThreshold: 0,
        behaviourPenaltyDecay: 0,

        topicScoreCap: topicScoreCap,

        topics: topics.reduce((acc, topic) => {
          acc[topic] = createTopicScoreParams({
            topicWeight: topicWeight,

            // P1
            timeInMeshWeight: timeInMeshWeight,
            timeInMeshQuantum: timeInMeshQuantum,
            timeInMeshCap: timeInMeshCap,

            // P2
            firstMessageDeliveriesWeight: firstMessageDeliveriesWeight,
            firstMessageDeliveriesDecay: firstMessageDeliveriesDecay,
            firstMessageDeliveriesCap: firstMessageDeliveriesCap,

            // P3
            meshMessageDeliveriesWeight: 0,
            // meshMessageDeliveriesDecay: 0,
            // meshMessageDeliveriesCap: 0,
            // meshMessageDeliveriesThreshold: 0,
            // meshMessageDeliveriesWindow: 0,
            // meshMessageDeliveriesActivation: 0,

            // P3b
            meshFailurePenaltyWeight: 0,
            // meshFailurePenaltyDecay: 0,

            // P4
            invalidMessageDeliveriesWeight: 0,
            // invalidMessageDeliveriesDecay: 0,
          });
          return acc;
        }, {} as Record<string, ReturnType<typeof createTopicScoreParams>>), // Map topics to params
      }),
      scoreThresholds: {
        gossipThreshold: gossipScoreThreshold,
        publishThreshold: publishScoreThreshold,
        graylistThreshold: graylistScoreThreshold,
        acceptPXThreshold: acceptPXScoreThreshold,
        opportunisticGraftThreshold: opportunisticGraftScoreThreshold,
      },
      directPeers,
      directConnectTicks: 30,
    }

    // Configure Libp2p
    const libp2pConfig: Libp2pOptions = {
      datastore,
      privateKey,
      addresses: {
        listen: [
          `/ip4/0.0.0.0/tcp/${ip4tcpPort}`,
          `/ip6/::/tcp/${ip6tcpPort}`,
          `/ip4/0.0.0.0/tcp/${ip4wsPort}/ws`,
          `/ip6/::/tcp/${ip6wsPort}/ws`,
        ]
      },
      transports: [
        tcp(),
        webSockets(),
        webRTC(),
        webRTCDirect(),
        circuitRelayTransport()
      ],
      connectionEncrypters: [noise(), tls()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        pubsubPeerDiscovery()
      ],
      connectionManager: {
        maxConnections: 500,
        maxIncomingPendingConnections: 30,
      },
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        ping: ping(),
        pubsub: gossipsub(gossipsubConfig),
        // relay: circuitRelayServer(),
        keychain: keychain(),
        autoTLS: autoTLS({
          acmeDirectory: 'https://acme-staging-v02.api.letsencrypt.org/directory',
          autoConfirmAddress: true
        }),
        // upnpNAT: uPnPNAT({
        //   autoConfirmAddress: true
        // }),
        // autoNAT: autoNAT(),
        // aminoDHT: kadDHT({
        //   protocol: '/ipfs/kad/1.0.0',
        //   peerInfoMapper: removePrivateAddressesMapper
        // }),
        // bootstrap: bootstrap({
        //   list: [
        //     '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
        //     '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
        //     '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
        //     '/dnsaddr/va1.bootstrap.libp2p.io/p2p/12D3KooWKnDdG3iXw9eTFijk3EWSunZcFi54Zka4wmtqtt6rPxc8',
        //     '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ'
        //   ]
        // })
      },
    }

    if (ip4Announce && libp2pConfig.addresses) {
      libp2pConfig.addresses.appendAnnounce = [
        `/ip4/${ip4Announce}/tcp/${ip4wsPort}/ws`
      ]
    }

    // Create Libp2p instance
    const server: Libp2pType = await createLibp2p(libp2pConfig) as Libp2pType

    server.addEventListener('self:peer:update', (event) => {
      console.log('self:peer:update')
      if (event.detail?.peer?.addresses) {
        event.detail.peer.addresses.forEach((addr) => {
          console.log(`Listening On: ${addr.multiaddr.toString()}/p2p/${server.peerId.toString()}`)
        })
      }
    })

    server.addEventListener('certificate:provision', () => {
      console.info('A TLS certificate was provisioned')

      const interval = setInterval(() => {
        const mas = server
          .getMultiaddrs()
          .filter(ma => WebSocketsSecure.exactMatch(ma) && ma.toString().includes('/sni/'))
          .map(ma => ma.toString())

        if (mas.length > 0) {
          console.info('addresses:')
          console.info(mas.join('\n'))
          clearInterval(interval)
        }
      }, 1_000)
    })

    // Subscribe to topics
    for (let i = 0; i < topics.length; i++) {
      server.services.pubsub.subscribe(topics[i])
    }

    // console.log('Bootstrapper listening on multiaddr(s): ', server.getMultiaddrs().map((ma: Multiaddr) => ma.toString()))

    const shutdown = async () => {
      process.exit(0)
    }

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)

  } catch (error) {
    console.error('An error occurred during initialization:', error)
    process.exit(1)
  }
})()
