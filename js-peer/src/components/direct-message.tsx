import { Libp2p, PeerId, Stream } from '@libp2p/interface'
import { DIRECT_MESSAGE_PROTOCOL } from '@/lib/constants'
import { dm } from '@/lib/protobuf/direct-message'
import { pbStream } from 'it-protobuf-stream'

interface Params {
  libp2p: Libp2p
  peerId: PeerId
  message: string
}

export const dmVersion = '0.0.1'

// directMessageRequest dials and sends a direct message to a peer.
export const directMessageRequest = async ({
  libp2p,
  peerId,
  message,
}: Params): Promise<boolean> => {
  if (!message) {
    throw new Error('empty message')
  }

  let stream: Stream | undefined

  try {
    const stream = await libp2p.dialProtocol(peerId, DIRECT_MESSAGE_PROTOCOL, { signal: AbortSignal.timeout(5000) })

    if (!stream) {
      throw new Error('no stream')
    }

    const datastream = pbStream(stream)

    const req: dm.DirectMessageRequest = {
      message: message,
      meta: {
        clientVersion: dmVersion,
        timestamp: BigInt(Date.now()),
      },
    }

    await datastream.write(req, dm.DirectMessageRequest)

    const res = await datastream.read(dm.DirectMessageResponse)

    if (!res) {
      throw new Error('no response')
    }

    if (!res.meta) {
      throw new Error('no meta')
    }

    if (res.status !== dm.Status.OK) {
      throw new Error(`status: not OK, received: ${res.status}`)
    }
  } catch (e: any) {
    if (stream) {
      stream.abort(e)
    }

    throw e
  } finally {
    if (stream) {
      await stream.close()
    }
  }

  return true
}
