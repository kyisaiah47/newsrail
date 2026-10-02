import config from '../newsrail.config.json';
import ViewControls from './site-view/ViewControls';

export default function Footer({ feedUrl }: { feedUrl: string }) {
  return (
    <footer className="foot">
      <p>
        {config.name}. <a href={feedUrl}>JSON feed</a>. Published with <a href="https://github.com/kyisaiah47/newsrail">NewsRail</a>.
      </p>
      <ViewControls />
    </footer>
  );
}
