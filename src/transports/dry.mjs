// The dry transport. It sends nothing. It returns a fake id and URL so the rest of the tick
// (verify, claims, store) runs exactly as it would after a real send. A dry tick swaps every
// configured transport for this one.

let n = 0;

export function dryTransport(platform, { log = () => {} } = {}) {
  return {
    platform,
    dry: true,
    async post({ text, card = null }) {
      n += 1;
      const id = `dry-${platform}-${Date.now()}-${n}`;
      log(`  [dry ${platform}] would post (${[...text].length} chars)${card ? ` with ${card.path}` : ''}:\n    ${text}`);
      return { id, url: `dry://${platform}/${id}`, text };
    },
    async reply(parent, { text }) {
      n += 1;
      log(`  [dry ${platform}] would reply to ${parent.id}: ${text}`);
      return { id: `dry-${platform}-reply-${n}`, url: null, text };
    },
    async verify(result) {
      return Boolean(result && result.id);
    },
  };
}
