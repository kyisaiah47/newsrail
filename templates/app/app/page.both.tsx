import { getFeed } from '@/lib/feed';
import ConsoleView from '@/components/ConsoleView';
import SimpleView from '@/components/SimpleView';
import PageViews from '@/components/site-view/PageViews';
import Footer from '@/components/Footer';

export const revalidate = 60;

export default async function Home() {
  const feed = await getFeed();
  return (
    <>
      <PageViews
        consoleView={<ConsoleView posts={feed.posts} title={feed.title} description={feed.description} error={feed.error} />}
        simpleView={<SimpleView posts={feed.posts} title={feed.title} description={feed.description} feedUrl={feed.feedUrl} error={feed.error} />}
      />
      <Footer feedUrl={feed.feedUrl} />
    </>
  );
}
