import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLibp2pContext } from './ctx';
import type { Message } from '@libp2p/interface'
import { CHAT_FILE_TOPIC, CHAT_TOPIC, DIRECT_MESSAGE_PROTOCOL, FILE_EXCHANGE_PROTOCOL, PUBSUB_PEER_DISCOVERY } from '@/lib/constants'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { pipe } from 'it-pipe'
import map from 'it-map'
import * as lp from 'it-length-prefixed'
import { forComponent } from '@/lib/logger'
import { toBuffer } from '@/lib/buffer'
import { directMessageRequestProcessChunk, directMessageResponse } from '@/components/direct-message';
import { dm } from '@/lib/protobuf/direct-message'

const log = forComponent('chat-context')

export interface ChatFile {
  id: string
  body: Uint8Array
  sender: string
}

export interface ChatMessage {
  msgId: string
  msg: string
  fileObjectUrl: string | undefined
  from: 'me' | 'other'
  peerId: string
  read: boolean
  receivedAt: number
}

export interface DirectMessages {
  [peerId: string]: ChatMessage[]
}

export type Chatroom = string

export interface ChatContextInterface {
  messageHistory: ChatMessage[]
  setMessageHistory: (
    messageHistory:
      | ChatMessage[]
      | ((prevMessages: ChatMessage[]) => ChatMessage[]),
  ) => void
  directMessages: DirectMessages
  setDirectMessages: (
    directMessages:
      | DirectMessages
      | ((prevMessages: DirectMessages) => DirectMessages),
  ) => void
  roomId: Chatroom
  setRoomId: (chatRoom: Chatroom) => void
  files: Map<string, ChatFile>
  setFiles: (files: Map<string, ChatFile>) => void
}

export const chatContext = createContext<ChatContextInterface>({
  messageHistory: [],
  setMessageHistory: () => {},
  directMessages: {},
  setDirectMessages: () => {},
  roomId: '',
  setRoomId: () => {},
  files: new Map<string, ChatFile>(),
  setFiles: () => {},
})

export const useChatContext = () => {
  return useContext(chatContext)
}

export const directMessageEvent = 'directMessageEvt'

export const ChatProvider = ({ children }: any) => {
	const [messageHistory, setMessageHistory] = useState<ChatMessage[]>([]);
    const [directMessages, setDirectMessages] = useState<DirectMessages>({})
  const [files, setFiles] = useState<Map<string, ChatFile>>(new Map<string, ChatFile>());
  const [roomId, setRoomId] = useState<Chatroom>('')

  const { libp2p } = useLibp2pContext()

  const messageCB = (evt: CustomEvent<Message>) => {
    console.log('messageCB', evt)
    // FIXME: Why does 'from' not exist on type 'Message'?
    const { topic, data } = evt.detail

    switch (topic) {
      case CHAT_TOPIC: {
        chatMessageCB(evt, topic, data)
        break
      }
      case CHAT_FILE_TOPIC: {
        chatFileMessageCB(evt, topic, data)
        break
      }
      case PUBSUB_PEER_DISCOVERY: {
        break
      }
      default: {
        console.error(`Unexpected event %o on gossipsub topic: ${topic}`, evt)
      }
    }
  }

  const chatMessageCB = (evt: CustomEvent<Message>, topic: string, data: Uint8Array) => {
    const msg = new TextDecoder().decode(data)
    log(`${topic}: ${msg}`)

    // Append signed messages, otherwise discard
    if (evt.detail.type === 'signed') {
      setMessageHistory([
        ...messageHistory,
        {
          msgId: crypto.randomUUID(),
          msg,
          fileObjectUrl: undefined,
          from: 'other',
          peerId: evt.detail.from.toString(),
          read: false,
          receivedAt: Date.now(),
        },
      ])
    }
  }

  const chatFileMessageCB = async (evt: CustomEvent<Message>, topic: string, data: Uint8Array) => {
    const newChatFileMessage = (id: string, body: Uint8Array) => {
      return `File: ${id} (${body.length} bytes)`
    }
    const fileId = new TextDecoder().decode(data)

    // if the message isn't signed, discard it.
    if (evt.detail.type !== 'signed') {
      return
    }
    const senderPeerId = evt.detail.from;

    try {
      const stream = await libp2p.dialProtocol(senderPeerId, FILE_EXCHANGE_PROTOCOL)
      await pipe(
        [uint8ArrayFromString(fileId)],
        (source) => lp.encode(source),
        stream,
        (source) => lp.decode(source),
        async function(source) {
          for await (const data of source) {
            const body: Uint8Array = data.subarray()
            log(`chat file message request_response: response received: size:${body.length}`)

            const msg: ChatMessage = {
              msgId: crypto.randomUUID(),
              msg: newChatFileMessage(fileId, body),
              fileObjectUrl: window.URL.createObjectURL(new Blob([body])),
              from: 'other',
              peerId: senderPeerId.toString(),
              read: false,
              receivedAt: Date.now(),
            }
            setMessageHistory([...messageHistory, msg])
          }
        }
      )
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    const handleDirectMessage = async (event: any) => {
      console.debug(directMessageEvent, event)

      const peerId = event.detail.connection.remotePeer.toString()

      const message: ChatMessage = {
        msg: event.detail.request,
        from: 'other',
        read: false,
        msgId: crypto.randomUUID(),
        fileObjectUrl: undefined,
        peerId: peerId,
        receivedAt: Date.now(),
      }

      const updatedMessages = directMessages[peerId]
        ? [...directMessages[peerId], message]
        : [message]

      setDirectMessages({
        ...directMessages,
        [peerId]: updatedMessages,
      })
    }

    document.addEventListener(directMessageEvent, handleDirectMessage)

    return () => {
      document.removeEventListener(directMessageEvent, handleDirectMessage)
    }
  }, [directMessages, setDirectMessages])

  useEffect(() => {
    libp2p.services.pubsub.addEventListener('message', messageCB)

    libp2p.handle(FILE_EXCHANGE_PROTOCOL, ({ stream }) => {
      pipe(
        stream.source,
        (source) => lp.decode(source),
        (source) => map(source, async (msg) => {
          const fileId = uint8ArrayToString(msg.subarray())
          const file = files.get(fileId)!
          return file.body
        }),
        (source) => lp.encode(source),
        stream.sink,
      )
    })

    return () => {
      (async () => {
        // Cleanup handlers 👇
        libp2p.services.pubsub.removeEventListener('message', messageCB)
        await libp2p.unhandle(FILE_EXCHANGE_PROTOCOL)
      })();
    }
  })

  useEffect(() => {
    libp2p.handle(DIRECT_MESSAGE_PROTOCOL, async ({ stream, connection }) => {
      pipe(
        stream.source, // Source, read data from the stream
        async function (source) {
          let reqData

          for await (const chunk of source) {
            reqData = await directMessageRequestProcessChunk(chunk, connection)
          }

          const eventDetails = {
            request: reqData,
            stream: stream,
            connection: connection,
          }

          document.dispatchEvent(
            new CustomEvent(directMessageEvent, { detail: eventDetails }),
          )
        },
      )

      const signedEncodedRes = await directMessageResponse(
        libp2p,
        dm.Status.OK,
      )

      await pipe(
        [signedEncodedRes], // array of Uint8Array to send
        toBuffer, // convert strings (or other data) into Buffer before sending
        stream.sink, // Sink, write data to the stream
      )
    })

    return () => {
      (async () => {
        // Cleanup handlers 👇
        await libp2p.unhandle(DIRECT_MESSAGE_PROTOCOL)
      })();
    }
  })


	return (
		<chatContext.Provider
      value={{
        roomId,
        setRoomId,
        messageHistory,
        setMessageHistory,
        directMessages,
        setDirectMessages,
        files,
        setFiles
      }}>
			{children}
		</chatContext.Provider>
	);
};
