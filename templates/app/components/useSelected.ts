'use client';
import { useCallback } from 'react';
import type { Post } from '@/lib/feed';
import { useViewState } from './site-view/SiteViewProvider';

/** The selected post. With both views it lives in the provider's memory, so a switch keeps it. */
export function useSelected(posts: Post[]): [string, (id: string) => void] {
  const [id, setId] = useViewState<string>('selected-post', posts[0]?.id ?? '');
  const select = useCallback((next: string) => setId(next), [setId]);
  return [id, select];
}
