import Head from 'next/head'
import ChatContainer from '@/components/chat/ChatContainer'
import Nav from '@/components/Nav'
import { LeftSidebar } from '@/components/sidebar/LeftSidebar'
import { RightSidebar } from '@/components/sidebar/RightSidebar'

export default function Chat() {
  return (
    <>
      <Head>
        <title>js-libp2p Chat</title>
        <meta name="description" content="Generated by create next app" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className="min-h-full">
        <Nav />
        <div className="flex flex-row">
          <div className="basis-2/12">
            <LeftSidebar />
          </div>
          <div className="basis-8/12">
            <ChatContainer />
          </div>
          <div className="basis-2/12">
            <RightSidebar />
          </div>
        </div>
      </main>
    </>
  )
}
