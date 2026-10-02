// The default writer prompt. It is a pure function of its arguments: nothing here touches disk,
// the network or the clock, so a test can read the exact string the model is sent.
//
// The prompt asks for one JSON array covering the whole batch. Sent together, the model can drop
// its own duplicates, and one call does the work of N. Its post:true is still only a suggestion:
// every draft is re-checked by the code gate in gates/code-gate.mjs before it can be queued.

export function wirePrompt({ name, beat, voice = '', items = [], covered = [], maxChars = null, targetChars = null, tagged = false, ownNames = [], extra = '', copyRules = [] }) {
  const lines = [
    `You write short posts for ${name}, a news wire. Its beat: ${beat}`,
    '',
    'For each item below, decide whether it deserves a post now, and if it does, write the post.',
    tagged
      ? 'Return only a JSON array, with no code fence and no other text: [{"id":<n>,"post":true|false,"why":"<one line>","text":"<the post>","tag":"<one topic word>"}]'
      : 'Return only a JSON array, with no code fence and no other text: [{"id":<n>,"post":true|false,"why":"<one line>","text":"<the post>"}]',
    '',
  ];
  if (voice) lines.push('=== VOICE (the wire\'s own register; follow it exactly) ===', String(voice).trim(), '');
  lines.push(
    '=== WHAT A GOOD POST IS ===',
    'The event is in the item: a release, an incident, an advisory, a launch, a filing, a result.',
    'The source link is attached to the post separately.',
    maxChars ? `Aim for about ${targetChars || Math.round(maxChars * 0.7)} characters. ${maxChars} is a hard ceiling.` : 'There is no hard character ceiling. Match the length the voice asks for.',
    'Lead with the recognizable company, project, person or event in the first sentence.',
    'Then give one concise interpretation: the practical consequence, the mechanism the announcement',
    'leaves out, or the trade-off. One to three sentences.',
    'Write for someone seeing the news now. The current event is the subject of the post.',
    '',
    '=== SET post:false WHEN ===',
    '- you have nothing to say about it beyond restating it',
    '- it is the same story as another item in this batch (keep the best one, mark the rest false)',
    '- it is already covered by one of these recent posts:',
    ...covered.slice(-30).map((t) => `    - ${String(t).slice(0, 110)}`),
    '- a post would need a claim you cannot support from the item itself',
    '',
    '=== HARD RULES (breaking any one means post:false) ===',
  );
  if (maxChars) lines.push(`- the text is under ${maxChars} characters`);
  lines.push(
    '- no URLs in the text',
    tagged ? '- no hashtags in the text; put one topic word in "tag", without the # sign' : '- no hashtags',
    '- no emoji',
    '- react only to what is in the item. Do not invent details or attribute claims to it that it does not make.',
    '- do not invent a personal anecdote, and never claim to have used, run or tested the thing',
    '- a preprint is a preprint: never state its claim as an established result',
    '- never mention automation, scheduling or how this post was made',
  );
  if (ownNames.length) lines.push(`- never name ${ownNames.join(', ')}; this wire covers other people's news`);
  for (const r of copyRules) lines.push(`- ${r}`);
  if (extra) lines.push('', '=== MORE INSTRUCTIONS FOR THIS WIRE ===', String(extra).trim());
  lines.push('', '=== ITEMS ===', JSON.stringify(items, null, 1));
  return lines.join('\n');
}
