import { Libp2p, PeerId, Stream } from '@libp2p/interface'
import { pipe } from 'it-pipe'
import { Uint8ArrayList } from 'uint8arraylist'
import { DIRECT_MESSAGE_PROTOCOL } from '@/lib/constants'
import { dm } from '@/lib/protobuf/direct-message'

interface Params {
  libp2p: Libp2p
  peerId: PeerId
  message: string
}

const clientVersion = '0.0.1'

// directMessageRequest dials and sends a direct message to a peer.
export const directMessageRequest = async ({
  libp2p,
  peerId,
  message,
}: Params): Promise<boolean> => {
  if (!message) {
    throw new Error('empty message')
  }

  let req: dm.DirectMessageRequest = {
    message: message,
    meta: {
      clientVersion: clientVersion,
      timestamp: BigInt(Date.now()),
    },
  }

  const encodedReq = dm.DirectMessageRequest.encode(req)

  let stream: Stream | undefined
  let response = false

  try {
    const stream = await libp2p.dialProtocol(peerId, DIRECT_MESSAGE_PROTOCOL, { signal: AbortSignal.timeout(5000) })

    if (!stream) {
      throw new Error('no stream')
    }

    // send message and read response
    await pipe(
      [encodedReq], // array of Uint8Array to send
      stream,
      async function(source) {
        for await (const chunk of source) {
          response = await directMessageResponseProcessChunk(chunk)
        }
      },
    )
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

  if (!response) {
    throw new Error('directMessageResponse was not true')
  }

  if (stream) {
    await stream.close()
  }

  return true
}

async function directMessageResponseProcessChunk(
  chunk: Uint8ArrayList,
): Promise<boolean> {
  const uint8Array = chunk.subarray()
  const res = dm.DirectMessageResponse.decode(uint8Array)

  if (!res || !res.meta) {
    throw new Error('no meta')
  }

  if (res.status !== dm.Status.OK) {
    throw new Error(`status: not OK, received: ${res.status}`)
  }

  return true
}

// directMessageResponse generates a response to a directMessageRequest to
// indicate that the message was received.
export async function directMessageResponse(
  libp2p: Libp2p,
  status: dm.Status,
): Promise<Uint8Array> {
  if (!libp2p) {
    throw new Error('no p2p connection')
  }

  let res: dm.DirectMessageResponse = {
    status: status,
    meta: {
      clientVersion: clientVersion,
      timestamp: BigInt(Date.now()),
    },
  }

  return dm.DirectMessageResponse.encode(
    res as dm.DirectMessageResponse,
  )
}

export async function directMessageRequestProcessChunk(
  chunk: Uint8ArrayList,
): Promise<string> {
  const uint8Array = chunk.subarray()
  const res = dm.DirectMessageRequest.decode(uint8Array)

  if (!res || !res.meta) {
    throw new Error('no meta')
  }

  return res.message
}
