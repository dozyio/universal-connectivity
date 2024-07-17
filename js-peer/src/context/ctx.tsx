import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

import type { Libp2p } from 'libp2p'
import { startLibp2p } from '../lib/libp2p'
import { ChatProvider } from './chat-ctx'
import { PubSub } from '@libp2p/interface'
import { Identify } from '@libp2p/identify'

export const libp2pContext = createContext<{ libp2p: Libp2p }>({
  // @ts-ignore to avoid having to check isn't undefined everywhere. Can't be undefined because children are conditionally rendered
  libp2p: undefined,
})

interface WrapperProps {
  children?: ReactNode
}

// This is needed to prevent libp2p from instantiating more than once
let loaded = false
export function AppWrapper({ children }: WrapperProps) {
  const [libp2p, setLibp2p] = useState<Libp2p | undefined>()

  useEffect(() => {
    const init = async () => {
      if (loaded) return
      try {
        loaded = true
        const libp2p = await startLibp2p()

        // @ts-ignore
        window.libp2p = libp2p

        setLibp2p(libp2p as Libp2p<{
            pubsub: PubSub
            identify: Identify
          }>
         )

      } catch (e) {
        console.error('failed to start libp2p', e)
      }
    }

    init()
  }, [])

  if (!libp2p) {
    return (
      <div>
        <h2>Initializing libp2p peer...</h2>
      </div>
    )
  }

  return (
    <libp2pContext.Provider value={{ libp2p }}>
      <ChatProvider>{children}</ChatProvider>
    </libp2pContext.Provider>
  )
}

export function useLibp2pContext() {
  return useContext(libp2pContext)
}
