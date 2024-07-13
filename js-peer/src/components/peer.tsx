import { useLibp2pContext } from "@/context/ctx"
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from "@headlessui/react"
import { Fragment, useEffect, useState } from "react"
import { PeerId } from '@libp2p/interface'
import { useChatContext } from "@/context/chat-ctx"
import { DIRECT_MESSAGE_PROTOCOL } from "@/lib/constants"
import { peerIdFromString } from '@libp2p/peer-id'
import Blockies from 'react-18-blockies'
import { classNames } from "@/lib/classes"

interface MenuItemProps {
  protocol: string
  peerId: PeerId
}

const QUERY = 'QUERY'

export function ProtocolMenuItem({ protocol, peerId }: MenuItemProps) {
  const { setRoomId } = useChatContext()

  const handleSetRoomId = () => {
    setRoomId(peerId.toString())
  }

  const [dialing, setDialing] = useState(false)
  const { libp2p } = useLibp2pContext()

  const handleQuery = async () => {
    try {
      console.log('Dialing', peerId.toString())
      setDialing(true)
      const conn = await libp2p.dial(peerId)

      // await conn.close()
    } catch (e) {
      console.error('Failed to dial', e)
    } finally {
      setDialing(false)
    }
  }

  if (protocol === QUERY) {
    return (
      <MenuItem>
        {({ focus }) => (
          <span
            className={classNames(
              focus ? 'bg-gray-100 text-gray-900' : 'text-gray-700',
              'block px-4 py-2 text-sm',
            )}
            onClick={() => handleQuery()}
          >
            Get Protocols
          </span>
        )}
      </MenuItem>
    )
  }

  if (protocol === DIRECT_MESSAGE_PROTOCOL) {
    return (
      <MenuItem>
        {({ focus }) => (
          <span
            className={classNames(
              focus ? 'bg-gray-100 text-gray-900' : 'text-gray-700',
              'block px-4 py-2 text-sm',
            )}
            onClick={() => handleSetRoomId()}
          >
            Message
          </span>
        )}
      </MenuItem>
    )
  }
}

export interface PeerProps {
  peer: PeerId,
  self: boolean,
  withName: boolean,
  withUnread: boolean
}

export function Peer({ peer, self, withName, withUnread }: PeerProps ) {
  const { libp2p } = useLibp2pContext()
  const { directMessages, setRoomId } = useChatContext()
  const [commsProtocols, setCommsProtocols] = useState<string[]>([''])
  const [allProtocols, setAllProtocols] = useState<string[]>([''])

  useEffect(() => {
    const init = async () => {
      if (await libp2p.peerStore.has(peerIdFromString(peer.toString()))) {
        console.log('Peer found in peerStore')
        const p = await libp2p.peerStore.get(peerIdFromString(peer.toString()))
        console.log(peer.toString(), p.protocols)

        setCommsProtocols(
          p.protocols.filter(
            (proto) =>
              proto.startsWith('/universal-connectivity/') &&
              proto !== '/universal-connectivity/kad/1.0.0' &&
              proto !== '/universal-connectivity/lan/kad/1.0.0',
          ),
        )

        setAllProtocols(p.protocols)
      } else {
        console.log('Peer not in peerStore')
        setCommsProtocols([QUERY])
      }
    }

    init()
  }, [libp2p.peerStore, peer])

  return (
    <Menu as="div" className="relative inline-block text-left">
        <MenuButton className="inline-flex w-full justify-center rounded-md text-sm font-semibold text-gray-900">

      <Blockies seed={peer.toString()} size={15} scale={3} className="rounded max-h-10 max-w-10" />
      {withName && 
        <div className="w-full">
          <div className="flex justify-between">
            <span className={`block ml-2 font-semibold ${self ? 'text-indigo-700-600' : 'text-gray-600'}`}>
              {peer.toString().slice(-7)}
              {self && ' (You)'}
            </span>
          </div>
            {withUnread && (
              <div className="ml-2 text-gray-600">
                {directMessages[peer.toString()]?.filter((m) => !m.read).length ? `(${directMessages[peer.toString()]?.filter((m) => !m.read).length} unread)` : ''}
              </div>
            )}
        </div>
      }
      </MenuButton>
      {!self &&
        <>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <MenuItems className="absolute left-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
              {commsProtocols && commsProtocols.length > 0 &&
                <div className="py-1">
                  {commsProtocols.map((protocol) => {
                    return (
                      <ProtocolMenuItem
                        key={protocol}
                        protocol={protocol}
                        peerId={peer}
                      />
                    )
                  })}
                </div>
              }
              {allProtocols && allProtocols.length > 0 && commsProtocols && commsProtocols.length === 0 &&
                <div className="py-1">
                  <MenuItem>
                    {({ focus }) => (
                      <span
                        className={classNames(
                          focus ? 'bg-gray-100 text-gray-900' : 'text-gray-700',
                          'block px-4 py-2 text-sm',
                        )}
                      >
                        Direct Message Unsupported
                      </span>
                    )}
                  </MenuItem>
                </div>
              }
            </MenuItems>
          </Transition>
        </>
      }
    </Menu>
  )
}
