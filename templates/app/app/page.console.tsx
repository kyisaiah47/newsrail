import { getFeed } from '@/lib/feed';
import ConsoleView from '@/components/ConsoleView';
import Footer from '@/components/Footer';

export const revalidate = 60;

export default async function Home() {
  const feed = await getFeed();
  return (
    <>
      <ConsoleView posts={feed.posts} title={feed.title} description={feed.description} error={feed.error} />
      <Footer feedUrl={feed.feedUrl} />
    </>
  );
}
