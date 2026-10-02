import { getFeed } from '@/lib/feed';
import SimpleView from '@/components/SimpleView';
import Footer from '@/components/Footer';

export const revalidate = 60;

export default async function Home() {
  const feed = await getFeed();
  return (
    <>
      <SimpleView posts={feed.posts} title={feed.title} description={feed.description} feedUrl={feed.feedUrl} error={feed.error} />
      <Footer feedUrl={feed.feedUrl} />
    </>
  );
}
